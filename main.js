const { app, BrowserWindow, ipcMain, globalShortcut,shell,clipboard } = require('electron');
const path = require('path');

const dossierAppData = app.getPath('userData'); 
const dossierDestination = path.join(dossierAppData, 'games');
const dataPath = path.join(dossierAppData, 'data.json');
const { startScraping } = require('./scraper');

const telechargementsActifs = {};

// import './index.js'; 
require('./scraper.js');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1266,
    height: 861,
    minHeight: 861,
    maxHeight: 861,
    minWidth: 1266,
    maxWidth: 1266,
    icon: path.join(__dirname, 'sources/kortexlogo.png'),
    frame: false, 
    autoHideMenuBar: true,
    
    // 👇 LA COMBINAISON SÉCURISÉE POUR WINDOWS
    transparent: true, 
    // backgroundMaterial: 'acrylic',
    
    // 👇 AJOUT CRUCIAL : Force Windows à arrondir la structure de l'app sans bordure
    roundedCorners: true,
    backgroundColor: '#00000000',  // Force le fond de la fenêtre à être invisible
    thickFrame: true,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true, 
      preload: path.join(__dirname, 'preload.js') 
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.on('lancer-scraping', async () => {
    console.log("📥 [Main] Demande de scraping reçue...");
    
    try {
        // Le script attend ici que TOUTES les pages soient faites
        const resultat = await startScraping(
            (gameObj) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('nouveau-jeu', gameObj);
                }
            },
            (pourcentage) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('progression-scraping', pourcentage);
                }
            }
        );

        // 👈 AJOUTE CETTE SÉCURITÉ ICI : Une fois sorti de startScraping, c'est fini !
        if (resultat && resultat.success) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('scraping-termine');
            }
        }

    } catch (error) {
        console.error("❌ [Main] Erreur capturée durant le scraping :", error);
    }
});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


////////////////////////
////////////////////////
////////////////////////
////////////////////////
////////////////////////
////////////////////////
////////////////////////
////////////////////////
////////////////////////
////////////////////////

const cheerio = require('cheerio');
const fs = require('fs');
const unrar = require('node-unrar-js');
const { Client, pipeline } = require('undici');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const { chromium } = require('playwright-core');

