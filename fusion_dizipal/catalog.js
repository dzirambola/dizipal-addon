const { getBrowser, setupPage } = require('./scraper');
const { CONFIG, log } = require('./config');
const { cacheGet, cacheSet } = require('./cache');

// Dizipal DOM'u sık değişiyor ve içerik kartları artık sabit bir attribute ile
// işaretlenmiyor (eski `data-dizipal-pageloader` artık menü/navigasyon linkinde).
// Bu yüzden tüm <a>'lar taranıp geçerlilik kontrolü extractItems içinde yapılır:
// ya bilinen önek (/series/, /movies/, /dizi/, /film/) ya da kök seviyede gerçek
// içerik posteri (wp-content/uploads, CDN) taşıyan kartlar kabul edilir.

// Anti-bot betiklerini ve ağır kaynakları ağ seviyesinde engelleyen handler.
function attachInterceptors(page) {
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
}

// page.evaluate içinde (tarayıcı bağlamında) çalışır. Dışarıdan SADECE argüman
// alabilir; tüm yardımcılar fonksiyon içinde tanımlıdır.
function extractItems(selector, description, logoUrl) {
    const cards = Array.from(document.querySelectorAll(selector));
    const validItems = [];
    const seen = new Set();

    for (let a of cards) {
        // Üst sınır yüksek tutulur; tip filtresi ve 30'a kırpma çağıran tarafta
        // yapılır (sidebar linkleri sınırı doldurup asıl içeriği dışlamasın diye).
        if (validItems.length >= 120) break;
        if (!a.href) continue;

        const url = a.href;
        const urlObj = new URL(url, window.location.origin);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length === 0) continue;

        const slug = pathParts[pathParts.length - 1];
        const invalidSlugs = ["yabanci-dizi-izle", "hd-film-izle", "anime", "animeler", "filmler", "diziler", "yeni-eklenen-bolumler", "trendler", "film-izle", "series", "dizi", "bolum", "search", "movies", "platform", "kategori", "kanal", "giris-yap", "uyelik"];
        if (invalidSlugs.includes(slug.toLowerCase())) continue;

        const img = a.querySelector('img');

        // İçerik linkleri ya bilinen önekli (/series/slug, /dizi/slug) olmalı,
        // ya da WordPress mirror'daki filmler gibi kök seviyede ama GERÇEK içerik
        // posteri (wp-content/uploads veya CDN) taşımalı. Menü/reklam linkleri
        // (tema-asset görselli) bu sayede ayıklanır.
        if (pathParts.length >= 2) {
            const firstSegment = pathParts[0].toLowerCase();
            const validPrefixes = ["series", "movies", "dizi", "film", "bolum"];
            if (!validPrefixes.includes(firstSegment)) continue;
        } else {
            const raw = img ? (img.getAttribute('data-src') || img.getAttribute('data-srcset') || img.getAttribute('src') || '') : '';
            const realPoster = /uploads|cdn|hipter/i.test(raw) && !/themes|assets|logo|placeholder/i.test(raw);
            if (!realPoster) continue;
        }

        if (seen.has(slug)) continue;
        seen.add(slug);
        // Gerçek başlığı olmayan (reklam banner'ı / boş) kartları ele.
        const title = (a.title || (img && img.alt) || a.innerText || "").trim();
        if (!title || title.toLowerCase() === "izle") continue;

        let poster = logoUrl;
        if (img) {
            const dataSrcset = img.getAttribute('data-srcset');
            if (dataSrcset) {
                poster = dataSrcset.split(',')[0].split(' ')[0].trim();
            } else {
                poster = img.getAttribute('data-src') || img.src;
            }
            if (poster && poster.startsWith("data:image/")) {
                poster = logoUrl;
            }
        }
        if (poster && poster.startsWith("//")) poster = "https:" + poster;
        else if (poster && poster.startsWith("/")) poster = window.location.origin + poster;

        // Tip tespiti PATHNAME üzerinden yapılır; host adı "dizipal" zaten "dizi"
        // içerdiği için a.href ile kontrol her şeyi yanlışlıkla dizi sayardı.
        const p = urlObj.pathname.toLowerCase();
        const isSeries = /\/(dizi|series)\//.test(p) || p.includes('sezon') || p.includes('bolum');
        validItems.push({
            id: `dizipal:${slug}`,
            type: isSeries ? 'series' : 'movie',
            name: title,
            poster: poster,
            description: description
        });
    }
    return validItems;
}

