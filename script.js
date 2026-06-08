// Fonction pour transformer un nom de jeu en nom de dossier normalisé
function normaliserNomJeu(nom) {
    // Remplace les caractères non alphanumériques par '_'
    return nom.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

let catalogueGames = [];
let nomsInstalleGlobal = [];
let nomsEnRarGlobal = [];

function getPoids(gameName) {
    const nom = normaliserNomJeu(gameName);
    if (nomsInstalleGlobal.includes(nom)) return 3;
    if (nomsEnRarGlobal.includes(nom)) return 2;
    return 1;
}

async function loadCatalogue() {
    const reponse = await fetch('./games.json');
    const games = await reponse.json();
    
    const dossierJeuxExistants = await window.electronAPI.listerDossiersJeux();
    
    // On crée deux listes distinctes pour bien les identifier
    const nomsInstalle = dossierJeuxExistants
        .filter(d => !d.endsWith('.rar'))
        .map(d => normaliserNomJeu(d));

    const nomsEnRar = dossierJeuxExistants
        .filter(d => d.endsWith('.rar.part0'))
        .map(d => normaliserNomJeu(d.replace('.rar.part0', '')));

    nomsInstalleGlobal = nomsInstalle;
    nomsEnRarGlobal = nomsEnRar;

    // Le tri initial par poids
    const jeuxTries = Object.values(games).sort((a, b) => {
        return getPoids(b.gameName) - getPoids(a.gameName);
    });

    catalogueGames = jeuxTries;

    // On affiche la liste (par défaut triée par poids)
    let catalogueHTML = ``;
    
    for (let gameData of jeuxTries) {
        const nomNormalise = normaliserNomJeu(gameData.gameName);
        
        // On vérifie maintenant avec nos nouvelles listes
        const estInstalle = nomsInstalle.includes(nomNormalise);
        const estEnDownload = nomsEnRar.includes(nomNormalise);
        // ${estInstalle ? 'downloaded' : ''}
        catalogueHTML += `
            <div onclick="gameSelected(this)" class="game-inner-box ${estInstalle ? 'downloaded' : ''}" id="${normaliserNomJeu(gameData.gameName)}">
                <div class="ingame" id="${normaliserNomJeu(gameData.gameName)}_ingame" style="display: none;"></div>
                <div class="background-container" id="${normaliserNomJeu(gameData.gameName)}_ingame_scale" style="scale:1;"><div class="background ${estInstalle ? 'downloaded' : ''}" style="background-image: url('${gameData.imageLink}');" data-bg="${gameData.imageLink}"></div></div>
                
                <button style="display:${!estInstalle && !estEnDownload ? 'block' : 'none'};" onclick="downloadgame('${gameData.url}', '${gameData.gameName}', this)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-icon lucide-download"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>
                </button>
                <button onclick="play('${normaliserNomJeu(gameData.gameName)}', this)" style="display:${estInstalle && !estEnDownload ? 'block' : 'none'};"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play-icon lucide-play"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg></button>
                <button onclick="stopDownload('${normaliserNomJeu(gameData.gameName)}', this)" style="display:${estEnDownload ? 'block' : 'none'};"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-icon lucide-square"><rect width="18" height="18" x="3" y="3" rx="2"/></svg></button>
                <button onclick="uninstall('${normaliserNomJeu(gameData.gameName)}', this)" class="uninstall" style="display:${estInstalle ? 'block' : 'none'};color=red;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
        `;
    }

    document.getElementById('catalogue').innerHTML = catalogueHTML;
    activerLeVirtualScroll();
}

function renderCatalogue(filterText = '') {
    const q = String(filterText || '').trim().toLowerCase();
    const sortByNameCheckbox = document.getElementById('sortByName');

    let liste = catalogueGames.slice();
    if (q.length) {
        liste = liste.filter(g => g.gameName.toLowerCase().includes(q));
    }

    if (sortByNameCheckbox && sortByNameCheckbox.checked) {
        liste.sort((a, b) => a.gameName.localeCompare(b.gameName, 'fr', { sensitivity: 'base' }));
    } else {
        liste.sort((a, b) => getPoids(b.gameName) - getPoids(a.gameName));
    }

    let catalogueHTML = ``;
    for (let gameData of liste) {
        const nomNormalise = normaliserNomJeu(gameData.gameName);
        const estInstalle = nomsInstalleGlobal.includes(nomNormalise);
        const estEnDownload = nomsEnRarGlobal.includes(nomNormalise);
        catalogueHTML += `
            <div onclick="gameSelected(this)" class="game-inner-box ${estInstalle ? 'downloaded' : ''}" id="${normaliserNomJeu(gameData.gameName)}">
                <div class="ingame" id="${normaliserNomJeu(gameData.gameName)}_ingame" style="display: none;"></div>
                <div class="background-container" id="${normaliserNomJeu(gameData.gameName)}_ingame_scale" style="scale:1;"><div class="background ${estInstalle ? 'downloaded' : ''}" style="background-image: url('${gameData.imageLink}');" data-bg="${gameData.imageLink}"></div></div>
                <div class="gameData">
                    <p class="size">Size: <span>26.3GB</span></p>
                    <p class="version">n°: <span>Build 23340805</span></p>
                </div>
                <button style="display:${!estInstalle && !estEnDownload ? 'block' : 'none'};" onclick="downloadgame('${gameData.url}', '${gameData.gameName}', this)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-icon lucide-download"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>
                </button>
                <button onclick="play('${normaliserNomJeu(gameData.gameName)}', this)" style="display:${estInstalle && !estEnDownload ? 'block' : 'none'};"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play-icon lucide-play"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg></button>
                <button onclick="stopDownload('${normaliserNomJeu(gameData.gameName)}', this)" style="display:${estEnDownload ? 'block' : 'none'};"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-icon lucide-square"><rect width="18" height="18" x="3" y="3" rx="2"/></svg></button>
                <button onclick="uninstall('${normaliserNomJeu(gameData.gameName)}', this)" class="uninstall" style="display:${estInstalle ? 'block' : 'none'};color=red;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
        `;
    }

    document.getElementById('catalogue').innerHTML = catalogueHTML;
    activerLeVirtualScroll();
}

// Hook pour la recherche en direct et le tri
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

function activerLeVirtualScroll() {
    const options = {
        root: document.getElementById('catalogue'), // CORRECTION : On cible ton conteneur qui a le scroll
        rootMargin: '300px 0px', 
        threshold: 0.01
    };

    const observateur = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const wrapper = entry.target;
                // CORRECTION : On va chercher la div .background à l'intérieur pour lui coller l'image
                const bgImage = wrapper.querySelector('.background');
                const imageUrL = wrapper.getAttribute('data-bg');

                if (bgImage) {
                    bgImage.style.backgroundImage = `url('${imageUrL}')`;
                }
                
                // On applique le flag visible sur le conteneur complet
                wrapper.classList.add('visible'); 
                observer.unobserve(wrapper);
            }
        });
    }, options);

    // CORRECTION : On sélectionne la bonne classe générée (wrapper)
    const tousLesJeux = document.querySelectorAll('.game-inner-box-wrapper');
    tousLesJeux.forEach(jeu => observateur.observe(jeu));
}