ipcMain.handle('canal-securise', async (event, urlRecue, nomJeu) => {
    // Nettoyage du nom pour le dossier et le fichier
    const nomSecurise = nomJeu ? nomJeu.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_") : "jeu_telecharge";
    const nomFichierFinal = `${nomSecurise}.rar`;
    // const dossierDestination = path.join(__dirname, 'games');
    let nbChunks = 5;

    if (!fs.existsSync(dossierDestination)) {
        fs.mkdirSync(dossierDestination, { recursive: true });
    }

    console.log(`\n[ÉTAPE 1] Récupération de la page du jeu : ${urlRecue}`);

    try {
        const { gotScraping } = await import('got-scraping');

        // Headers de base pour les requêtes de validation et téléchargement
        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://steamrip.com/',
        };

        // 1. Extraction des liens "DOWNLOAD HERE" (Avec un timeout strict pour éviter les freezes)
        const responseSteamRip = await gotScraping({ 
            url: urlRecue, 
            http2: true,
            timeout: { request: 15000 } // Fix du freeze : on n'attend pas indéfiniment
        });
        
        const $1 = cheerio.load(responseSteamRip.body);
        const intermediateLinks = [];

        $1('a').each((index, element) => {
            const linkText = $1(element).text().trim();
            if (linkText === 'DOWNLOAD HERE') {
                let href = $1(element).attr('href');
                if (href) {
                    if (href.startsWith('//')) href = `https:${href}`;
                    intermediateLinks.push(href);
                }
            }
        });

        if (intermediateLinks.length === 0) return { status: 'error', message: 'Aucun lien de téléchargement trouvé sur la page.' };

        // Variables pour stocker les liens triés
        const bzzhrLinks = [];
        let gofileLink = null;
        let cookiesGofile = "";

        // 2. Scraping ciblé des hébergeurs
        console.log(`[ÉTAPE 2] Scraping des hébergeurs...`);
        for (const url of intermediateLinks) {
            try {
                if (url.includes('bzzhr.to') || url.includes('buzzheaver')) {
                    const responseHost = await gotScraping({ url, http2: true, timeout: { request: 10000 } });
                    const $ = cheerio.load(responseHost.body);
                    $('li').each((i, el) => {
                        if ($(el).text().includes('Download:')) {
                            const hxGet = $(el).find('a').first().attr('hx-get');
                            if (hxGet) bzzhrLinks.push(`https://bzzhr.to${hxGet}`);
                        }
                    });
                } else if (url.includes('gofile.io')) {
                    let browser;
                    try {
                        console.log(`[INFO] Lancement de Playwright pour scraper Gofile...`);
                        browser = await chromium.launch({ headless: true, channel: 'chrome' });
                        const page = await browser.newPage();

                        const linkPromise = new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error("Timeout API Gofile")), 15000);

                            page.on('response', async (res) => {
                                if (res.url().includes('api.gofile.io/contents')) {
                                    try {
                                        const json = await res.json();
                                        const children = json.data?.children || {};
                                        for (const key in children) {
                                            if (children[key].link) {
                                                clearTimeout(timeout);
                                                resolve(children[key].link);
                                            }
                                        }
                                    } catch(e) { /* On ignore les erreurs de parse JSON silencieusement */ }
                                }
                            });
                        });

                        await page.goto(url, { waitUntil: 'commit', timeout: 15000 });
                        const directLink = await linkPromise;
                        
                        if (directLink) {
                            const pageCookies = await page.context().cookies();
                            cookiesGofile = pageCookies.map(c => `${c.name}=${c.value}`).join('; ');
                            gofileLink = directLink;
                            console.log(`[SUCCÈS] Lien Gofile récupéré !`);
                        }
                    } catch (err) {
                        console.error(`[ERREUR] Gofile ignoré :`, err.message);
                    } finally {
                        if (browser) await browser.close();
                    }
                }
            } catch (e) { 
                console.error(`[ERREUR] Impossible de scraper l'URL ${url}:`, e.message); 
            }
        }

        // 3. Sélection stricte du serveur selon tes règles (Bzzhr S2 > Bzzhr S1 > Gofile)
        console.log(`\n[ÉTAPE 3] Sélection du serveur prioritaire...`);
        let lienChoisi = null;
        let cookiesHebergeur = "";

        // Fonction rapide pour vérifier si un lien est en ligne sans le télécharger
        async function validerLien(link, cookies = "") {
            try {
                const reqHeaders = { ...baseHeaders, 'Range': 'bytes=0-100' };
                if (cookies) reqHeaders['Cookie'] = cookies;
                
                const pingRes = await gotScraping({
                    url: link,
                    headers: reqHeaders,
                    timeout: { request: 5000 },
                    throwHttpErrors: false,
                    retry: { limit: 1 }
                });
                return pingRes.statusCode === 200 || pingRes.statusCode === 206 || pingRes.statusCode === 302;
            } catch (e) { return false; }
        }

        if (bzzhrLinks.length > 1) {
            console.log("[INFO] Test du Serveur 2 Buzzheaver...");
            if (await validerLien(bzzhrLinks[1])) {
                lienChoisi = bzzhrLinks[1];
                nbChunks = 15;
                console.log("✅ Serveur 2 Buzzheaver sélectionné.");
            }
        }

        if (!lienChoisi && bzzhrLinks.length > 0) {
            console.log("[INFO] Test du Serveur 1 Buzzheaver...");
            if (await validerLien(bzzhrLinks[0])) {
                lienChoisi = bzzhrLinks[0];
                nbChunks = 15;
                console.log("✅ Serveur 1 Buzzheaver sélectionné.");
            }
        }

        if (!lienChoisi && gofileLink) {
            console.log("[INFO] Test du Serveur Gofile...");
            if (await validerLien(gofileLink, cookiesGofile)) {
                lienChoisi = gofileLink;
                cookiesHebergeur = cookiesGofile;
                nbChunks = 5;
                console.log("✅ Serveur Gofile sélectionné.");
            }
        }

        if (!lienChoisi) {
            return { status: 'error', message: "Aucun serveur prioritaire (Buzzheaver ou Gofile) n'est disponible ou en ligne. Installation annulée." };
        }

        // ==========================================
// 4. TÉLÉCHARGEMENT HYBRIDE (MODE OVERCLOCKÉ 🚀)
// ==========================================
const cheminComplet = path.join(dossierDestination, nomFichierFinal);
const downloadController = new AbortController();

console.log(`\n[ÉTAPE 4] Lancement du téléchargement sur : ${lienChoisi}`);

if (cookiesHebergeur) {
    baseHeaders['Cookie'] = cookiesHebergeur;
}

let totalOctets = 0;
let supporteChunks = false;

