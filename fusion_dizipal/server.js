"use strict";

/**
 * Fusion Dizipal Addon - v1.5.0
 * Aşama 3: Akıllı Proxy, Canlı Dashboard, Katalog ve Altyazı Desteği
 */

const express = require("express");
const cors = require("cors");
const { CONFIG, log, getRecentLogs } = require('./config');
const { fetchTitle, toSlug, getBrowserStatus } = require('./scraper');
const { proxyStream } = require('./proxy');
const { getDashboardHtml } = require('./dashboard');
const { scrapeCatalog, scrapeSearch } = require('./catalog');
const { findCurrentDizipalDomain } = require('./scraper');

const app = express();

app.use(cors());

// 1. DASHBOARD ROTASI
app.get("/", (req, res) => {
    res.send(getDashboardHtml({}, getBrowserStatus()));
});

// 2. API STATUS ROTASI (Canlı Dashboard için)
app.get("/api/status", (req, res) => {
    res.json({
        browserActive: getBrowserStatus(),
        logs: getRecentLogs(),
        version: CONFIG.VERSION
    });
});

// 3. PROXY ROTASI (Smart Token Fallback)
app.get("/proxy-stream", proxyStream);

// 4. MANIFEST ROTASI (Katalog eklendi)
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "fusion.dizipal.clean",
    name: "Dizipal",
    version: CONFIG.VERSION,
    description: "Katalog, Altyazı ve Akıllı Proxy özellikli Dizipal eklentisi.",
    logo: CONFIG.LOGO_URL,
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "dizipal"],
    catalogs: [
        { 
            type: "movie", 
            id: "dizipal-movies", 
            name: "Dizipal Filmler",
            extra: [{ name: "search", isRequired: false }]
        },
        { 
            type: "series", 
            id: "dizipal-series", 
            name: "Dizipal Diziler",
            extra: [{ name: "search", isRequired: false }]
        }
    ],
    behaviorHints: { configurable: false, configurationRequired: false }
  });
});

// 5. KATALOG ROTASI
app.get("/catalog/:type/:id.json", async (req, res) => {
    const { type } = req.params;
    log(`Katalog istendi: ${type}`, "info");
    const metas = await scrapeCatalog(type);
    res.json({ metas });
});

// 5.1. ARAMA ROTASI (Search)
app.get("/catalog/:type/:id/search=:query.json", async (req, res) => {
    const { type, query } = req.params;
    log(`Arama istendi: ${query} (${type})`, "info");
    const metas = await scrapeSearch(query, type);
    res.json({ metas });
});

// AŞAMA 4: META ROTASI (Detay Sayfası & Binge Watching)
app.get("/meta/:type/:id.json", async (req, res) => {
    const { type, id } = req.params;
    const cleanId = id.replace(".json", "");
    
    if (cleanId.startsWith("dizipal:")) {
        const { scrapeMeta } = require('./scraper');
        log(`Meta Detayı İstendi: ${cleanId}`, "info");
        const meta = await scrapeMeta(type, cleanId);
        if (meta) {
            return res.json({ meta });
        }
    }
    
    res.json({ meta: {} });
});

// 6. STREAM ROTASI
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const cleanId = id.replace(".json", "");
  
  try {
    let title, streamTitle;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);

    if (cleanId.startsWith("dizipal:")) {
        const slug = cleanId.split(":")[1];
        title = slug.replace(/-/g, " ").toUpperCase();
        streamTitle = `📺 İçerik: ${title}`;
    } else if (epMatch) { 
        title = await fetchTitle(epMatch[1]);
        streamTitle = `📺 Dizi: ${title} S${epMatch[2]}E${epMatch[3]}`;
    } else { 
        title = await fetchTitle(cleanId);
        streamTitle = `🎥 Film: ${title}`;
    }

    log(`İzleme İsteği: ${title || cleanId}`, "info");

    const host = req.get('host');
    const { getDizipalUrl, fetchFreshUrl, getResolutions } = require('./proxy'); 
    const { cacheGet } = require('./cache');
    
    const dUrl = await getDizipalUrl(cleanId);
    let cachedData = cacheGet(`stream_data:${dUrl}`);
    
    // Altyazıları Stremio'ya anında iletmek için ön yükleme yap
    if (!cachedData) {
        log(`Altyazı ve önbellek için yayın hazırlanıyor...`, "info");
        cachedData = await fetchFreshUrl(cleanId);
    }
    
    let subtitles = [];
    if (cachedData && cachedData.subtitles && cachedData.subtitles.length > 0) {
        subtitles = cachedData.subtitles;
        log(`${subtitles.length} adet altyazı stream'e eklendi.`, "info");
    }

    // AŞAMA 4: Çözünürlükleri Parçala (1080p, 720p vs)
    let resolutions = await getResolutions(cachedData.url);
    let streams = [];
    
    if (resolutions && resolutions.length > 0) {
        streams = resolutions.map(resObj => {
            return {
                name: `Dizipal\n${resObj.resolution}`,
                title: streamTitle,
                description: `Kaynak: ${CONFIG.BASE_URL}`,
                url: `http://${host}/proxy-stream?id=${encodeURIComponent(cleanId)}&resIndex=${resObj.index}`,
                subtitles: subtitles,
                behaviorHints: { 
                    notWebReady: true,
                    bingeGroup: `dizipal-binge-${cleanId.split(':')[0]}`
                }
            };
        });
    } else {
        streams.push({
            name: "Dizipal\nOto",
            title: streamTitle,
            description: `Kaynak: ${CONFIG.BASE_URL}\nOtomatik Kalite`,
            url: `http://${host}/proxy-stream?id=${encodeURIComponent(cleanId)}`,
            subtitles: subtitles,
            behaviorHints: { 
                notWebReady: true,
                bingeGroup: `dizipal-binge-${cleanId.split(':')[0]}`
            }
        });
    }

    res.json({ streams });
  } catch (err) {
    log(`HATA: ${err.message}`, "error");
    
    res.json({
      streams: [{
        name: "⚠️ BİLGİ",
        title: "HATA: Link bulunamadı.",
        description: `Detay: ${err.message}\nLütfen daha sonra tekrar deneyin.`,
        url: "http://error"
      }]
    });
  }
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  log(`Fusion Addon v${CONFIG.VERSION} Port ${CONFIG.PORT} aktif (Premium Yapı)`, "system");
  // Auto-Domain bulucuyu arka planda tetikle
  findCurrentDizipalDomain().catch(console.error);
});
