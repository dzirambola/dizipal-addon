const { addExtra } = require('puppeteer-extra');
const puppeteer = addExtra(require('puppeteer-core'));
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { CONFIG, log, logger } = require('./config');
const { cacheSet, cacheGet } = require('./cache');

puppeteer.use(StealthPlugin());

let _browser = null;
let _launchPromise = null;
let _idleTimeout = null;
const IDLE_TIME_MS = 15 * 60 * 1000;

function resetIdleTimeout() {
    if (_idleTimeout) clearTimeout(_idleTimeout);
    _idleTimeout = setTimeout(async () => {
        if (_browser && _browser.connected) {
            log("Tarayıcı uzun süre boşta kaldı, bellek tasarrufu için kapatılıyor...", "system");
            await _browser.close().catch(() => {});
            _browser = null;
        }
    }, IDLE_TIME_MS);
}

async function setupPage(page) {
    await page.setBypassServiceWorker(true).catch(() => {});
    await page.setCacheEnabled(false).catch(() => {});
    await page.evaluateOnNewDocument(() => {
        window.DisableDevtool = { isRunning: true, isSuspend: true };
        const originalOuterWidth = window.innerWidth;
        const originalOuterHeight = window.innerHeight;
        Object.defineProperty(window, 'outerWidth', { get: () => originalOuterWidth });
        Object.defineProperty(window, 'outerHeight', { get: () => originalOuterHeight });
    }).catch(() => {});
}

async function getBrowser() {
  if (_browser && _browser.connected) {
      resetIdleTimeout();
      return _browser;
  }
  
  if (_launchPromise) {
      await _launchPromise;
      resetIdleTimeout();
      return _browser;
  }

  _launchPromise = (async () => {
      try {
          log("Tarayıcı örneği başlatılıyor...", "system");
          _browser = await puppeteer.launch({
            executablePath: CONFIG.CHROMIUM_PATH,
            headless: CONFIG.HEADLESS,
            // Headful (Xvfb) modda gerçek bir pencere boyutu ver: disable-devtool'un
            // outer/inner boyut farkı kontrolü doğal olarak geçer.
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--disable-gpu", "--window-size=1280,1024"]
          });
          _browser.on('disconnected', () => { _browser = null; });
      } catch (err) {
          log(`Tarayıcı başlatılamadı: ${err.message}`, "error");
          _browser = null;
      }
  })();

  await _launchPromise;
  _launchPromise = null;
  resetIdleTimeout();
  
  if (!_browser) throw new Error("Tarayıcı örneği oluşturulamadı.");
  return _browser;
}

function toSlug(title) {
  return title.toLowerCase()
    .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
    .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c")
    .replace(/[^a-z0-9\s-]/g,"").trim().replace(/\s+/g,"-");
}

async function fetchTitleInfo(imdbId) {
  const cacheKey = `title_info:${imdbId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let info = { title: "", type: "movie", seriesImdbId: null, season: null, episode: null };

  if (CONFIG.TMDB_KEY && CONFIG.TMDB_KEY.trim() !== "") {
      try {
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${CONFIG.TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
          if (tmdbRes.ok) {
              const tmdbData = await tmdbRes.json();
              if (tmdbData.tv_results && tmdbData.tv_results.length > 0) {
                  info.title = tmdbData.tv_results[0].name;
                  info.type = "series";
              } else if (tmdbData.movie_results && tmdbData.movie_results.length > 0) {
                  info.title = tmdbData.movie_results[0].title;
                  info.type = "movie";
              } else if (tmdbData.tv_episode_results && tmdbData.tv_episode_results.length > 0) {
                  const ep = tmdbData.tv_episode_results[0];
                  info.type = "episode";
                  info.season = ep.season_number;
                  info.episode = ep.episode_number;
                  
                  const tvRes = await fetch(`https://api.themoviedb.org/3/tv/${ep.show_id}?api_key=${CONFIG.TMDB_KEY}&language=tr-TR`);
                  if (tvRes.ok) {
                      const tvData = await tvRes.json();
                      info.title = tvData.name;
                  }
              }
          }
      } catch (e) {
          log(`TMDB Info Hatası: ${e.message}`, "warn");
      }
  }

  if (!info.title || info.type === "episode") {
      try {
          const response = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${CONFIG.OMDB_KEY}`);
          if (response.ok) {
              const data = await response.json();
              if (data.Response === "True") {
                  if (data.Type === "episode" && data.seriesID) {
                      info.type = "episode";
                      info.season = parseInt(data.Season);
                      info.episode = parseInt(data.Episode);
                      info.seriesImdbId = data.seriesID;
                      
                      const seriesRes = await fetch(`https://www.omdbapi.com/?i=${data.seriesID}&apikey=${CONFIG.OMDB_KEY}`);
                      if (seriesRes.ok) {
                          const seriesData = await seriesRes.json();
                          if (seriesData.Response === "True") {
                              info.title = seriesData.Title;
                          }
                      }
                  } else {
                      info.title = data.Title;
                      info.type = data.Type === "series" ? "series" : "movie";
                  }
              }
          }
      } catch(e) {
          log(`OMDb Info Hatası: ${e.message}`, "warn");
      }
  }

  if (info.title) {
      cacheSet(cacheKey, info, 7 * 24 * 60 * 60 * 1000);
      return info;
  }
  return null;
}