////////////////////////////////
////////////////////////////////
////////////////////////////////
////////////////////////////////
////////////////////////////////
////////////////////////////////

async function downloadgame(nomDuJeu, name, element) {
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

// CORRECTION ICI : Ajout du 'async' devant la fonction
async function updateData(nomDuJeu, name, element){
    try {
        // CORRECTION ICI : Pas de .json(), la réponse arrive déjà sous forme d'objet propre
        const data = await window.api.getGameData(nomDuJeu, name);
        
        if (data && data.success) {
            // Sélection sécurisée des éléments pour injecter le texte textuel récupéré par Cheerio
            const sizeSpan = element.parentElement.querySelector('.gameData .size span');
            const versionSpan = element.parentElement.querySelector('.gameData .version span');
            
            if (sizeSpan) sizeSpan.innerHTML = data.gameSize || "Inconnu";
            if (versionSpan) versionSpan.innerHTML = data.version || "Inconnu";
        } else {
            console.error("Le scraping a échoué :", data.error);
        }
    } catch (err) {
        console.error("Erreur updateData :", err);
    }
}

async function uninstall(nomDuJeu, element) {
    window.api.uninstallGame(nomDuJeu);
    element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="loadingsvg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
}

async function play(nomDuJeu, element) {
    window.api.startGame(nomDuJeu);
}

async function stopDownload(nomDuJeu, element) {
    window.api.stopDownload(nomDuJeu);
}




// Dans ton script.js
window.electronAPI.onDownloadProgress((data) => {
    document.getElementById(data.name).style.setProperty('--chargement-pourcent', 100 - parseFloat(data.pourcentage)+'%');
    
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

function gameSelected(game) { 
    // .getElementsByClassName("background-container")[0]
    // game.style.scale = "1.56 1.05";
    // game.getElementsByClassName("background-container")[0].style.scale = "0.64 0.95";
} 

window.electronAPI.onUpdateAvailable(() => {
    alert("Une nouvelle version est disponible ! Elle va être téléchargée en arrière-plan.");
});

window.electronAPI.onUpdateDownloaded(() => {
    if(confirm("Mise à jour prête ! Voulez-vous redémarrer pour l'installer ?")) {
        window.electronAPI.restartApp();
    }
});

function updateGame(element) {
    document.getElementById('app-content').style.opacity = "0";
    document.getElementById('app-content').style.scale = "1.05";
    setTimeout(()=>{document.getElementById('app-content').style.pointerEvents = "none";},0)
    setTimeout(()=>{document.getElementById('app-content').style.display = "none";},200)
}