try {
    const pingRes = await gotScraping({
        url: lienChoisi,
        headers: { ...baseHeaders, 'Range': 'bytes=0-0' },
        http2: false, 
        throwHttpErrors: false,
        timeout: { request: 10000 }
    });

    if (pingRes.statusCode === 206 && pingRes.headers['content-range']) {
        supporteChunks = true;
        totalOctets = parseInt(pingRes.headers['content-range'].split('/')[1], 10);
        console.log(`[INFO] Multi-connexion supporté ! Taille : ${(totalOctets / (1024 * 1024)).toFixed(2)} Mo`);
    } else {
        totalOctets = parseInt(pingRes.headers['content-length'] || 0, 10);
        console.log(`[INFO] Multi-connexion refusé. Passage en mode classique.`);
    }
} catch (error) {
    return { status: 'error', message: `Erreur de connexion au fichier final: ${error.message}` };
}

let telecharges = 0;
let derniersOctets = 0;
event.sender.send('debut-download', "start");

const progressInterval = setInterval(() => {
    const octetsDepuisDerniereFois = telecharges - derniersOctets;
    derniersOctets = telecharges;

    const vitesseMoS = (octetsDepuisDerniereFois / (1024 * 1024)).toFixed(2);

    const progress = {
        pourcentage: totalOctets > 0 ? ((telecharges / totalOctets) * 80).toFixed(1) + "%" : "Calcul...",
        actuel: (telecharges / (1024 * 1024)).toFixed(2) + " Mo",
        total: totalOctets > 0 ? (totalOctets / (1024 * 1024)).toFixed(2) + " Mo" : "Inconnu",
        name: nomSecurise,
        vitesse: `${vitesseMoS} Mo/s`,
    };
    event.sender.send('update-download-progress', progress);
}, 1000);