async function fetchTitle(imdbId) {
  const info = await fetchTitleInfo(imdbId);
  return info ? info.title : "";
}

async function scrapeM3U8(pageUrl, forceRefresh = false) {
  const cacheKey = `stream_data:${pageUrl}`;
  if (!forceRefresh) {
      const cached = cacheGet(cacheKey);
      if (cached) return cached;
  }

  const startTime = Date.now();
  const browser = await getBrowser();
  const page = await browser.newPage();
  await setupPage(page);
  
  let subtitles = [];

  try {
    log(`[Scraper] Hedef sayfa açılıyor: ${pageUrl}`, "system");
    await page.setUserAgent(CONFIG.UA);
    await page.setExtraHTTPHeaders({ "Referer": CONFIG.BASE_URL + "/" });
    await page.setRequestInterception(true);
    
    const m3u8Url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
          reject(new Error("Zaman aşımı: Yayın linki bulunamadı."));
      }, CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        const type = req.resourceType();
        const url = req.url().toLowerCase();

        if (url.includes("disable-devtool") || url.includes("disabledevtool")) {
            req.abort().catch(() => {});
            return;
        }

        // Altyazı dosyalarını yakala
        if (url.includes(".vtt") || url.includes(".srt")) {
            if (!subtitles.some(s => s.url === url)) {
                log(`Altyazı yakalandı: ${url.split('?')[0]}`, "info");
                subtitles.push({
                    url: url,
                    lang: "Tur",
                    id: `sub-${subtitles.length}`
                });
            }
        }

        if (url.includes(".m3u8")) { 
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            log(`Link yakalandı: ${url.split('?')[0]} (${duration}s)`, "info");
            clearTimeout(timeout); 
            req.abort().catch(() => {});
            resolve(url);
            return;
        }

        if (["image", "font", "stylesheet", "media"].includes(type)) {
            req.abort().catch(() => {});
        } else {
            req.continue().catch(() => {});
        }
      });

      (async () => {
          try {
              await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
              const iframe = await page.evaluate(() => document.querySelector('iframe[src*="player"], iframe[src*="embed"]')?.src);
              if (iframe) {
                  await page.goto(iframe, { waitUntil: "domcontentloaded" });
              }
          } catch (e) {
              log(`Navigasyon hatası: ${e.message}`, "debug");
          }
      })();
    });

    const resultData = { url: m3u8Url, subtitles };
    cacheSet(cacheKey, resultData);
    return resultData;

  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// -------------------------------------------------------------
