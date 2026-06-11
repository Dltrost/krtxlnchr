// --- VARIABLES GLOBALES DE STOCKAGE ---
let catalogueGames = [];       // Contient la totalité des jeux bruts
let nomsInstalleGlobal = [];   // Dossiers installés normalisés
let nomsEnRarGlobal = [];      // Téléchargements en cours normalisés

// ⚙️ VARIABLES POUR LE RENDU PROGRESSIF (ANTI-LAG)
let listeAfficheeActuelle = []; // Liste filtrée/triée en cours de lecture
let indexAffichage = 0;         // Jusqu'où on est rendu dans l'affichage
const TAILLE_VAGUE = 60;        // Nombre de jeux affichés par vague
let observateurSentinelle = null;

// Fonction pour transformer un nom de jeu en nom de dossier normalisé
function normaliserNomJeu(nom) {
    return nom.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function getPoids(gameName) {
    const nom = normaliserNomJeu(gameName);
    if (nomsInstalleGlobal.includes(nom)) return 3;
    if (nomsEnRarGlobal.includes(nom)) return 2;
    return 1;
}

// Fonction helper pour générer proprement le HTML d'une seule carte
function genererHTMLCarteJeu(gameData, estInstalle, estEnDownload) {
    const nomNormalise = normaliserNomJeu(gameData.gameName);
    
    // 💡 ASTUCE PERF : On met l'image directement si on est dans les premières vagues, 
    // ou on laisse le navigateur gérer le décodage asynchrone.
    return `
        <div class="game-inner-box ${estInstalle ? 'downloaded' : ''}" id="${nomNormalise}" name="${estInstalle ? 'downloaded' : estEnDownload ? "downloading" : 'uninstalled'}" data-gameurl="${gameData.url}">
            <div class="ingame" id="${nomNormalise}_ingame" style="display: none;"></div>
            <div onclick="gameSelected('${gameData.url}','${gameData.gameName}', this)" class="background-container" id="${nomNormalise}_ingame_scale" style="scale:1; opacity:${estInstalle ? '100%' : '48%'}">
                <div class="background ${estInstalle ? 'downloaded' : ''}" style="background-image: url('${gameData.imageLink}');"></div>
            </div>
            
            <button class="downloadButton" style="display:${!estInstalle && !estEnDownload ? 'block' : 'none'};" onclick="downloadgame('${gameData.url}', '${gameData.gameName}', this)">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-icon lucide-download"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>
            </button>
            <button onclick="play('${nomNormalise}', this)" style="display:${estInstalle && !estEnDownload ? 'block' : 'none'};"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play-icon lucide-play"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg></button>
            <button onclick="stopDownload('${nomNormalise}', this)" style="display:${estEnDownload ? 'block' : 'none'};"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-icon lucide-square"><rect width="18" height="18" x="3" y="3" rx="2"/></svg></button>
            <button onclick="uninstall('${nomNormalise}', this)" class="uninstall" style="display:${estInstalle ? 'block' : 'none'}; color: red;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
    `;
}

// 1. Chargement initial des données
async function loadCatalogue() {
    closegame()
    const games = await window.electronAPI.chargerGamesJson();
    const dossierJeuxExistants = await window.electronAPI.listerDossiersJeux();
    
    nomsInstalleGlobal = dossierJeuxExistants
        .filter(d => !d.endsWith('.rar'))
        .map(d => normaliserNomJeu(d));

    nomsEnRarGlobal = dossierJeuxExistants
        .filter(d => d.endsWith('.rar.part0'))
        .map(d => normaliserNomJeu(d.replace('.rar.part0', '')));

    // Tri par poids initial automatique
    catalogueGames = Object.values(games).sort((a, b) => getPoids(b.gameName) - getPoids(a.gameName));

    // On délègue immédiatement au moteur de rendu optimisé
    renderCatalogue();
}

// 2. Moteur de rendu principal (Calcul les filtres et prépare la structure)
function renderCatalogue(filterText = '') {
    const q = String(filterText || '').trim().toLowerCase();
    const sortByNameCheckbox = document.getElementById('sortByName');

    // Étape A : Filtrage
    let liste = catalogueGames.slice();
    if (q.length) {
        liste = liste.filter(g => g.gameName.toLowerCase().includes(q));
    }

    // Étape B : Tri
    if (sortByNameCheckbox && sortByNameCheckbox.checked) {
        liste.sort((a, b) => a.gameName.localeCompare(b.gameName, 'fr', { sensitivity: 'base' }));
    } else {
        liste.sort((a, b) => getPoids(b.gameName) - getPoids(a.gameName));
    }

    // Étape C : Reset de l'affichage progressif
    listeAfficheeActuelle = liste;
    indexAffichage = 0;

    // On nettoie le catalogue et on y injecte une zone pour les jeux + une sentinelle invisible tout au fond
    document.getElementById('catalogue').innerHTML = `
        <div id="grid-container-jeux"></div>
        <div id="sentinelle-scroll" style="height: 50px; width: 100%; clear: both;"></div>
    `;

    // On lance la première vague d'affichage
    injecterProchaineVague();
    
    // On active l'écouteur de scroll intelligent sur la sentinelle
    activerInfiniteScroll();
}

// 3. Injecteur de vagues HTML (N'ajoute que 60 éléments à la fois)
function injecterProchaineVague() {
    const conteneurGrid = document.getElementById('grid-container-jeux');
    if (!conteneurGrid || indexAffichage >= listeAfficheeActuelle.length) return;

    const fin = Math.min(indexAffichage + TAILLE_VAGUE, listeAfficheeActuelle.length);
    let htmlVague = '';

    for (let i = indexAffichage; i < fin; i++) {
        const gameData = listeAfficheeActuelle[i];
        const nomNormalise = normaliserNomJeu(gameData.gameName);
        const estInstalle = nomsInstalleGlobal.includes(nomNormalise);
        const estEnDownload = nomsEnRarGlobal.includes(nomNormalise);

        htmlVague += genererHTMLCarteJeu(gameData, estInstalle, estEnDownload);
    }

    // On AJOUTE (+=) au lieu de tout écraser, ce qui évite au navigateur de tout recalculer
    conteneurGrid.insertAdjacentHTML('beforeend', htmlVague);
    indexAffichage = fin;
}

// 4. L'observateur qui détecte quand on arrive en bas de page
function activerInfiniteScroll() {
    // Si un ancien observateur existait, on le déconnecte pour éviter les fuites de mémoire
    if (observateurSentinelle) {
        observateurSentinelle.disconnect();
    }

    const sentinelle = document.getElementById('sentinelle-scroll');
    if (!sentinelle) return;

    const options = {
        root: document.getElementById('catalogue'), // Fenêtre de scroll
        rootMargin: '400px', // Déclenche le chargement 400px AVANT d'arriver tout en bas (invisible pour l'utilisateur)
        threshold: 0.01
    };

    observateurSentinelle = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            // Si la sentinelle entre dans le champ de vision, on charge la suite
            if (entry.isIntersecting) {
                injecterProchaineVague();
                
                // Si on a tout affiché, on peut arrêter d'observer
                if (indexAffichage >= listeAfficheeActuelle.length) {
                    observateurSentinelle.unobserve(sentinelle);
                }
            }
        });
    }, options);

    observateurSentinelle.observe(sentinelle);
}

