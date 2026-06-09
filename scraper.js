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

async function scrapeSinglePage(gotScraping, pageNumber) {
    const url = pageNumber === 1 
        ? 'https://steamrip.com/top-games/' 
        : `https://steamrip.com/top-games/page/${pageNumber}/`;

    try {
        const response = await gotScraping({ url, http2: true, timeout: { request: 15000 } });
        if (response.statusCode === 404) return null;

        const $ = cheerio.load(response.body);
        const gameElements = $('.post-item');
        if (gameElements.length === 0) return null;

        // 👈 CORRECTION : Extraction dynamique du nombre total de pages via ton élément "Last"
        let totalPages = null;
        if (pageNumber === 1) {
            const lastPageHref = $('a.pages-nav-item[title="Last"]').attr('href');
            if (lastPageHref) {
                // Recherche les chiffres présents après "page/"
                const match = lastPageHref.match(/page\/(\d+)/);
                if (match) {
                    totalPages = parseInt(match[1], 10);
                    console.log(`📊 Nombre total de pages détecté sur le site : ${totalPages}`);
                }
            }
        }

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

        return { results, totalPages };
    } catch (error) {
        console.error(`Erreur sur la page ${pageNumber}:`, error.message);
        return null;
    }
}

async function startScraping(onGameAdded, onProgressUpdate) {
    try {
        const { gotScraping } = await import('got-scraping');
        let bdd = loadBackupData();
        let startPage = 1;
        let keepScraping = true;
        let totalPages = 170; // Valeur de repli si la détection échouait

        console.log("🚀 Lancement du scraping...");

        while (keepScraping) {
            const pageGroup = Array.from({ length: CONCURRENCY_LIMIT }, (_, i) => startPage + i);
            
            const groupResults = await Promise.all(
                pageGroup.map(p => scrapeSinglePage(gotScraping, p).catch(() => null))
            );

            let localAddedCount = 0;
            let hitEnd = false;

            for (let i = 0; i < groupResults.length; i++) {
                const pageData = groupResults[i];
                const currentPageNum = pageGroup[i];

                if (!pageData) {
                    hitEnd = true;
                    continue; 
                }

                // Met à jour le total de pages si trouvé sur la page 1
                if (pageData.totalPages) {
                    totalPages = pageData.totalPages;
                }

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

            // Calcul du pourcentage basé sur la dernière page de la vague actuelle
            const lastPageProcessed = startPage + CONCURRENCY_LIMIT - 1;
            let percent = Math.min(Math.round((lastPageProcessed / totalPages) * 100), 100);
            
            if (hitEnd) percent = 100;

            if (typeof onProgressUpdate === 'function') {
                onProgressUpdate(percent);
            }

            if (hitEnd) {
                keepScraping = false;
                break;
            }

            startPage += CONCURRENCY_LIMIT;
            await new Promise(resolve => setTimeout(resolve, 1200));
        }

        return { success: true };
    } catch (error) {
        console.error("Erreur critique dans startScraping :", error.message);
        return { success: false, error: error.message };
    }
}

module.exports = { startScraping };