try {
    // ON INITIALISE L'OBJET GLOBAL ICI AVEC UN TABLEAU POUR LES STREAMS DE CHUNKS
    telechargementsActifs[nomSecurise] = { 
        controller: downloadController, 
        cheminFichier: cheminComplet,
        activeStreams: [] 
    };

    if (supporteChunks) {
        const chunkSize = Math.floor(totalOctets / nbChunks);
        const promises = [];
        const partFiles = [];

        for (let i = 0; i < nbChunks; i++) {
            const start = i * chunkSize;
            const end = i === nbChunks - 1 ? totalOctets - 1 : (start + chunkSize - 1);
            const partPath = `${cheminComplet}.part${i}`;
            partFiles.push(partPath);

            promises.push((async () => {
                let maxRetries = 5;
                let octetsDuChunkTelecharges = 0;

                for (let tentative = 1; tentative <= maxRetries; tentative++) {
                    // SÉCURITÉ : Si annulé entre deux tentatives, on stoppe tout de suite
                    if (downloadController.signal.aborted) break;

                    try {
                        const rangeStart = start + octetsDuChunkTelecharges;
                        if (rangeStart > end) break;

                        await new Promise((resolve, reject) => {
                            if (downloadController.signal.aborted) return reject(new Error('Aborted'));

                            const stream = gotScraping.stream({
                                url: lienChoisi,
                                headers: { ...baseHeaders, 'Range': `bytes=${rangeStart}-${end}` },
                                signal: downloadController.signal,
                                http2: false, 
                                timeout: { 
                                    response: 15000, // 15s max pour que le serveur réponde au départ
                                    // read: 45000
                                    request: 2147483647
                                 },
                                retry: { limit: 0 }
                            });

                            const writeStream = fs.createWriteStream(partPath, { 
                                flags: octetsDuChunkTelecharges > 0 ? 'a' : 'w',
                                highWaterMark: 4 * 1024 * 1024 
                            });

                            // AJOUT CRUCIAL : On enregistre les streams pour que stopDownload puisse les tuer
                            telechargementsActifs[nomSecurise].activeStreams.push({ stream, writeStream });

                            stream.on('data', (chunk) => { 
                                telecharges += chunk.length; 
                                octetsDuChunkTelecharges += chunk.length;
                            });

                            stream.pipe(writeStream);
                            
                            stream.on('end', resolve);
                            stream.on('error', (err) => { writeStream.end(); reject(err); });
                            writeStream.on('error', (err) => { reject(err); });
                        });

                        break; // Succès du chunk, on sort de la boucle de retry

                    } catch (err) {
                        // FIX TÉLÉCHARGEMENT FANTÔME : Si c'est une annulation utilisateur, on sort du retry IMMEDIATEMENT
                        if (downloadController.signal.aborted) {
                            console.log(`[INFO] Chunk ${i} arrêté proprement suite à l'annulation de l'utilisateur.`);
                            break; 
                        }

                        console.warn(`[⚠️ ATTENTION] Chunk ${i} déconnecté (Tentative ${tentative}/${maxRetries}) : ${err.message}. Reprise en cours...`);
                        
                        if (tentative === maxRetries) {
                            downloadController.abort(); 
                            throw new Error(`Le Chunk ${i} a définitivement planté après ${maxRetries} essais.`);
                        }
                        
                        await new Promise(res => setTimeout(res, 2000));
                    }
                }
            })());
        }

        await Promise.all(promises);
        clearInterval(progressInterval); 
        // ... (le reste de ta fusion de fichiers reste identique)

                console.log(`[INFO] Morceaux téléchargés. Fusion ultra-rapide en cours...`);

                event.sender.send('update-download-progress', { 
                    vitesse: "0 Mo/s", 
                    pourcentage: "90%", 
                    actuel: "Disque", 
                    total: "Patientez", 
                    name: nomSecurise 
                });

                // --- FUSION ROBUSTE ---
                const finalStream = fs.createWriteStream(cheminComplet, { highWaterMark: 8 * 1024 * 1024 });
                
                for (const partPath of partFiles) {
                    await new Promise((resolve, reject) => {
                        const readPart = fs.createReadStream(partPath, { highWaterMark: 4 * 1024 * 1024 });
                        readPart.pipe(finalStream, { end: false }); 
                        readPart.on('end', resolve);
                        readPart.on('error', reject);
                    });
                }
                
                await new Promise((resolve, reject) => {
                    finalStream.on('finish', resolve);
                    finalStream.on('error', reject);
                    finalStream.end();
                });

                for (const partPath of partFiles) {
                    if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
                }

            } else {
                // --- MODE CLASSIQUE ULTRA-STABLE ---
                console.log("[INFO] Lancement du mode classique sécurisé...");
                const writeStream = fs.createWriteStream(cheminComplet, { highWaterMark: 1024 * 1024 });
                
                const stream = gotScraping.stream({
                    url: lienChoisi,
                    headers: baseHeaders,
                    signal: downloadController.signal,
                    http2: false,
                    timeout: { request: undefined },
                    retry: {
                        limit: 5,
                        methods: ['GET'],
                        statusCodes: [408, 413, 429, 500, 502, 503, 504],
                        errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EADDRINUSE', 'ECONNREFUSED', 'EPIPE']
                    }
                });

                telechargementsActifs[nomSecurise] = { stream, writeStream, controller: downloadController, cheminFichier: cheminComplet };

                await new Promise((resolve, reject) => {
                    stream.on('data', (chunk) => {
                        telecharges += chunk.length;
                        const readyForMore = writeStream.write(chunk);
                        if (!readyForMore) stream.pause();
                    });

                    writeStream.on('drain', () => { stream.resume(); });
                    stream.on('end', () => { writeStream.end(); });
                    writeStream.on('finish', () => { resolve(); });
                    stream.on('error', (err) => { writeStream.end(); reject(err); });
                    writeStream.on('error', (err) => { reject(err); });
                });

                clearInterval(progressInterval);
            }

            delete telechargementsActifs[nomSecurise];
            console.log(`[SUCCÈS] Téléchargement de ${nomSecurise} terminé !`);

        } catch (error) {
            clearInterval(progressInterval);
            delete telechargementsActifs[nomSecurise];
            return { status: 'error', message: error.message };
        }

        // ==========================================
        // 5. EXTRACTION DU FICHIER .RAR (ASYNCHRONE & FLUIDE 🚀)
        // ==========================================
        console.log(`\n[ÉTAPE 5] Début de l'extraction de : ${nomFichierFinal}`);
        
        const dossierExtraction = path.join(dossierDestination, nomSecurise);
        if (!fs.existsSync(dossierExtraction)) fs.mkdirSync(dossierExtraction, { recursive: true });

        const extractor = await unrar.createExtractorFromFile({ 
            filepath: cheminComplet, 
            targetPath: dossierExtraction 
        });
        
        const infoArc = extractor.getFileList();
        const fileHeaders = [...infoArc.fileHeaders]; 
        const totalFichiers = fileHeaders.length;
        
        console.log(`📦 Nombre de fichiers à extraire : ${totalFichiers}`);

        const extractedFiles = extractor.extract({
            files: (fileHeader) => true
        });

        let fichiersTraites = 0;

        for (const file of extractedFiles.files) {
            fichiersTraites++;
            
            const progressionExtraction = 90 + Math.floor((fichiersTraites / totalFichiers) * 9);

            event.sender.send('update-download-progress', { 
                vitesse: "Désarchivage...", 
                pourcentage: `${progressionExtraction}%`, 
                actuel: `${fichiersTraites}/${totalFichiers} fichiers`, 
                total: "Extraction",
                name: nomSecurise
            });

            if (fichiersTraites % 10 === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        console.log(`📦 Extraction terminée avec succès dans : ${dossierExtraction}`);

        const fichiersExtraits = fs.readdirSync(dossierExtraction);
        if (fichiersExtraits.length === 0) {
            throw new Error("L'extraction semble avoir échoué : aucun fichier trouvé.");
        }

        if (fs.existsSync(cheminComplet)) {
            fs.unlinkSync(cheminComplet);
            console.log(`🗑️ Archive temporaire nettoyée.`);
        }

        // 6. Envoi final des 100%
        const progressFinal = {
            pourcentage: "100%",
            actuel: "Terminé",
            total: "Installé",
            name: nomSecurise,
        };
        event.sender.send('update-download-progress', progressFinal);
        event.sender.send('debut-download', "start");
        
        console.log("✅ Installation terminée !");
        return { status: 'success', path: dossierExtraction };

    } catch (err) {
        console.error("Erreur globale :", err.message);
        return { status: 'error', message: err.message };
    }
});

