const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { app } = require('electron'); 

const userDataPath = app.getPath('userData');
const JSON_FILE = path.join(userDataPath, 'games.json');
const CONCURRENCY_LIMIT = 4; 

function formatKey(text) {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, '-');
}

function loadBackupData() {
    if (fs.existsSync(JSON_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
        } catch (e) {
            console.log("Fichier JSON corrompu ou vide, création d'un nouveau.");
            return {};
        }
    }
    return {};
}

// Ajout du paramètre maxRetries (par défaut 3)
async function scrapeSinglePage(gotScraping, pageNumber, maxRetries = 3) {
    const url = pageNumber === 1 
        ? 'https://steamrip.com/top-games/' 
        : `https://steamrip.com/top-games/page/${pageNumber}/`;

    // Boucle de tentatives
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await gotScraping({ url, http2: true, timeout: { request: 15000 } });
            
            // Si la page n'existe vraiment pas (404), on ne réessaie pas, on arrête pour cette page.
            if (response.statusCode === 404) return null;

            const $ = cheerio.load(response.body);
            const gameElements = $('.post-item');
            if (gameElements.length === 0) return null;

            const results = [];
            gameElements.each((index, element) => {
                const anchor = $(element).find('a.post-thumb');
                const gameName = anchor.find('h2.the-post-title').text().trim();
                const rawHref = anchor.attr('href');
                const gameUrl = rawHref && rawHref.startsWith('/') ? `https://steamrip.com${rawHref}` : rawHref;

                const imgElement = anchor.find('img.thumbnail-image');
                let imageLink = imgElement.attr('data-src-webp') || imgElement.attr('data-lazy-src') || imgElement.attr('data-src');

                if (!imageLink || imageLink.startsWith('data:')) {
                    const noscriptContent = anchor.find('noscript').html();
                    if (noscriptContent) {
                        const $noscript = cheerio.load(noscriptContent);
                        imageLink = $noscript('img').attr('src');
                    } else {
                        imageLink = imgElement.attr('src');
                    }
                }

                if (imageLink && imageLink.startsWith('/')) {
                    imageLink = `https://steamrip.com${imageLink}`;
                }

                results.push({ gameName, gameUrl, imageLink: imageLink || "Pas d'image" });
            });

            // Si on arrive ici, le scraping a réussi, on retourne les résultats
            return { results };

        } catch (error) {
            console.warn(`⚠️ Erreur sur la page ${pageNumber} (Tentative ${attempt}/${maxRetries}): ${error.message}`);
            
            if (attempt === maxRetries) {
                console.error(`❌ Échec définitif pour la page ${pageNumber} après ${maxRetries} tentatives. Page ignorée.`);
                return null;
            }
            
            // On attend avant de réessayer (le délai augmente à chaque tentative : 2s, puis 4s...)
            const delay = 2000 * attempt;
            console.log(`⏳ Attente de ${delay/1000}s avant de réessayer la page ${pageNumber}...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function startScraping(onGameAdded, onProgressUpdate) {
    try {
        const { gotScraping } = await import('got-scraping');
        let bdd = loadBackupData();
        let totalPages = 170;

        console.log("🔍 Récupération du nombre total de pages...");
        
        try {
            const initRes = await gotScraping({ url: 'https://steamrip.com/top-games/', http2: true });
            const $init = cheerio.load(initRes.body);
            const lastPageHref = $init('a.pages-nav-item[title="Last"]').attr('href');
            if (lastPageHref) {
                const match = lastPageHref.match(/page\/(\d+)/);
                if (match) {
                    totalPages = parseInt(match[1], 10);
                    console.log(`📊 Nombre total de pages détecté : ${totalPages}`);
                }
            }
        } catch (e) {
            console.log("⚠️ Impossible de détecter le max de pages, utilisation du fallback (170).");
        }

        console.log("🚀 Lancement du scraping inversé (de la fin vers le début)...");

        let currentPage = totalPages;

        while (currentPage > 0) {
            const pageGroup = [];
            for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
                if (currentPage - i > 0) {
                    pageGroup.push(currentPage - i);
                }
            }
            
            // Le catch ici sert uniquement de filet de sécurité final, scrapeSinglePage gère déjà ses erreurs.
            const groupResults = await Promise.all(
                pageGroup.map(p => scrapeSinglePage(gotScraping, p).catch(() => null))
            );

            let localAddedCount = 0;

            for (let i = 0; i < groupResults.length; i++) {
                const pageData = groupResults[i];

                if (!pageData) continue; 

                pageData.results.forEach(game => {
                    const gameKey = formatKey(game.gameName);
                    if (!bdd[gameKey]) {
                        const newGame = {
                            gameName: game.gameName,
                            url: game.gameUrl,
                            imageLink: game.imageLink
                        };
                        bdd[gameKey] = newGame;
                        localAddedCount++;

                        if (typeof onGameAdded === 'function') {
                            onGameAdded({ key: gameKey, data: newGame });
                        }
                    }
                });
            }

            if (localAddedCount > 0) {
                fs.writeFileSync(JSON_FILE, JSON.stringify(bdd, null, 4), 'utf-8');
            }

            const processedCount = totalPages - currentPage + pageGroup.length;
            let percent = Math.min(Math.round((processedCount / totalPages) * 100), 100);

            if (typeof onProgressUpdate === 'function') {
                onProgressUpdate(percent);
            }

            currentPage -= CONCURRENCY_LIMIT;
            
            await new Promise(resolve => setTimeout(resolve, 1200));
        }

        return { success: true };
    } catch (error) {
        console.error("Erreur critique dans startScraping :", error.message);
        return { success: false, error: error.message };
    }
}

module.exports = { startScraping };