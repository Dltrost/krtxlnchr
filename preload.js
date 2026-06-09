const { contextBridge, ipcRenderer } = require('electron');

// On expose une API sécurisée au niveau de la fenêtre (window.api)
contextBridge.exposeInMainWorld('api', {
  // Fonction pour envoyer une donnée et attendre la réponse (Asynchrone)
  envoyerMessage: async (donnee, name) => {
    return await ipcRenderer.invoke('canal-securise', donnee, name);
  },
  getGameData: async (donnee, name) => {
    return await ipcRenderer.invoke('getGameData', donnee, name);
  },
  startGame: async (nom) => {
    return await ipcRenderer.invoke('startGame', nom);
  },
  uninstallGame: async (nom) => {
    return await ipcRenderer.invoke('uninstallGame', nom);
  },
  stopDownload: async (nom) => {
    return await ipcRenderer.invoke('stopDownload', nom);
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
    // On crée la fonction que ton script.js va appeler pour écouter le Main
    onDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, data) => callback(data)),
    downloadstart: (callback) => ipcRenderer.on('debut-download', (event, message) => callback(message)),
    listerDossiersJeux: () => ipcRenderer.invoke('lister-dossiers-jeux'),
    onGameStatus: (callback) => ipcRenderer.on('game-status-tracking', callback),
    minimize: () => ipcRenderer.send('minimize-window'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update_available', callback),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update_downloaded', callback),
    // Fonction pour envoyer la commande de redémarrage
    restartApp: () => ipcRenderer.send('restart_app'),

    demarrerScraping: () => ipcRenderer.send('lancer-scraping'),

    // Permet à script.js de recevoir un nouveau jeu
    onNouveauJeu: (callback) => ipcRenderer.on('nouveau-jeu', (event, gameObj) => callback(gameObj)),
  chargerGamesJson: () => ipcRenderer.invoke('charger-games-json'),
  onScrapingTermine: (callback) => ipcRenderer.on('scraping-termine', () => callback()),
    // Permet à script.js de recevoir l'avancement en %
    onProgression: (callback) => ipcRenderer.on('progression-scraping', (event, pourcentage) => callback(pourcentage))
});