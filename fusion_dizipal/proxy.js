const https = require("https");
const { log, CONFIG } = require("./config");
const { scrapeM3U8, fetchTitleInfo, toSlug } = require("./scraper");
const { cacheGet } = require('./cache');

async function getDizipalUrl(id) {
    const cleanId = id.replace(".json", "");
    
    // Eğer ID direkt dizipal slug'ı ise IMDB sorgusuna gerek yok
    if (cleanId.startsWith("dizipal:")) {
        const slug = cleanId.split(":")[1];
        if (slug.includes("-bolum-izle") || slug.includes("-sezon-")) {
            return `${CONFIG.BASE_URL}/bolum/${slug}/`;
        } else {
            return `${CONFIG.BASE_URL}/${slug}/`;
        }
    }

    let epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);
    let imdbId = epMatch ? epMatch[1] : cleanId;
    
    const info = await fetchTitleInfo(imdbId);
    if (!info) {
        throw new Error("İçerik bilgisi alınamadı.");
    }
    
    if (info.type === "episode") {
        epMatch = [null, info.seriesImdbId || imdbId, info.season, info.episode];
        imdbId = info.seriesImdbId || imdbId;
    }
    
    const title = info.title;
    
    // Eğer başlık bulunduysa önce Dizipal'de aratıp sitenin kendi çevirdiği ismi bul
    try {
        const { scrapeSearch } = require('./catalog');
        const results = await scrapeSearch(title, epMatch ? 'series' : 'movie');
        if (results && results.length > 0) {
            let firstResultSlug = results[0].id.split(":")[1];
            log(`[Arama] IMDB araması Dizipal slug'ı ile eşleşti: ${firstResultSlug}`, "info");
            
            if (epMatch) {
                // Eğer dönen sonuç zaten bir bölüm linki ise (örn: cape-fear-1x5 veya dogu-1-sezon-1-bolum)
                let baseSlug = firstResultSlug.replace(/-(\d+x\d+|\d+-sezon-\d+-bolum(?:-izle)?)$/i, '');
                
                // Bölüm formatını ve tam slug'ı öğrenmek için dizi sayfasını Puppeteer (scrapeMeta) ile tarayalım
                try {
                    const { scrapeMeta } = require('./scraper');
                    const meta = await scrapeMeta('series', baseSlug);
                    if (meta && meta.videos && meta.videos.length > 0) {
                        const targetEp = meta.videos.find(v => v.season === parseInt(epMatch[2]) && v.episode === parseInt(epMatch[3]));
                        if (targetEp) {
                            const epSlug = targetEp.id.split(":")[1];
                            log(`[Arama] Puppeteer Meta üzerinden gerçek bölüm slug'ı bulundu: ${epSlug}`, "info");
                            return `${CONFIG.BASE_URL}/bolum/${epSlug}/`;
                        }
                    }
                } catch(e) {
                    log(`[Arama] Puppeteer üzerinden bölüm formatı çekilemedi, tahmine düşülüyor: ${e.message}`, "warn");
                }
                
                // Yedek tahmin algoritmaları
                const matchX = firstResultSlug.match(/-(\d+)x(\d+)$/i);
                if (matchX) {
                    return `${CONFIG.BASE_URL}/bolum/${baseSlug}-${epMatch[2]}x${epMatch[3]}/`;
                } else {
                    return `${CONFIG.BASE_URL}/bolum/${baseSlug}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
                }
            } else {
                return `${CONFIG.BASE_URL}/${firstResultSlug}/`;
            }
        }
    } catch(e) {
        log(`[Arama] Fallback arama hatası: ${e.message}`, "debug");
    }

    // Arama başarısız olursa tahmine devam et
    if (epMatch) {
      return `${CONFIG.BASE_URL}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
    } else {
      return `${CONFIG.BASE_URL}/${toSlug(title)}/`;
    }
}

async function fetchFreshUrl(id, force = false) {
    const dUrl = await getDizipalUrl(id);
    return await scrapeM3U8(dUrl, force);
}

async function proxyStream(req, res) {
  let targetUrl = req.query.url;
  const id = req.query.id;
  let isRetrying = false;
  // CDN'in beklediği gerçek Referer: rewrite edilmiş alt-URL'lerde ?ref= ile taşınır,
  // ilk istekte ise stream_data cache'inden (scrapeM3U8'in yakaladığı) gelir.
  let cdnReferer = req.query.ref || "";

  try {
      if (id && !targetUrl) {
         const dUrl = await getDizipalUrl(id);
         const cachedData = cacheGet(`stream_data:${dUrl}`);
         if (cachedData && cachedData.url) {
             targetUrl = cachedData.url;
             cdnReferer = cdnReferer || cachedData.referer;
         } else {
             const freshData = await fetchFreshUrl(id);
             targetUrl = freshData.url;
             cdnReferer = cdnReferer || (freshData && freshData.referer);
         }
      }
  } catch(e) {
      log(`Proxy URL çözümleme hatası: ${e.message}`, "error");
      return res.status(500).send("URL çözümlenemedi.");
  }

  if (!cdnReferer) cdnReferer = CONFIG.BASE_URL + "/";
  let cdnOrigin = CONFIG.BASE_URL;
  try { cdnOrigin = new URL(cdnReferer).origin; } catch (e) {}

  // Hedef URL'nin host'una göre CDN bağlamını (cookie/referer/origin) getir.
  // scrapeM3U8 yakalarken `cdn_ctx:<host>` altına yazıyor.
  const cdnHeaders = (u) => {
    let ctx = {};
    try { ctx = cacheGet(`cdn_ctx:${new URL(u).host}`) || {}; } catch (e) {}
    const h = { "User-Agent": CONFIG.UA, "Referer": ctx.referer || cdnReferer, "Origin": ctx.origin || cdnOrigin };
    if (ctx.cookie) h["Cookie"] = ctx.cookie;
    return h;
  };

  // HLS zinciri: playlist (.m3u8) + segment/anahtar tipleri. Rewrite edilmiş
  // segmentler bizim proxy'den geçtiği için bunlara izin verilmeli.
  if (!targetUrl || !/\.(m3u8|ts|m4s|mp4|aac|mp3|key|vtt|webvtt)(\?|#|$)/i.test(targetUrl)) {
    return res.status(403).send("Geçersiz veya engellenmiş URL isteği.");
  }

  const host = req.get('host');

  const doProxy = async (targetUrl) => {
    // Eğer resIndex varsa, master m3u8 içinden o çözünürlüğü seçip onun url'sini proxy yap
    if (req.query.resIndex !== undefined) {
        try {
            const mRes = await fetch(targetUrl, { headers: cdnHeaders(targetUrl) });
            if (mRes.ok) {
                const content = await mRes.text();
                const lines = content.split('\n');
                const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                let currentResIndex = 0;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                        if (currentResIndex == req.query.resIndex) {
                            let nextLine = lines[i+1]?.trim();
                            if (nextLine) {
                                targetUrl = nextLine.startsWith("http") ? nextLine : baseUrl + nextLine;
                                break;
                            }
                        }
                        currentResIndex++;
                    }
                }
            }
        } catch(e) {
            log(`Proxy resIndex ayrıştırma hatası: ${e.message}`, "warn");
        }
    }

    // m3u8 PLAYLIST ise: içindeki alt-playlist ve segment URL'lerini bizim proxy'ye
    // yönlendirecek şekilde YENİDEN YAZ. Aksi halde oynatıcı segmentleri doğrudan
    // referer-korumalı CDN'den çekmeye çalışır ve "demuxing" hatası verir.
    if (targetUrl.toLowerCase().includes(".m3u8")) {
        try {
            const r = await fetch(targetUrl, { headers: cdnHeaders(targetUrl) });
            if ((r.status === 403 || r.status === 401 || r.status === 410) && id && !isRetrying) {
                isRetrying = true;
                const fresh = await fetchFreshUrl(id, true).catch(() => null);
                if (fresh && fresh.url) { log(`[Smart Proxy] Playlist expired, token yenilendi.`, "system"); if (fresh.referer) cdnReferer = fresh.referer; return doProxy(fresh.url); }
                return res.status(502).send("Playlist yenilenemedi.");
            }
            if (!r.ok) return res.status(r.status).send("Playlist alınamadı.");
            const content = await r.text();
            const origin = new URL(targetUrl).origin;
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const abs = (u) => u.startsWith("http") ? u : (u.startsWith("/") ? origin + u : baseUrl + u);
            const refQ = `&ref=${encodeURIComponent(cdnReferer)}`;
            const prox = (u) => `http://${host}/proxy-stream?url=${encodeURIComponent(abs(u))}${refQ}`;
            const rewritten = content.split('\n').map(line => {
                const t = line.trim();
                if (!t) return line;
                if (t.startsWith("#")) {
                    // URI="..." içeren tag'ler (EXT-X-KEY / EXT-X-MEDIA / EXT-X-MAP)
                    return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${prox(u)}"`);
                }
                return prox(t); // segment veya alt-playlist satırı
            }).join('\n');
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Access-Control-Allow-Origin", "*");
            return res.send(rewritten);
        } catch (e) {
            log(`Playlist proxy/rewrite hatası: ${e.message}`, "error");
            if (!res.headersSent) return res.status(500).send("Playlist proxy hatası.");
            return;
        }
    }

    const parsedUrl = new URL(targetUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: cdnHeaders(targetUrl)
    };

    if (req.headers.range) {
      options.headers["Range"] = req.headers.range;
    }

    // https module is imported as https, but if the targetUrl is http, we should use http.
    const reqModule = targetUrl.startsWith("https") ? https : require("http");

    const proxyReq = reqModule.request(options, (proxyRes) => {
      if (proxyRes.statusCode === 403 || proxyRes.statusCode === 401 || proxyRes.statusCode === 410) {
        log(`[Smart Proxy] Yasaklandı/Expired (${proxyRes.statusCode})! Token yenileniyor... (${id})`, "warn");
        if (id && !isRetrying && !targetUrl.includes(".ts")) {
            isRetrying = true;
            fetchFreshUrl(id, true).then(newData => {
              if (newData && newData.url) {
                 const newTarget = newData.url;
                 log(`[Smart Proxy] Yeni yayın url'sine yönlendiriliyor...`, "system");
                 doProxy(newTarget);
              } else {
                 res.status(500).send("Yenileme başarısız.");
              }
            }).catch(() => res.status(500).send("Proxy hatası."));
            return;
        } else {
            return res.status(proxyRes.statusCode).send("Yayın izni reddedildi.");
        }
      }

      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      log(`Proxy request hatası: ${err.message}`, "error");
      if (!res.headersSent) res.status(500).send("Proxy hatası.");
    });

    req.pipe(proxyReq, { end: true });
  };

  doProxy(targetUrl);
}

async function getResolutions(m3u8Url) {
    try {
        const res = await fetch(m3u8Url, {
            headers: { "User-Agent": CONFIG.UA, "Referer": CONFIG.BASE_URL + "/" }
        });
        if (!res.ok) return [];
        const content = await res.text();
        const lines = content.split('\n');
        const streams = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                const resMatch = lines[i].match(/RESOLUTION=\d+x(\d+)/);
                const resolution = resMatch ? resMatch[1] + "p" : "Oto";
                streams.push({ resolution: resolution, index: streams.length });
            }
        }
        return streams;
    } catch(e) {
        return [];
    }
}

module.exports = { proxyStream, getDizipalUrl, fetchFreshUrl, getResolutions };