// Hook pour la recherche en direct et le tri au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search');
    const sortByName = document.getElementById('sortByName');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderCatalogue(e.target.value));
    }
    if (sortByName) {
        sortByName.addEventListener('change', () => renderCatalogue(searchInput ? searchInput.value : ''));
    }

    loadCatalogue();
});



////////////////////////////////
////////////////////////////////
////////////////////////////////
////////////////////////////////
////////////////////////////////
////////////////////////////////

async function downloadgame(nomDuJeu, name, element = null) {
    // 1. Changement des styles visuels
    window.api.envoyerMessage(nomDuJeu, name);
    element.style.scale = 0;
    // element.style.width = "86%"; // Ajout des guillemets pour la propreté CSS
    // element.style.margin = "11px";
    
    // const gameDataEl = element.parentElement.getElementsByClassName('gameData')[0];
    // // if (gameDataEl) {
    //     gameDataEl.style.opacity = "1";
    //     gameDataEl.style.height = "88px";
    //     gameDataEl.style.width = "91.8%";
    // // }

    // // 2. Changement de la fonction au clic
    // element.onclick = function() {
    //     finalDownload(nomDuJeu, name, element);
    // };

    // // 3. Récupération des données (Appel asynchrone)
    // updateData(nomDuJeu, name, element);

    // // 4. Reset quand la souris quitte le parent
    // // { once: true } permet de supprimer automatiquement l'écouteur après déclenchement
    // element.parentElement.addEventListener('mouseleave', function() {
    //     element.style.width = "";
    //     element.style.margin = "";
        
    //     if (gameDataEl) {
    //         gameDataEl.style.opacity = "";
    //         gameDataEl.style.height = "";
    //         gameDataEl.style.width = "";
    //     }
        
    //     // On remet la fonction d'origine pour le prochain clic
    //     element.onclick = function() {
    //         downloadgame(nomDuJeu, name, element);
    //     };
    // }, { once: true }); 
}