// AŞAMA 4: Auto-Domain Bulucu (Dual-Fallback: Mirror & Base Redirect)
// -------------------------------------------------------------
let isFindingDomain = false;
async function findCurrentDizipalDomain() {
    if (isFindingDomain) return CONFIG.BASE_URL;
    isFindingDomain = true;
    log(`[Auto-Domain] Güncel adres aranıyor...`, "system");
    
    let browser;
    try {
        browser = await getBrowser();
        const page = await browser.newPage();
        await setupPage(page);
        await page.setUserAgent(CONFIG.UA);
        await page.setRequestInterception(true);
        page.on("request", (req) => {
            const url = req.url().toLowerCase();
            if (url.includes("disable-devtool") || url.includes("disabledevtool")) {
                req.abort().catch(() => {});
            } else if (["image", "font", "stylesheet", "media"].includes(req.resourceType())) {
                req.abort().catch(() => {});
            } else {
                req.continue().catch(() => {});
            }
        });
        
        let newUrl = null;
        
        // 1inci Aşama: Mirror adresini kontrol et
        try {
            log(`[Auto-Domain] 1. Mirror (${CONFIG.MIRROR_URL}) test ediliyor...`, "system");
            await page.goto(CONFIG.MIRROR_URL, { waitUntil: "networkidle2", timeout: 15000 });
            newUrl = page.url();
            
            // Eğer otomatik yönlenmediyse sayfadaki linklere bak
            const linkUrl = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                for (let a of links) {
                    const href = a.href;
                    if (href.includes('dizipal') && href.match(/dizipal[0-9]+\.[a-z]+/)) {
                        return href;
                    }
                }
                return null;
            });

            if (linkUrl && !newUrl.match(/dizipal[0-9]+\.[a-z]+/)) {
                newUrl = linkUrl;
            }
        } catch(e) {
            log(`[Auto-Domain] Mirror zaman aşımı veya hatası.`, "warn");
        }

        // 2nci Aşama: Eğer Mirror işe yaramadıysa veya aynı dizeyi döndürdüyse
        // Eski ana adrese giderek sitenin otomatik yönlendirme (301) yapıp yapmadığına bak
        if (!newUrl || !newUrl.match(/dizipal[0-9]+\.[a-z]+/)) {
            log(`[Auto-Domain] 2. Eski adres (${CONFIG.BASE_URL}) üzerinden 301 yönlendirmesi aranıyor...`, "system");
            try {
                await page.goto(CONFIG.BASE_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
                newUrl = page.url();
            } catch(e) {
                log(`[Auto-Domain] Yönlendirme testi başarısız.`, "warn");
            }
        }

        if (newUrl && newUrl.includes('dizipal')) {
            newUrl = newUrl.replace(/\/$/, "");
            if (newUrl !== CONFIG.BASE_URL) {
                log(`[Auto-Domain] BAŞARILI! Yeni adres tespit edildi: ${newUrl}`, "system");
                CONFIG.BASE_URL = newUrl;
            } else {
                log(`[Auto-Domain] Adres değişmemiş, mevcut ${CONFIG.BASE_URL} güncel.`, "system");
            }
        } else {
            log(`[Auto-Domain] Yeni adres bulunamadı, mevcut adres kullanılıyor.`, "warn");
        }
        await page.close().catch(()=> { });
    } catch (e) {
        log(`[Auto-Domain] Hata: ${e.message}`, "error");
    } finally {
        isFindingDomain = false;
    }
    return CONFIG.BASE_URL;
}

