const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { app } = require('electron'); // 👈 Ajout d'Electron pour les chemins

// 👈 CORRECTION : On pointe vers AppData/Roaming/ton-app/games.json
const userDataPath = app.getPath('userData');
const JSON_FILE = path.join(userDataPath, 'games.json');
const CONCURRENCY_LIMIT = 8; 

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
    // ... (Ton code scrapeSinglePage reste EXACTEMENT le même, il est parfait) ...
    const url = pageNumber === 1 
        ? 'https://steamrip.com/top-games/' 
        : `https://steamrip.com/top-games/page/${pageNumber}/`;

    try {
        const response = await gotScraping({ url, http2: true, timeout: { request: 15000 } });
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
        return results;
    } catch (error) {
        return null;
    }
}

async function startScraping() {
    try {
        const { gotScraping } = await import('got-scraping');
        let bdd = loadBackupData();
        let startPage = 1;
        let keepScraping = true;

        console.log("🚀 Lancement du scraping ultra-rapide par vagues...");

        while (keepScraping) {
            const pageGroup = Array.from({ length: CONCURRENCY_LIMIT }, (_, i) => startPage + i);
            console.log(`\n📦 Envoi de la vague pour les pages : ${pageGroup.join(', ')}`);

            const groupResults = await Promise.all(
                pageGroup.map(p => scrapeSinglePage(gotScraping, p))
            );

            let localAddedCount = 0;
            let hitEnd = false;

            for (let i = 0; i < groupResults.length; i++) {
                const pageData = groupResults[i];
                const currentPageNum = pageGroup[i];

                if (!pageData) {
                    console.log(`ℹ️ La page ${currentPageNum} est vide ou inexistante (Fin du catalogue détectée).`);
                    hitEnd = true;
                    continue; 
                }

                pageData.forEach(game => {
                    const gameKey = formatKey(game.gameName);
                    if (!bdd[gameKey]) {
                        bdd[gameKey] = {
                            gameName: game.gameName,
                            url: game.gameUrl,
                            imageLink: game.imageLink
                        };
                        localAddedCount++;
                    }
                });
            }

            console.log(`✨ Vague terminée : ${localAddedCount} nouveaux jeux ajoutés.`);

            if (localAddedCount > 0) {
                fs.writeFileSync(JSON_FILE, JSON.stringify(bdd, null, 4), 'utf-8');
                console.log("💾 games.json mis à jour.");
            }

            if (hitEnd) {
                keepScraping = false;
                break;
            }

            startPage += CONCURRENCY_LIMIT;
            await new Promise(resolve => setTimeout(resolve, 1200));
        }

        console.log("\n🎯 Scraping terminé à vitesse maximale ! Tout est dans games.json");
        return { success: true, message: "Scraping terminé avec succès." }; // 👈 Retourne un statut

    } catch (error) {
        console.error("Erreur critique générale :", error.message);
        return { success: false, error: error.message };
    }
}

// 👈 L'ASTUCE MAGIQUE : On exporte la fonction au lieu de l'exécuter tout de suite !
module.exports = { startScraping };