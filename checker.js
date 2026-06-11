const fs = require('fs');
const path = require('path');

const JSON_FILE = path.join(__dirname, 'games.json'); 

async function checkAndFixImages() {
    console.log("🚀 Lancement du vérificateur...");
    const { gotScraping } = await import('got-scraping');
    
    let bdd = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
    const keys = Object.keys(bdd);

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const game = bdd[key];

        // On affiche le nom pour identifier quel jeu pose problème
        console.log(`Traitement [${i}/${keys.length}] : ${game.gameName}`);

        try {
            if (!game.imageLink) {
                console.log("  -> Pas de lien, on skip.");
                continue;
            }

            const response = await gotScraping.head(game.imageLink, { 
                timeout: { request: 5000 }, 
                throwHttpErrors: false 
            });
            
            if (response.statusCode !== 200) {
                console.log(`  -> ⚠️ Image cassée (${response.statusCode})`);
                
                // Logique de remplacement
                let altUrl = game.imageLink.includes('portrait')
                    ? game.imageLink.replace('portrait', 'free-download-torrent')
                    : game.imageLink.replace('free-download-torrent', 'portrait');

                const altResp = await gotScraping.head(altUrl, { timeout: { request: 5000 }, throwHttpErrors: false });
                
                if (altResp.statusCode === 200) {
                    console.log(`  -> ✅ Corrigée : ${altUrl}`);
                    bdd[key].imageLink = altUrl;
                } else {
                    console.log(`  -> ❌ Alternative introuvable.`);
                }
            }
        } catch (error) {
            // Ici, on affiche l'erreur réelle qui bloque le script
            console.error(`  -> 💥 ERREUR CRITIQUE sur ${game.gameName} :`, error.message);
        }

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(bdd, null, 4), 'utf-8');
    console.log(`\n🎉 Audit terminé.`);
}

checkAndFixImages();