// -------------------------------------------------------------
// AŞAMA 4: Katalog Meta Çekici (Detay Sayfası & Binge Watching)
// -------------------------------------------------------------
async function scrapeMeta(type, id) {
    const normalizedId = id.includes(":") ? id : `dizipal:${id}`;
    const slug = normalizedId.split(":")[1];
    
    const cacheKey = `meta:${normalizedId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const browser = await getBrowser();
    const page = await browser.newPage();
    await setupPage(page);
    try {
        await page.setUserAgent(CONFIG.UA);
        await page.setRequestInterception(true);
        page.on("request", (req) => {
            const url = req.url().toLowerCase();
            if (url.includes("disable-devtool") || url.includes("disabledevtool")) {
                req.abort().catch(() => {});
            } else if (["image", "font", "stylesheet", "media"].includes(req.resourceType())) {
                req.abort().catch(() => {});
            } else {
                req.continue().catch(() => {});
            }
        });
        let targetUrl = type === 'series' 
            ? `${CONFIG.BASE_URL}/series/${slug}/` 
            : `${CONFIG.BASE_URL}/movies/${slug}/`;
            
        log(`[Meta] Sayfa açılıyor: ${targetUrl}`, "system");
        let response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        
        if (!response || response.status() === 404) {
            targetUrl = type === 'series' 
                ? `${CONFIG.BASE_URL}/dizi/${slug}/` 
                : `${CONFIG.BASE_URL}/${slug}/`;
            log(`[Meta] Adres 404 döndü, alternatif deneniyor: ${targetUrl}`, "system");
            response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        }
        
        const metaInfo = await page.evaluate(() => {
            const title = document.querySelector('h1')?.innerText || "Bilinmeyen İçerik";
            const desc = document.querySelector('.ozet p, .summary, .description')?.innerText || "Açıklama bulunamadı.";
            const imgEl = document.querySelector('.poster img, .cover img');
            let img = imgEl ? imgEl.src : "";
            if (img.startsWith("//")) img = "https:" + img;

            const imdb = document.querySelector('.imdb, .rating, .score')?.innerText?.replace(/[^0-9.]/g, '') || "8.0";
            
            // Oyuncular
            const castTags = Array.from(document.querySelectorAll('.cast a, .oyuncular a')).map(a => a.innerText);
            
            const videos = [];
            const epLinks = Array.from(document.querySelectorAll('.episodes a, .bolumler a, ul.ep-list li a, .episode-item h4 a, .episode-item a, a[href*="/bolum/"]'));
            
            epLinks.forEach((a, index) => {
                if (!a.href) return;
                const epUrl = a.href;
                const epTitle = a.innerText.trim();
                
                const pathParts = new URL(epUrl).pathname.split('/').filter(Boolean);
                const epSlug = pathParts[pathParts.length - 1];

                let season = 1;
                let episode = index + 1;
                
                const matchX = epSlug.match(/-(\d+)x(\d+)$/i);
                const matchSezon = epSlug.match(/-(\d+)-sezon-(\d+)-bolum/i);
                
                if (matchX) {
                    season = parseInt(matchX[1]);
                    episode = parseInt(matchX[2]);
                } else if (matchSezon) {
                    season = parseInt(matchSezon[1]);
                    episode = parseInt(matchSezon[2]);
                }

                videos.push({
                    id: `dizipal:${epSlug}`,
                    title: epTitle || `Bölüm ${episode}`,
                    season: season, 
                    episode: episode
                });
            });

            return { title, desc, img, imdb, cast: castTags, videos };
        });

        const metaObj = {
            id: id,
            type: type,
            name: metaInfo.title,
            description: metaInfo.desc,
            poster: metaInfo.img || CONFIG.LOGO_URL,
            background: metaInfo.img || CONFIG.LOGO_URL,
            cast: metaInfo.cast,
            imdbRating: metaInfo.imdb,
            behaviorHints: {
                defaultVideoId: metaInfo.videos.length > 0 ? metaInfo.videos[0].id : null
            }
        };

        if (type === 'series' && metaInfo.videos.length > 0) {
            metaObj.videos = metaInfo.videos;
        }

        cacheSet(cacheKey, metaObj, 24 * 60 * 60 * 1000); // 1 day
        return metaObj;
    } catch (e) {
        log(`[Meta] Veri çekilemedi: ${e.message}`, "error");
        // Fallback dön
        return {
            id: id,
            type: type,
            name: slug.replace(/-/g, ' ').toUpperCase(),
            description: "Detaylar alınamadı.",
            poster: CONFIG.LOGO_URL,
            background: CONFIG.LOGO_URL
        };
    } finally {
        await page.close().catch(()=> { });
    }
}

function getBrowserStatus() {
    return _browser && _browser.connected;
}

module.exports = {
  getBrowser,
  fetchTitle,
  fetchTitleInfo,
  toSlug,
  scrapeM3U8,
  getBrowserStatus,
  findCurrentDizipalDomain,
  scrapeMeta,
  setupPage
};
