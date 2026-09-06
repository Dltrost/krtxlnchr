const { fetch, Agent } = require('undici');

async function parseSiteDirect() {
  try {
    // Agent qui ignore totalement le certificat invalide de MegaDB
    const dispatcher = new Agent({
      connect: {
        rejectUnauthorized: false
      }
    });

    const response = await fetch('https://megadb.net/sujq69o8w9gy', {
      dispatcher,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = await response.text();
    console.log("=== Succès ===");
    console.log(html);
  } catch (error) {
    console.error("Erreur :", error.message);
  }
}

parseSiteDirect();