ipcMain.handle('lister-dossiers-jeux', () => {
    // ✅ CORRECTION 1 : On utilise dossierDestination au lieu de __dirname
    if (!fs.existsSync(dossierDestination)) return [];
    
    // On retourne uniquement les noms des dossiers
    return fs.readdirSync(dossierDestination).filter(file => {
        // ✅ CORRECTION 2 : Ajout de .isDirectory() pour être sûr que c'est un dossier
        return fs.statSync(path.join(dossierDestination, file));
    });
});

ipcMain.handle('uninstallGame', async (event, nomJeu) => {
    try {
        // ✅ CORRECTION : On convertit "Nom du Jeu" en "nom_du_jeu" exactement comme à l'installation
        const nomSecurise = nomJeu ? nomJeu.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_") : "jeu_telecharge";
        const cheminDossierJeu = path.join(dossierDestination, nomSecurise);

        if (fs.existsSync(cheminDossierJeu)) {
            fs.rmSync(cheminDossierJeu, { recursive: true, force: true });
            console.log(`🗑️ Dossier supprimé avec succès : ${cheminDossierJeu}`);
            event.sender.send('debut-download', "start");
            return { status: 'success', message: 'Jeu désinstallé.' };
        } else {
            console.warn(`⚠️ Tentative de suppression d'un dossier inexistant : ${cheminDossierJeu}`);
            return { status: 'error', message: 'Dossier introuvable.' };
        }
    } catch (error) {
        console.error("Erreur lors de la désinstallation :", error.message);
        return { status: 'error', message: error.message };
    }
});

const { spawn } = require('child_process'); // 🚀 On utilise spawn au lieu de exec

