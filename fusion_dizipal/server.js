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
    const { getDizipalUrl } = require('./proxy');
    const { scrapeM3U8 } = require('./scraper');
    const { cacheGet } = require('./cache');

    // Bölüm/film sayfa URL'sini BİR KEZ çöz (arama+meta ağır Puppeteer işi);
    // ardından aynı URL ile m3u8 çek — getDizipalUrl'i ikinci kez çağırma.
    const dUrl = await getDizipalUrl(cleanId);
    let cachedData = cacheGet(`stream_data:${dUrl}`);

    // Altyazıları Stremio'ya anında iletmek için ön yükleme yap
    if (!cachedData) {
        log(`Altyazı ve önbellek için yayın hazırlanıyor...`, "info");
        cachedData = await scrapeM3U8(dUrl);
    }
    if (!cachedData || !cachedData.url) {
        throw new Error("Yayın linki bulunamadı.");
    }
    
    let subtitles = [];
    if (cachedData && cachedData.subtitles && cachedData.subtitles.length > 0) {
        subtitles = cachedData.subtitles;
        log(`${subtitles.length} adet altyazı stream'e eklendi.`, "info");
    }

    // Yayın CDN'i (uk-traffic vb.) sunucu-taraflı fetch'e 403 veriyor (anti-hotlink);
    // sadece oynatıcının kendisi yükleyebiliyor. Bu yüzden:
    //  1) ANA seçenek: ham m3u8 + proxyHeaders (Referer). Harici oynatıcı (VLC/Infuse)
    //     CDN'e kendi TLS'iyle bağlanır → Node proxy'nin 403'ünü atlar.
    //  2) YEDEK: dahili proxy (Range/CORS gerektiren oynatıcılar için).
    const binge = `dizipal-binge-${cleanId.split(':')[0]}`;
    // CDN'in beklediği gerçek Referer/Origin/Cookie (oynatıcının yakalanan bağlamı).
    const cdnRef = cachedData.referer || (CONFIG.BASE_URL + "/");
    let cdnOrigin = CONFIG.BASE_URL;
    try { cdnOrigin = cachedData.origin || new URL(cdnRef).origin; } catch (e) {}
    const reqHeaders = { "User-Agent": CONFIG.UA, "Referer": cdnRef, "Origin": cdnOrigin };
    if (cachedData.cookie) reqHeaders["Cookie"] = cachedData.cookie;
    const proxyHeaders = { request: reqHeaders };
    const streams = [
        // 1) ANA: dahili proxy — playlist'i yeniden yazıp HER segmenti CDN'in beklediği
        //    Referer + Cookie ile çeker (anti-hotlink'i aşmanın en tam yolu).
        {
            name: "Dizipal\n⇄ Proxy",
            title: streamTitle,
            description: `Kaynak: ${CONFIG.BASE_URL}\nDahili proxy (önerilen)`,
            url: `http://${host}/proxy-stream?id=${encodeURIComponent(cleanId)}`,
            subtitles,
            behaviorHints: { notWebReady: true, bingeGroup: binge }
        },
        // 2) YEDEK: ham m3u8 + proxyHeaders — harici oynatıcı CDN'e doğrudan bağlanır.
        {
            name: "Dizipal\n▶ Doğrudan",
            title: streamTitle,
            description: `Kaynak: ${CONFIG.BASE_URL}\nDoğrudan (harici oynatıcı)`,
            url: cachedData.url,
            subtitles,
            behaviorHints: { notWebReady: true, bingeGroup: binge, proxyHeaders }
        }
    ];

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