// Bir sayfayı yükler; anti-bot about:blank yönlendirmesini tespit edip retry'lar.
// İçerik bulununca true, hiç bulunamazsa false döner.
async function gotoResilient(page, url, label) {
    let resp;
    try {
        resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    } catch (e) {
        log(`[${label}] goto hatası (${url}): ${e.message}`, "warn");
        return false;
    }
    const status = resp ? resp.status() : "?";
    // Cloudflare managed challenge tespiti (403/503 + "Just a moment" gövdesi).
    let challenged = false;
    try {
        challenged = await page.evaluate(() =>
            !!(window._cf_chl_opt || /just a moment|challenge-platform|cf-browser-verification/i.test(document.title + document.body?.innerText?.slice(0, 200)))
        );
    } catch (e) { /* bağlam yoksa aşağıda about:blank yakalanır */ }

    log(`[${label}] yüklendi: HTTP ${status}, url=${page.url()}${challenged ? " ⚠️ CLOUDFLARE CHALLENGE" : ""}`, "system");

    // disable-devtool / challenge bazen sayfayı about:blank'e atar.
    await new Promise(r => setTimeout(r, 600));
    if (page.url() === "about:blank") {
        log(`[${label}] about:blank yönlendirmesi (${url})`, "warn");
        return false;
    }
    if (challenged) return false; // challenge'lı sayfadan içerik çıkmaz; retry/diğer domain
    return true;
}