ipcMain.handle('copyID', async (event, id) => {
    clipboard.writeText(id)
})
ipcMain.handle('startGame', async (event, nomJeu) => {
    try {
        // const dossierDestination = path.join(__dirname, 'games');
        const nomSecurise = nomJeu ? nomJeu.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_") : "jeu_telecharge";
        const dossierJeu = path.join(dossierDestination, nomSecurise);

        if (!fs.existsSync(dossierJeu)) {
            return { status: 'error', message: 'Dossier du jeu introuvable.' };
        }

        // --- GESTION DU DATA.JSON ---
        let appData = {};
        if (fs.existsSync(dataPath)) {
            try {
                appData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            } catch (e) {
                console.error("Erreur de lecture du data.json, création d'un nouveau.");
            }
        }
        
        // Initialiser le jeu dans le JSON s'il n'existe pas encore (temps en secondes)
        if (!appData[nomJeu]) {
            appData[nomJeu] = { tempsDeJeu: 0 };
        }

        // Fonction récursive pour chercher et analyser TOUS les .exe
function trouverExe(dir, nomJeuCible) {
    let listeExe = [];

    function scannerDossier(dossierActuel) {
        const fichiers = fs.readdirSync(dossierActuel, { withFileTypes: true });
        
        for (const fichier of fichiers) {
            const cheminComplet = path.join(dossierActuel, fichier.name);
            
            if (fichier.isDirectory()) {
                // Blacklist des dossiers à ignorer (optimisation)
                const dossiersIgnores = ['_commonredist', 'redist', 'directx', 'vcredist', 'dotnet', 'extras'];
                if (!dossiersIgnores.includes(fichier.name.toLowerCase())) {
                    scannerDossier(cheminComplet);
                }
            } else if (fichier.name.toLowerCase().endsWith('.exe')) {
                const nomFichier = fichier.name.toLowerCase();
                
                // Blacklist étendue des mots-clés dans le nom du fichier
                const motsInterdits = [
                    'unins', 'crash', 'setup', 'config', 'server', 
                    'tool', 'reporter', 'benchmark', 'updater', 'redist'
                ];
                
                const contientMotInterdit = motsInterdits.some(mot => nomFichier.includes(mot));
                
                if (!contientMotInterdit) {
                    listeExe.push(cheminComplet);
                }
            }
        }
    }

    // Lancer le scan
    scannerDossier(dir);

    // S'il n'y a rien ou un seul exécutable valide, le choix est vite fait
    if (listeExe.length === 0) return null;
    if (listeExe.length === 1) return listeExe[0];

    // --- STRATÉGIE DE TRI S'IL Y A PLUSIEURS .EXE ---
    
    // 1. Essayer de faire correspondre le nom du fichier au nom du jeu
    // On enlève les espaces et caractères spéciaux pour comparer
    const nomJeuNettoye = nomJeuCible.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    for (const exe of listeExe) {
        const nomExeBrut = path.basename(exe).toLowerCase().replace(/[^a-z0-9]/g, "");
        // Si le nom du jeu est dans le nom de l'exe, ou inversement
        if (nomExeBrut.includes(nomJeuNettoye) || (nomJeuNettoye !== "" && nomJeuNettoye.includes(nomExeBrut))) {
            return exe;
        }
    }

    // 2. Fallback (Plan B) : Prendre le .exe avec la taille de fichier la plus grande
    // Le jeu complet fait souvent des dizaines de Mo, contrairement aux petits utilitaires
    let plusGrosExe = listeExe[0];
    let tailleMax = 0;
    
    for (const exe of listeExe) {
        try {
            const stats = fs.statSync(exe);
            if (stats.size > tailleMax) {
                tailleMax = stats.size;
                plusGrosExe = exe;
            }
        } catch (e) {
            console.error(`Impossible de lire la taille de ${exe}`);
        }
    }

    return plusGrosExe;
}

// Utilisation (n'oublie pas de lui passer le nom du jeu !)
const executable = trouverExe(dossierJeu, nomJeu);

        if (executable) {
            console.log(`🚀 Lancement et tracking du jeu : ${executable}`);
            
            // --- MINIMISER LA FENÊTRE ELECTRON ---
            const fenetreActive = BrowserWindow.fromWebContents(event.sender);
            if (fenetreActive) {
                fenetreActive.minimize();
            }
            
            // On lance le processus avec spawn, détaché pour éviter les blocages de buffers
            const jeuProcess = spawn(`"${executable}"`, [], { 
                cwd: path.dirname(executable),
                shell: true,
                detached: true 
            });

            // --- TRACKER TOUTES LES 3 SECONDES ---
            let trackerInterval = setInterval(() => {
                // On vérifie si le processus a un PID et s'il tourne encore
                if (jeuProcess && jeuProcess.pid) {
                    try {
                        process.kill(jeuProcess.pid, 0); 
                        
                        // Le jeu tourne encore -> On met à jour le temps de jeu (+ 3 secondes)
                        appData[nomJeu].tempsDeJeu += 3;
                        
                        // Sauvegarde dans le JSON (synchrone pour un tout petit fichier c'est parfait)
                        fs.writeFileSync(dataPath, JSON.stringify(appData, null, 4));

                        // On envoie l'info au Front (script.js) avec le temps de jeu mis à jour !
                        event.sender.send('game-status-tracking', { 
                            status: 'running', 
                            nomJeu: nomJeu,
                            pid: jeuProcess.pid,
                            tempsDeJeu: appData[nomJeu].tempsDeJeu // Tu pourras l'afficher côté Front !
                        });
                    } catch (e) {
                        // Si ça lève une erreur, c'est que le PID n'existe plus (jeu fermé)
                        clearInterval(trackerInterval);
                        event.sender.send('game-status-tracking', { status: 'stopped', nomJeu: nomJeu });
                        
                        // Optionnel : Restaurer la fenêtre quand le jeu est fermé
                        if (fenetreActive && fenetreActive.isMinimized()) fenetreActive.restore();
                    }
                } else {
                    event.sender.send('game-status-tracking', { status: 'stopped', nomJeu: nomJeu });
                    clearInterval(trackerInterval);
                }
            }, 3000); // 3000ms = 3 secondes

            // Sécurité additionnelle si Node détecte la fermeture en direct
            jeuProcess.on('exit', () => {
                clearInterval(trackerInterval);
                event.sender.send('game-status-tracking', { status: 'stopped', nomJeu: nomJeu });
                if (fenetreActive && fenetreActive.isMinimized()) fenetreActive.restore();
            });

            return { status: 'success' };
        } else {
            return { status: 'error', message: 'Aucun exécutable trouvé.' };
        }

    } catch (error) {
        console.error("Erreur globale startGame :", error);
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('stopDownload', async (event, nomJeu) => {
    try {
        const nomSecurise = nomJeu ? nomJeu.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_") : "jeu_telecharge";
        const telechargement = telechargementsActifs[nomSecurise];

        if (!telechargement) {
            return { status: 'error', message: 'Aucun téléchargement actif trouvé.' };
        }

        // 1. Nettoyage des processus (inchangé)
        if (telechargement.stream?.destroy) telechargement.stream.destroy();
        if (telechargement.process?.kill) try { telechargement.process.kill('SIGINT'); } catch (e) {}
        if (telechargement.controller) try { telechargement.controller.abort(); } catch (e) {}
        if (telechargement.writeStream) telechargement.writeStream.close();

        await new Promise(resolve => setTimeout(resolve, 800)); // Pause augmentée pour libérer les verrous Windows

        const dossierBase = path.dirname(telechargement.cheminFichier);
        const nomBase = path.basename(telechargement.cheminFichier, path.extname(telechargement.cheminFichier));

        // 2. Suppression du fichier principal et des parties (.part0 à .part9)
        const fichiersASupprimer = fs.readdirSync(dossierBase).filter(file => {
            return file.startsWith(nomBase) && (file.endsWith('.rar') || file.includes('.part'));
        });

        fichiersASupprimer.forEach(file => {
            const p = path.join(dossierBase, file);
            if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                console.log(`🗑️ Supprimé : ${file}`);
            }
        });

        // 3. Suppression du dossier vide associé s'il existe
        // On suppose que le dossier a le même nom que le jeu
        const dossierJeu = path.join(dossierBase, nomSecurise); 
        if (fs.existsSync(dossierJeu) && fs.lstatSync(dossierJeu).isDirectory()) {
            const contenu = fs.readdirSync(dossierJeu);
            if (contenu.length === 0) {
                fs.rmdirSync(dossierJeu);
                console.log(`📁 Dossier vide supprimé : ${dossierJeu}`);
            }
        }

        delete telechargementsActifs[nomSecurise];
        event.sender.send('debut-download', "start");

        return { status: 'success', message: 'Nettoyage complet effectué.' };

    } catch (error) {
        console.error("Erreur lors de l'arrêt :", error);
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('getGameData', async (event, urlRecue, nom) => {
    try {
        console.log(`[SCRAPING] Tentative de récupération des données : ${urlRecue}`);

        // 1. Importation dynamique de got-scraping
        const { gotScraping } = await import('got-scraping');

        // 2. Requête sécurisée anti-403 utilisant HTTP/2
        const responseSteamRip = await gotScraping({ 
            url: urlRecue, 
            http2: true 
        });

        // 3. Chargement du HTML
        const $ = cheerio.load(responseSteamRip.body);

        let gameSize = null;
        let version = null;
        let servers = [];
        let mainImage = null;
        let previews = [];

        const contenuBrut = fs.readFileSync(dataPath, 'utf-8');
        donneesParties = JSON.parse(contenuBrut);

        // Helper pour formater les URLs relatives en absolues (rajoute https://steamrip.com devant si besoin)
        const getAbsoluteUrl = (path) => {
            if (!path) return null;
            try {
                return new URL(path, urlRecue).href;
            } catch (e) {
                return path;
            }
        };

        // 4. Parcourir tous les éléments <li> de la page pour extraire les infos
        $('li').each((index, element) => {
            const textComplet = $(element).text().trim();

            if (textComplet.toLowerCase().includes('game size:')) {
                gameSize = textComplet.replace(/game size:/i, '').trim();
            }

            if (textComplet.toLowerCase().includes('version:')) {
                version = textComplet.replace(/version:/i, '').trim();
            }
        });

        // 5. Récupération des noms de serveurs
        $('a.shortc-button').each((index, element) => {
            const buttonText = $(element).text().trim();
            
            if (buttonText.toUpperCase() === 'DOWNLOAD HERE') {
                let rawServerName = $(element).parent().text().replace(/DOWNLOAD HERE/ig, '').trim();
                
                if (rawServerName) {
                    const formattedName = rawServerName.charAt(0).toUpperCase() + rawServerName.slice(1).toLowerCase();
                    if (!servers.includes(formattedName)) {
                        servers.push(formattedName);
                    }
                }
            }
        });

        const mainImgElement = $('figure.single-featured-image img');
        let rawMainImage = mainImgElement.attr('src');

        // Si l'image est en Base64 (commence par "data:image") ou absente, on ruse :
        if (!rawMainImage || rawMainImage.startsWith('data:')) {
            const srcset = mainImgElement.attr('srcset');
            const dataSrc = mainImgElement.attr('data-src') || mainImgElement.attr('data-lazy-src');

            if (srcset) {
                // Le srcset ressemble à : "url_1 1280w, url_2 300w". 
                // On prend le premier élément de la liste, puis on isole l'URL avant l'espace.
                rawMainImage = srcset.split(',')[0].trim().split(' ')[0];
            } else if (dataSrc) {
                // Alternative si le site utilise un attribut data-src standard
                rawMainImage = dataSrc;
            }
        }

        if (rawMainImage) {
            mainImage = getAbsoluteUrl(rawMainImage);
        }

        // 7. Récupération des previews
        // On cible les images avec la classe 'alignnone', puis on cherche le href du parent <a> pour la HD
        $('img.alignnone').each((index, element) => {
            const parentAnchor = $(element).parent('a').attr('href');
            // Si le parent <a> n'a pas de href, on se rabat sur le src de l'image
            const imgSrc = parentAnchor || $(element).attr('src'); 
            
            if (imgSrc) {
                previews.push(getAbsoluteUrl(imgSrc));
            }
        });

        console.log(`[SUCCÈS] Données récupérées - Size: ${gameSize} | Version: ${version} | Images trouvées: ${previews.length + (mainImage ? 1 : 0)}`);

        // 8. Retour des valeurs (converties automatiquement en JSON via l'IPC)
        // console.log(mainImage)
        return {
            success: true,
            gameSize: gameSize || "Non trouvé",
            version: version || "Non trouvé",
            servers: servers.length > 0 ? servers : ["/."],
            mainImage: mainImage || "Non trouvé",
            previews: previews.length > 0 ? previews : [],
            playTime: donneesParties[nom] ? donneesParties[nom].tempsDeJeu : "0"
        };

    } catch (error) {
        console.error("❌ Erreur lors du scraping :", error.message);
        return {
            success: false,
            error: error.message
        };
    }
});

const { autoUpdater } = require("electron-updater");

// Vérifier les mises à jour au lancement
autoUpdater.checkForUpdatesAndNotify();

// Écouter les événements pour notifier le front
autoUpdater.on('update-available', () => {
    mainWindow.webContents.send('update_available');
});

autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update_downloaded');
});

// Permettre au front de demander l'installation après téléchargement
ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.on('minimize-window', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.on('openFolder', async () => {
    // 📂 'userData' pointe directement vers AppData/Roaming/[NomDeTonApp]
    const cheminDossierGames = path.join(app.getPath('userData'), 'games');

    console.log(`📂 [Main] Tentative d'ouverture du dossier : ${cheminDossierGames}`);

    try {
        // 🛠️ SÉCURITÉ : Si le dossier n'existe pas encore, on le crée
        if (!fs.existsSync(cheminDossierGames)) {
            fs.mkdirSync(cheminDossierGames, { recursive: true });
            console.log("📁 Le dossier 'games' n'existait pas, il a été créé avec succès.");
        }

        // 🚀 Ouvre le dossier dans l'explorateur Windows (ou le Finder sur Mac)
        await shell.openPath(cheminDossierGames);

    } catch (error) {
        console.error("❌ Impossible d'ouvrir ou de créer le dossier :", error);
    }
});

ipcMain.handle('charger-games-json', async () => {
    const userDataPath = app.getPath('userData');
    const jsonFile = path.join(userDataPath, 'games.json');

    if (fs.existsSync(jsonFile)) {
        try {
            const data = fs.readFileSync(jsonFile, 'utf-8');
            return JSON.parse(data); // On renvoie les données converties en objet
        } catch (error) {
            console.error("Erreur lors de la lecture du JSON :", error);
            return {}; // En cas d'erreur, on renvoie un objet vide
        }
    }
    return {}; // Si le fichier n'existe pas encore
});