async function finalDownload(nomDuJeu, name, element){
    try {
        window.api.envoyerMessage(nomDuJeu, name);
    } catch (error) {
        console.error("Erreur lors de la communication :", error);
    }
}

function formaterTemps(secondes) {
    // Calcul des différentes unités
    const jours = Math.floor(secondes / (3600 * 24));
    const heures = Math.floor((secondes % (3600 * 24)) / 3600);
    const minutes = Math.floor((secondes % 3600) / 60);

    let resultat = [];

    // On n'ajoute les unités que si elles sont supérieures à 0
    if (jours > 0) resultat.push(`${jours}j`);
    if (heures > 0) resultat.push(`${heures}h`);
    if (minutes > 0) resultat.push(`${minutes}min`);

    // Si le temps est inférieur à 1 minute, on affiche au moins 0min
    return resultat.length > 0 ? resultat.join(' ') : "0min";
}

function couperTexte(texte) {
    if (texte.length > 30) {
        return texte.substring(0, 30) + "...";
    }
    return texte;
}


// CORRECTION ICI : Ajout du 'async' devant la fonction
async function updateData(nomDuJeu, name){
    try {
        // CORRECTION ICI : Pas de .json(), la réponse arrive déjà sous forme d'objet propre
        const data = await window.api.getGameData(nomDuJeu, normaliserNomJeu(name));
        

        if (data && data.success) {
            // alert(data.mainImage)
            // Sélection sécurisée des éléments pour injecter le texte textuel récupéré par Cheerio
            document.getElementById('copyID').onclick = function() {
                copygamename(`${normaliserNomJeu(name)}`)
            }
            document.getElementById('game-size').innerHTML = data.gameSize || "/.";
            document.getElementById('game-version').innerHTML = couperTexte(data.version) || "/.";
            document.getElementById('game-server').innerHTML = couperTexte(data.servers.join(", ")) || "/.";
            document.getElementById('pv').style.backgroundImage = `url('${data.mainImage}')` || "";
            document.getElementById('pv1').style.backgroundImage = `url('${data.previews[0]}')` || "";
            document.getElementById('pv2').style.backgroundImage = `url('${data.previews[1]}')` || "";
            document.getElementById('game-id').innerHTML = couperTexte(normaliserNomJeu(name));
            document.getElementById('game-time').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock8-icon lucide-clock-8"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l-4 2"/></svg>${formaterTemps(data.playTime)}`
        } else {
            console.error("Le scraping a échoué :", data.error);
        }
    } catch (err) {
        console.error("Erreur updateData :", err);
    }
}

async function copygamename(id) {
    // alert(id)
    await window.api.copyID(id);
    document.getElementById('copyID').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>`
    setTimeout(()=>{
        document.getElementById('copyID').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    },1000)
}

function gameSelected(url, name, game) { 
    document.getElementById('uninstallbtn').onclick = function() {
        // alert(normaliserNomJeu(name))
        uninstall(normaliserNomJeu(name))
    }
    document.getElementById('startbtn').onclick = function() {
        // alert(normaliserNomJeu(name))
        window.api.startGame(normaliserNomJeu(name));
    }
    document.getElementById('stopdownloadbtn').onclick = function() {
        // alert(normaliserNomJeu(name))
        closegame()
        window.api.stopDownload(normaliserNomJeu(name));
    }
    document.getElementById('downloadbtn').onclick = function() {
        // alert(normaliserNomJeu(name))
        const gameName = normaliserNomJeu(name)
        // alert(document.getElementById(gameName).dataset.gameurl)
        closegame()
        window.api.envoyerMessage(document.getElementById(gameName).dataset.gameurl, gameName);
    }
    // alert(document.getElementById(normaliserNomJeu(name)).getAttribute('name'))
    if ( document.getElementById(normaliserNomJeu(name)).getAttribute('name') == "downloaded" ) {
        document.getElementById('uninstallbtn').style.display = "inline-flex"
        document.getElementById('startbtn').style.display = "inline-flex"
        document.getElementById('downloadbtn').style.display = "none"
        document.getElementById('stopdownloadbtn').style.display = "none"
    } else if ( document.getElementById(normaliserNomJeu(name)).getAttribute('name') == "downloading" ) {
        document.getElementById('uninstallbtn').style.display = "none"
        document.getElementById('startbtn').style.display = "none"
        document.getElementById('downloadbtn').style.display = "none"
        document.getElementById('stopdownloadbtn').style.display = "inline-flex"
    } else {
        document.getElementById('uninstallbtn').style.display = "none"
        document.getElementById('startbtn').style.display = "none"
        document.getElementById('downloadbtn').style.display = "inline-flex"
        document.getElementById('stopdownloadbtn').style.display = "none"
    }
    document.getElementById('game-info').style.pointerEvents = "all";
            document.getElementById('game-info').style.opacity = 1;
    updateData(url, name)
    // .getElementsByClassName("background-container")[0]
    // game.style.scale = "1.56 1.05";
    // game.getElementsByClassName("background-container")[0].style.scale = "0.64 0.95";
} 

function closegame(){
    
    document.getElementById('game-info').style.opacity = 0;
    setTimeout(()=>{
        document.getElementById('game-size').innerHTML = "/.";
        document.getElementById('game-version').innerHTML = "/.";
        document.getElementById('game-server').innerHTML = "/.";
        document.getElementById('pv').style.backgroundImage = "";
        document.getElementById('pv1').style.backgroundImage = "";
        document.getElementById('pv2').style.backgroundImage = "";
        document.getElementById('game-id').innerHTML = "";
        document.getElementById('game-info').style.pointerEvents = "none";
    },400)
}


async function uninstall(nomDuJeu, element = null) {
    window.api.uninstallGame(nomDuJeu);
    closegame()
    element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="loadingsvg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
}

async function play(nomDuJeu, element) {
    window.api.startGame(nomDuJeu);
}

async function stopDownload(nomDuJeu, element) {
    window.api.stopDownload(nomDuJeu);
}

// async function copyID(id) {
//     clipboard.writeText(id);
// }




// Dans ton script.js
window.electronAPI.onDownloadProgress((data) => {
    document.getElementById(data.name).style.setProperty('--chargement-pourcent', 100 - parseFloat(data.pourcentage)+'%');
    document.getElementById('internetSpeed').innerHTML = data.vitesse;
    // Exemple d'utilisation :
    // const elementPourcentage = document.getElementById('pourcentage');
    // const elementInfos = document.getElementById('infos-mo');

    // if (elementPourcentage) elementPourcentage.innerText = data.pourcentage;
    // if (elementInfos) elementInfos.innerText = `${data.actuel} / ${data.total}`;
});

window.electronAPI.downloadstart((message) => {
    loadCatalogue()
});

window.electronAPI.onGameStatus((event, data) => {
    if (data.status === 'running') {
        document.getElementById(`${data.nomJeu}_ingame`).style.display = "block";
        document.getElementById(`${data.nomJeu}_ingame_scale`).style.scale = "0.98";
    } 
    else if (data.status === 'stopped') {
        document.getElementById(`${data.nomJeu}_ingame`).style.display = "none";
        document.getElementById(`${data.nomJeu}_ingame_scale`).style.scale = "";
    }
});

window.electronAPI.onUpdateAvailable(() => {
    alert("Une nouvelle version est disponible ! Elle va être téléchargée en arrière-plan.");
});

window.electronAPI.onUpdateDownloaded(() => {
    if(confirm("Mise à jour prête ! Voulez-vous redémarrer pour l'installer ?")) {
        window.electronAPI.restartApp();
    }
});

function updateGame(element) {
    document.getElementById('catalogue-container').style.opacity = "0";
    document.getElementById('catalogue-container').style.scale = "0.95";
    document.getElementById('search-wrap').style.opacity = "0";
    document.getElementById('search-wrap').style.scale = "0.95";
    setTimeout(()=>{document.getElementById('catalogue-container').style.pointerEvents = "none";},0)
    setTimeout(()=>{document.getElementById('catalogue-container').style.display = "none";},200)
    setTimeout(()=>{
        document.getElementById('update-content').style.opacity = "1";
        document.getElementById('update-content').style.scale = "1";
    },200)
    setTimeout(()=>{
        window.electronAPI.demarrerScraping();
    },1000)
}

// 👈 Écoute le signal de fin
window.electronAPI.onScrapingTermine(() => {
    document.getElementById('catalogue-container').style.display = "block";
    setTimeout(()=>{
        document.getElementById('update-content').style.opacity = "";
        document.getElementById('update-content').style.scale = "";
    },400)
    setTimeout(()=>{
        document.getElementById('catalogue-container').style.pointerEvents = "all";
        document.getElementById('catalogue-container').style.opacity = "";
        document.getElementById('catalogue-container').style.scale = "";
        document.getElementById('search-wrap').style.opacity = "";
        document.getElementById('search-wrap').style.scale = "";
    },1000)
});

// 1. Gestion de la file d'attente (Queue)
const fileAttenteJeux = [];

// Dès qu'un jeu arrive, on le pousse simplement dans la liste d'attente
window.electronAPI.onNouveauJeu((gameObj) => {
    if (Math.random() < 0.125) {
        fileAttenteJeux.push(gameObj);
    }
});

// Toutes les 200ms, si la liste n'est pas vide, on pop le premier jeu et on l'anime
setInterval(() => {
    if (fileAttenteJeux.length > 0) {
        const prochainJeu = fileAttenteJeux.shift();
        propulserCarteJeu(prochainJeu);
    }
}, 10);


// 2. Le moteur d'animation physique "Confetti"
function propulserCarteJeu(gameObj) {
    // =========================================================================
    // 🎛️ LE GRAND TABLEAU DE BORD (Modifie les valeurs ici pour tout contrôler)
    // =========================================================================
    const REGLAGES = {
        // 1. HAUTEUR DU SAUT (Plus les forces sont grandes, plus le jeu monte haut)
        forceMonteeMin: 10,       // Impulsion minimale vers le haut
        forceMonteeMax: 17,       // Impulsion maximale vers le haut
        gravite: 0.14,            // Poids de la carte (plus bas = flotte dans l'air, plus haut = retombe vite)

        // 2. VITESSE HORIZONTALE (Sens gauche / droite)
        vitesseGaucheDroiteMin: 0.3,  // Vitesse de dérive minimale (en pixels/frame)
        vitesseGaucheDroiteMax: 2,  // Vitesse de dérive maximale (en pixels/frame)

        // 3. ROTATIONS (Les angles et le spin)
        angleInitialMax: 15,      // Inclinaison max de la carte au pop (en degrés)
        vitesseSpinMin: 0.15,     // Vitesse de rotation minimale
        vitesseSpinMax: 0.6       // Vitesse de rotation maximale
    };
    // =========================================================================

    // Vérifie ou crée le conteneur d'animation global
    let overlay = document.getElementById('animation-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'animation-overlay';
        document.body.appendChild(overlay);
    }

    // Création de la carte
    const card = document.createElement('div');
    card.className = 'confetti-game-card';
    card.style.backgroundImage = `url('${gameObj.data.imageLink}')`;

    // Couleur des lights aléatoire
    const couleursGlow = ['#00f2fe', '#4facfe', '#ff007f', '#ff00ff', '#00ff87', '#f9d423'];
    const couleurAleatoire = couleursGlow[Math.floor(Math.random() * couleursGlow.length)];
    card.style.setProperty('--glow-color', couleurAleatoire);

    overlay.appendChild(card);

    const largeurEcran = window.innerWidth;
    const hauteurEcran = window.innerHeight;

    // Position de départ (légèrement sous l'écran)
    let x = (largeurEcran / 2) - 65; 
    let y = hauteurEcran + 50; 

    // Choix du côté (gauche ou droite)
    const partADroite = Math.random() > 0.5;

    // --- APPLICATION DIRECTE DE TES RÉGLAGES ---
    
    // Calcul de la vitesse horizontale selon tes bornes Min/Max
    let vitesseX = (Math.random() * (REGLAGES.vitesseGaucheDroiteMax - REGLAGES.vitesseGaucheDroiteMin) + REGLAGES.vitesseGaucheDroiteMin) * (partADroite ? 1 : -1);

    // Calcul de la force de montée (Vitesse Y négative pour monter)
    let vitesseY = -(Math.random() * (REGLAGES.forceMonteeMax - REGLAGES.forceMonteeMin) + REGLAGES.forceMonteeMin); 

    // Calcul de l'angle et de la vitesse de rotation
    let angleRotation = (Math.random() * REGLAGES.angleInitialMax) * (partADroite ? 1 : -1); 
    let vitesseRotation = (Math.random() * (REGLAGES.vitesseSpinMax - REGLAGES.vitesseSpinMin) + REGLAGES.vitesseSpinMin) * (partADroite ? 1 : -1); 

    let aQuitteLeBas = false;

    // Boucle de physique
    function loop() {
        x += vitesseX;
        vitesseY += REGLAGES.gravite; // La gravité freine la montée
        y += vitesseY;
        angleRotation += vitesseRotation;

        card.style.transform = `translate(${x}px, ${y}px) rotate(${angleRotation}deg)`;

        if (y < hauteurEcran) {
            aQuitteLeBas = true;
        }

        // Nettoyage de la carte quand elle sort par le bas
        if (aQuitteLeBas && y > hauteurEcran + 250) {
            card.remove(); 
        } else {
            requestAnimationFrame(loop); 
        }
    }

    requestAnimationFrame(loop);
}

window.electronAPI.onProgression((pourcentage) => {
    console.log(`📊 Progression : ${pourcentage}%`);
    const textePourcent = document.getElementById('loadingpourcentage')
    // Met à jour le texte du pourcentage
    if (textePourcent) {
        textePourcent.innerText = `${pourcentage}%`;
    }
});