async function scrapeCatalog(type) {
    const cacheKey = `catalog:${type}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const path = type === "series" ? "/diziler/" : "/filmler/";
    // MIRROR (.bid, WordPress) ÖNCE denenir: ana rotasyon domaini (dizipalNNN)
    // çoğu ağdan Cloudflare managed challenge veriyor; .bid mirror'ı temiz çalışıyor.
    const bases = [...new Set([CONFIG.MIRROR_URL, CONFIG.BASE_URL].filter(Boolean))];
    const browser = await getBrowser();

    // Her domain için about:blank'e karşı 3 deneme; biri içerik verene kadar dene.
    for (const base of bases) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const page = await browser.newPage();
            try {
                await setupPage(page);
                await page.setUserAgent(CONFIG.UA);
                await page.setRequestInterception(true);
                attachInterceptors(page);

                const ok = await gotoResilient(page, base + path, `Katalog:${type}`);
                if (!ok) continue;

                // Tüm <a>'lar taranır; geçerlilik (önek veya gerçek poster) ve tip
                // ayıklaması extractItems + aşağıdaki filtrede yapılır.
                const items = await page.evaluate(extractItems, 'a', "Dizipal'den izle", CONFIG.LOGO_URL);
                const filtered = items.filter(i => i.type === type).slice(0, 30);
                if (filtered.length > 0) {
                    log(`[Katalog:${type}] ${filtered.length} sonuç (${base}, deneme ${attempt})`, "system");
                    cacheSet(cacheKey, filtered, 60 * 60 * 1000);
                    return filtered;
                }
            } catch (e) {
                log(`Katalog çekilemedi (${type}, ${base}, deneme ${attempt}): ${e.message}`, "error");
            } finally {
                await page.close().catch(() => {});
            }
        }
    }
    log(`Katalog tüm domain/denemelerde boş döndü (${type})`, "error");
    return [];
}

// Tek bir domain üzerinde aramayı dener (AJAX veya WordPress GET). Sonuç dizisi döner.
async function searchOnce(page, base, query) {
    // TANI: ana çerçeve her gezindiğinde nereye gittiğini logla (redirect hedefi).
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) log(`[Search][nav] → ${frame.url()}`, "system");
    });

    const ok = await gotoResilient(page, base, `Search`);
    if (!ok) return [];

    // disable-devtool yönlendirmesi etkileşim sırasında çalışma bağlamını yok
    // edebiliyor ("Execution context was destroyed"). Etkileşimden önce sayfanın
    // yerleşmesini bekle; yönlendirme olacaksa burada olsun ve about:blank yakalansın.
    await new Promise(r => setTimeout(r, 1200));
    let hasAjaxSearch;
    try {
        if (page.url() === "about:blank") return [];
        hasAjaxSearch = await page.evaluate(() => !!document.querySelector("#searchInp"));
    } catch (e) {
        log(`[Search] Sayfa bağlamı etkileşimden önce kayboldu (${base}): ${e.message}`, "warn");
        return [];
    }

    // Hangi selektörle ve hangi kapsamda sonuç çıkaracağımız: AJAX akışında
    // SADECE #searchAjaxCallback kutusu; WordPress GET akışında tüm sayfa.
    let resultSelector;

    if (hasAjaxSearch) {
        log(`[Search] AJAX araması (${base}): ${query}`, "system");
        try {
            await page.focus("#searchInp");
            await page.evaluate(() => { const i = document.querySelector("#searchInp"); if (i) i.value = ""; });
            await page.type("#searchInp", query, { delay: 50 });
            await page.keyboard.press("Enter");
            await page.evaluate(() => { const b = document.querySelector(".searchbtn"); if (b) b.click(); });
        } catch (err) {
            log(`[Search] AJAX giriş hatası: ${err.message}`, "warn");
        }
        const populated = await page.waitForFunction(() => {
            const el = document.querySelector("#searchAjaxCallback");
            return el && el.style.display !== "none" && el.innerHTML.trim() !== "";
        }, { timeout: 10000 }).then(() => true).catch(() => false);

        // Kutu dolmadıysa ana sayfayı tarayıp alakasız sonuç DÖNDÜRME; boş dön ki
        // retry / diğer domain devreye girsin.
        if (!populated) {
            log(`[Search] AJAX sonuç kutusu dolmadı, boş dönülüyor (${page.url()})`, "warn");
            return [];
        }
        resultSelector = '#searchAjaxCallback a';
    } else {
        const searchUrl = `${base}/?s=${encodeURIComponent(query)}`;
        log(`[Search] WordPress GET araması: ${searchUrl}`, "system");
        const ok2 = await gotoResilient(page, searchUrl, "Search");
        if (!ok2) return [];
        // Tüm <a>'lar; kök-seviye film sonuçları (/state-of-fear/) da yakalansın.
        // Geçerlilik/poster filtresi extractItems içinde.
        resultSelector = 'a';
    }

    // Katalog ile aynı çıkarım mantığı (tek kaynak, drift yok).
    try {
        return await page.evaluate(extractItems, resultSelector, "Dizipal Arama Sonucu", CONFIG.LOGO_URL);
    } catch (e) {
        log(`[Search] Sonuç çıkarımı sırasında bağlam kayboldu (${base}): ${e.message}`, "warn");
        return [];
    }
}

async function scrapeSearch(query, type) {
    const cacheKey = `search:${type}:${query}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // MIRROR (.bid, WordPress) ÖNCE denenir: ana rotasyon domaini (dizipalNNN)
    // çoğu ağdan Cloudflare managed challenge veriyor; .bid mirror'ı temiz çalışıyor.
    const bases = [...new Set([CONFIG.MIRROR_URL, CONFIG.BASE_URL].filter(Boolean))];
    const browser = await getBrowser();

    for (const base of bases) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const page = await browser.newPage();
            try {
                await setupPage(page);
                await page.setUserAgent(CONFIG.UA);
                await page.setRequestInterception(true);
                attachInterceptors(page);

                const items = await searchOnce(page, base, query);
                const filtered = items.filter(i => type ? i.type === type : true).slice(0, 30);
                if (filtered.length > 0) {
                    log(`[Search] ${filtered.length} sonuç (${base}, deneme ${attempt})`, "system");
                    cacheSet(cacheKey, filtered, 60 * 60 * 1000);
                    return filtered;
                }
            } catch (e) {
                log(`Arama yapılamadı (${query}, ${base}, deneme ${attempt}): ${e.message}`, "error");
            } finally {
                await page.close().catch(() => {});
            }
        }
    }
    log(`Arama tüm domain/denemelerde boş döndü (${query})`, "warn");
    return [];
}

module.exports = { scrapeCatalog, scrapeSearch };
