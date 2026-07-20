const express = require("express");
const cors = require("cors");
const path = require("path");
const querystring = require("querystring");
const dotenv = require("dotenv");

const helmet = require("helmet");
const { addonInterface, subtitlesHandler } = require("./addon");
const SubsRoClient = require("./lib/subsro");
const proxyRouter = require("./lib/proxy");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 7000;

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use(proxyRouter);

const decodeConfig = (configStr) => {
  if (!configStr) return {};
  try {
    const base64 = configStr
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(configStr.length + ((4 - (configStr.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
  } catch (e) {
    return {};
  }
};

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "configure.html")));
app.get("/configure", (req, res) => res.sendFile(path.join(__dirname, "public", "configure.html")));
app.get("/:config/configure", (req, res) => res.sendFile(path.join(__dirname, "public", "configure.html")));

const manifestHandler = (req, res) => {
  const { config } = req.params;
  const userConfig = decodeConfig(config);
  const hasConfig = config && Object.keys(userConfig).length > 0;

  const manifest = {
    ...addonInterface.manifest,
    behaviorHints: {
      ...addonInterface.manifest.behaviorHints,
      configurationRequired: !hasConfig,
    },
  };

  res.set("Cache-Control", "public, max-age=86400"); // 1 day
  res.json(manifest);
};

app.get("/manifest", manifestHandler);
app.get("/manifest.json", manifestHandler);
app.get("/:config/manifest", manifestHandler);
app.get("/:config/manifest.json", manifestHandler);

app.get("/api/validate/:apiKey", async (req, res) => {
  const { apiKey } = req.params;
  const client = new SubsRoClient(apiKey);
  const isValid = await client.validate();
  res.json({ valid: isValid });
});

app.get("/:config?/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { config, type, id, extra } = req.params;
  const userConfig = decodeConfig(config);

  console.log(`\n=========================================`);
  console.log(`🎬 Stremio a cerut subtitrare!`);
  console.log(`🎥 Tip: ${type} | ID Film/Episod: ${id}`);
  console.log(`=========================================\n`);

  const protocol = req.headers["x-forwarded-proto"] || (req.secure ? "https" : req.protocol);
  const host = req.headers["x-forwarded-host"] || req.get("host");
  userConfig.baseUrl = `${protocol}://${host}`;

  try {
    let extraObj = {};
    if (extra) {
      try {
        extraObj = JSON.parse(extra);
      } catch (e) {
        extraObj = querystring.parse(extra);
      }
    }
    const response = await subtitlesHandler({
      type,
      id,
      extra: extraObj,
      config: userConfig,
    });
    
    console.log(`✅ Am gasit ${response.subtitles ? response.subtitles.length : 0} subtitrari pentru acest film.`);
    
    if (response.subtitles && response.subtitles.length > 0) {
      // Construim pachete complet noi
      response.subtitles = response.subtitles.map((sub, index) => {
        let extractedName = "";
        
        // Decriptare Base64 din URL pentru a gasi numele lung
        if (sub.url && sub.url.includes('/proxy/')) {
          const urlParts = sub.url.split('/');
          const base64Index = urlParts.findIndex(p => p === 'proxy') + 2; 
          if (urlParts[base64Index]) {
            try {
              let decoded = Buffer.from(urlParts[base64Index], 'base64').toString('utf-8');
              decoded = decoded.replace(/\.(srt|sub|txt|vtt)$/i, '').trim();
              if (decoded.includes('/')) {
                decoded = decoded.split('/').pop().trim();
              }
              extractedName = decoded;
            } catch (e) {}
          }
        }
        
        let finalTitle = extractedName || sub.title || sub.filename || `Subtitrare ${index + 1}`;
        
        // --- LOGICA DE ETICHETE SCURTE (CERUTA DE TINE) ---
        let shortFormat = "Standard";
        let upperTitle = finalTitle.toUpperCase();
        
        if (upperTitle.includes("BLURAY") || upperTitle.includes("BRRIP") || upperTitle.includes("BDRIP")) {
            shortFormat = "BluRay";
        } else if (upperTitle.includes("WEB-DL") || upperTitle.includes("WEBDL") || upperTitle.includes("WEB")) {
            shortFormat = "WEB-DL";
        } else if (upperTitle.includes("WEBRIP") || upperTitle.includes("WEB-RIP")) {
            shortFormat = "WEBRip";
        } else if (upperTitle.includes("HDRIP") || upperTitle.includes("HD-RIP")) {
            shortFormat = "HDRip";
        } else if (upperTitle.includes("CAM") || upperTitle.includes("TS") || upperTitle.includes("HDCAM")) {
            shortFormat = "CAM/TS";
        } else if (upperTitle.includes("DVD") || upperTitle.includes("DVDRIP") || upperTitle.includes("DVDSCR")) {
            shortFormat = "DVDRip";
        } else if (upperTitle.includes("HDTV")) {
            shortFormat = "HDTV";
        }

        console.log(`  🔎 [Subtitrarea ${index + 1}] -> Folder stanga: Română | Nume dreapta: ${shortFormat}`);
        
        // Pachetul "Curat" pentru Stremio
        return {
          id: sub.id,
          url: sub.url,
          lang: "ron", // Asta il tine in folderul default "Română" din stanga!
          title: shortFormat // Asta va scrie "BluRay", "WEB-DL", etc. in dreapta!
        };
      });
    }
    
    // Distrugem cache-ul ca Stremio sa primeasca noile nume
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate"); 
    res.json(response);
  } catch (e) {
    console.log(`❌ Eroare la cautare:`, e.message);
    res.status(500).json({ subtitles: [] });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Addon live on port ${PORT}`);
  console.log(`[INFO] VOCEA ESTE ACTIVATA - Hack Titluri On.`);

  const RESTART_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  setTimeout(() => {
    console.error("[SYSTEM] Planned 24h restart triggered. Exiting...");
    process.exit(0);
  }, RESTART_INTERVAL);
});
