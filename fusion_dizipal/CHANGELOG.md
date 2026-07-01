# Changelog

## [2.4.2] - 2026-07-01
### Fixed
- **Reliably pin the whole chain to the working `.bid` mirror**: v2.4.1's "is the main domain challenged?" probe was unreliable — the main domain's homepage often loads clean at probe time, so it stayed on `dizipal1559`, then failed during the actual scrape (`Yayın linki bulunamadı`). Replaced the flaky challenge check with a positive **content verification**: auto-domain loads `mirror/diziler/` (up to 3 tries, 30s each to absorb cold-start slowness on headful/ARM) and, if it returns real content links, pins `BASE_URL` to the mirror for the whole chain. Verified end-to-end locally: auto-domain → `BASE=.bid` → search resolves → scrapeMeta returns episodes → scrapeM3U8 captures a valid `master.m3u8`.

## [2.4.1] - 2026-07-01
### Fixed
- **Route the entire streaming chain to the working mirror when the main domain is Cloudflare-walled**: v2.4.0 fixed catalog via .bid, but streaming still failed because meta + episode-resolution + m3u8 scraping all use `CONFIG.BASE_URL`, which auto-domain set to the Cloudflare-challenged main domain (dizipal1559). Verified locally that `.bid` fully serves streaming (scrapeMeta resolves 18 episodes via the `/dizi/` WordPress fallback, and scrapeM3U8 captures a valid `master.m3u8`). Auto-domain now probes the discovered main domain for a Cloudflare challenge and, if challenged (or unreachable), sets `BASE_URL` to the mirror — so the whole chain (catalog, search, meta, m3u8, proxy) runs on the domain that actually works. Environments where the main domain is reachable are unaffected (verified: no false-positive fallback).

## [2.4.0] - 2026-07-01
### Changed
- **Prefer the working `.bid` mirror; the rotating main domain is Cloudflare-walled**: Network diagnosis from the HA host (residential Turk Telekom IP, Istanbul) showed the rotating main domain (`dizipal1559`) returns HTTP 403 "Just a moment" (Cloudflare **managed challenge**) that the browser can't pass from this environment, while the fixed WordPress mirror `dizipal.bid` returns HTTP 200 with no challenge. The earlier headful/Xvfb and disable-devtool work was chasing the wrong layer — the blocker is Cloudflare on the main domain, not headless detection. Catalog/search now try `mirror_url` (.bid) **first** and only fall back to the main domain.
  - `gotoResilient` now logs the HTTP status + final URL and detects Cloudflare challenge (`_cf_chl_opt` / "Just a moment"), returning early so it doesn't try to scrape a challenge page; goto timeout raised to 25s.
  - Auto-domain mirror probe switched from `networkidle2` (which always timed out on .bid's ad/tracker traffic) to `domcontentloaded`.
  - Catalog browsing now works from HA via .bid. Search/streaming resolution is still limited: the main domain's good AJAX search is Cloudflare-blocked and the .bid WordPress search is weak — under investigation with the new per-domain diagnostics.

## [2.3.9] - 2026-07-01
### Changed
- **Force headful + diagnostics**: v2.3.8 headful/Xvfb still hit `Execution context was destroyed` on HA, so this release removes remaining unknowns. `headless` is now forced off in code (a carried-over `headless: true` saved option can no longer keep the browser headless). Added startup diagnostics logging the actual browser mode and `DISPLAY` (confirms Xvfb is active), and a `framenavigated` logger in search that records exactly where the page redirects to — evidence needed to tell an anti-bot `about:blank` redirect apart from a normal site navigation.

## [2.3.8] - 2026-06-30
### Changed
- **Headful Chromium under Xvfb (architectural anti-bot fix)**: The `disable-devtool` protection on dizipal1559 kept defeating the headless bypasses (window-size mock, service-worker block, settle wait) specifically in the HA Debian-chromium environment, redirecting the page mid-scrape and throwing `Execution context was destroyed`. Rather than chase another headless-detection vector, the add-on now runs Chromium **headful** inside a virtual display (Xvfb), which makes the browser indistinguishable from a real GUI session and neutralizes headless heuristics at the root.
  - Dockerfile: install `xvfb`, `xauth`, and headful GTK/X11 libs (`libgtk-3-0`, `libx11-xcb1`, `libxss1`, `libxtst6`); launch via `xvfb-run -a ... node server.js`.
  - Default `headless` option flipped to `false`; launch passes `--window-size=1280,1024`.
  - Note: the `dizipal.bid` mirror is unreachable from some HA networks (15s timeouts); the primary auto-domain (dizipal1559) path is what streaming relies on.

## [2.3.7] - 2026-06-30
### Fixed
- **Search "Execution context was destroyed" on HA (domain rotated to dizipal1559)**: In the Home Assistant environment the `disable-devtool` script redirects the page ~1-2s after load — while the AJAX search was focusing/typing into `#searchInp` — destroying Puppeteer's execution context and failing the attempt. Added a 1.2s settle + liveness re-check before interacting (so the redirect fires and is caught as about:blank first), made `searchOnce` fully defensive (never throws on a destroyed context — returns empty so retry engages), and raised search attempts from 2 to 3. Search now resolves on the first attempt instead of burning one to the redirect.

## [2.3.6] - 2026-06-30
### Fixed
- **Empty Catalog & Search (root cause: type misclassification)**: Movies never appeared in the catalog because content type was detected with `a.href.includes('dizi')` — but the domain itself (`dizipal.bid` / `dizipal1558`) contains the substring "dizi", so *every* item was classified as a series. Type detection now runs on the URL **pathname** (`/dizi/`, `/series/`, `sezon`, `bolum`), so movies are correctly identified.
- **about:blank Anti-Bot Resilience**: The `disable-devtool` script still redirects headless Chrome to `about:blank` ~50% of the time, and the scraper did a single `goto` with no retry — landing on about:blank returned empty results. Added `gotoResilient` which detects about:blank and retries (3× for catalog, 2× for search) across both `base_url` and `mirror_url`.
- **Mirror Fallback**: Catalog/search now actually try `mirror_url` (dizipal.bid) when the primary domain fails, instead of only using it for domain discovery.
- **DOM-Drift-Proof Card Detection**: Content cards no longer carry `data-dizipal-pageloader` (that attribute moved to nav/menu links). The scraper now scans all `<a>` elements and validates each by known path prefix **or** a real content poster (`wp-content/uploads`/CDN), catching WordPress-mirror root-level movies (`/cam-sehpa/`) while filtering out ad banners and title-less chrome.
- **Search Relevance**: When the AJAX results box fails to populate, the scraper no longer falls back to scraping the entire homepage (which returned irrelevant "izle" placeholder items); it returns empty so retry/mirror logic engages. Results are capped at 30.

## [2.3.5] - 2026-06-29
### Fixed
- **Advanced Anti-Bot Bypass**: Fixed a critical issue where `DOM.resolveNode` errors and timeouts occurred during AJAX searches. The site's `disable-devtool-auto` protection script was detecting headless Chrome via window dimensions and redirecting to `about:blank` midway through the search. Added a new `evaluateOnNewDocument` bypass that overrides `window.outerWidth` and `window.outerHeight` to match `innerWidth/Height`, successfully defeating the bot protection and restoring search and stream scraping.

## [2.3.4] - 2026-06-29
### Fixed
- **Catalog Empty Results Fix**: Fixed a bug where catalog loading would return 0 items. The scraper was slicing the first 30 menu links (which are later filtered out) instead of waiting to filter valid media cards first.
- **Search Poster Base64 Fix**: Fixed an issue where AJAX search results returned a 1x1 transparent base64 placeholder image as the poster instead of the real image. Added parsing for the `data-srcset` attribute used by Dizipal for lazy-loading images in search results.
- **Platform Links Filtering**: Added `platform` to the invalid slugs list to prevent menu categories like Netflix/Exxen from appearing in the catalog.

## [2.3.3] - 2026-06-28
### Fixed
- **Hardened Anti-Bot Bypass with Service Worker Interception:** Fixed a critical headless browser crash that resulted in the error `Protocol error (DOM.describeNode): Cannot find context with specified id`. The site registers a Service Worker that was caching the `disable-devtool` protection script. This cached script bypassed Puppeteer's standard network request interceptors and executed, immediately identifying the headless browser and redirecting it to `about:blank`. Added `page.setBypassServiceWorker(true)` and `page.setCacheEnabled(false)` to all page creation flows, successfully blocking the devtools protection script from running and preventing any headless browser detection redirects.
- **Robust lowercase blocklists:** Updated all request interceptors to block `disabledevtool` variations case-insensitively.
## [2.3.2] - 2026-06-28
### Added
- **Detailed Search Timeout Diagnostics:** Added automatic page HTML capturing and logging on search timeouts inside `scrapeSearch`. If the search results container `#searchAjaxCallback` fails to populate within 10 seconds, it will log the warning with the current URL and dump the entire page content to `search_timeout.html` in the extension root to diagnose potential Cloudflare WAF/Turnstile challenge screens or JS execution issues.
- **Improved Native Puppeteer Search Interactions:** Replaced the programmatic value setter in `scrapeSearch` with native Puppeteer page typing (`page.type`) with a 50ms delay, native keyboard Enter presses (`page.keyboard.press`), and programmatic click fallbacks. This fires all input/change events properly, satisfying any client-side form validation and debouncing scripts that may have otherwise caused empty/failed AJAX POST submissions.
## [2.3.1] - 2026-06-28
### Fixed
- **Cloudflare-Resistant Episode URL Resolution via Puppeteer:** Fixed a critical bug in `proxy.js` where Node's native `fetch()` was used to load the series detail page (e.g. `/series/widows-bay/`) to resolve the target episode slug. Because Dizipal is protected by Cloudflare WAF/IUAM, these programmatic HTTP requests were getting blocked with a `403 Forbidden` challenge, causing it to fall back to generating the default WordPress-style URL (`/bolum/widows-bay-1-sezon-1-bolum-izle/`). This default URL was returning a 404, causing the scraper to time out. Refactored the episode resolver to use the Cloudflare-bypassing Puppeteer helper `scrapeMeta('series', baseSlug)`.
- **Dynamic Path Prefixes Fallback in scrapeMeta:** Added a smart fallback mechanism in `scrapeMeta` that dynamically probes `/series/${slug}/` and `/movies/${slug}/` first. If the server returns a 404, it automatically falls back to WordPress paths (`/dizi/`, `/`), ensuring perfect catalog page resolution across both layouts.
- **Normalized ID Input in scrapeMeta:** Enabled `scrapeMeta` to accept both raw slugs (`widows-bay`) and Stremio IDs (`dizipal:widows-bay`) interchangeably.
## [2.3.0] - 2026-06-28
### Added
- **AJAX-Based Live Search Integration:** Refactored `scrapeSearch` in `catalog.js` to perform native AJAX search submissions. The custom Dizipal layout does not support traditional GET search parameter queries (`/?s=query`), which was returning the default home page and causing the scraper to matching trending lists instead of search results. The search logic now automatically detects if an AJAX input (`#searchInp`) exists on the page: if present, it fills the input programmatically and triggers the AJAX search button (`.searchbtn`), waiting for the results to populate inside `#searchAjaxCallback`. If not present (e.g. on standard WordPress mirrors like `dizipal.bid`), it falls back to standard GET search queries.
- **Strict Selector Isolation for Search Results:** Constrained `scrapeSearch` to target *only* the links within `#searchAjaxCallback` when using the AJAX layout. This completely prevents trending sliders or sidebars from hijacking search results, ensuring a 100% accurate match.
## [2.2.1] - 2026-06-28
### Added
- **Dynamic Episode-to-Series IMDb ID Resolution:** Fixed a major metadata resolution gap where Stremio sends the specific IMDb ID of the *episode* (e.g. `tt31185568` for From S3E4 "Widow's Bay") instead of the *series* IMDb ID (`tt9813792:3:4`). Previously, the API fetched the episode's title ("Widow's Bay") and searched Dizipal for it, which returned no matches (falling back to trending results like `from-c04` and loading the main series page instead of the episode page, causing a timeout). Refactored `fetchTitleInfo` to inspect the OMDb response: if `Type === "episode"`, it uses the `seriesID` field to fetch the parent series title ("From") and automatically reconstructs the season/episode info in the request, resolving the stream URL flawlessly.
- **Scraper Target URL Logs:** Added logging in `scrapeM3U8` to explicitly log the final target page URL (`pageUrl`) visited by Puppeteer, facilitating easier log inspections.
- **Environment Override for CHROMIUM_PATH:** Added support to override the hardcoded chromium path in `config.js` via the `CHROMIUM_PATH` environment variable, enabling local testing on macOS without modifying configuration files.
## [2.2.0] - 2026-06-28
### Fixed
- **Content Grid Selector Isolation in Catalog Parser:** Fixed a critical bug in `catalog.js` where the parser accidentally matched side-channel menu links like `exxen`, `netflix`, and `amazon` (which are marked with `data-dizipal-pageloader="true"` in the navigation menu). Because the navigation menu loaded first in the DOM tree, it overrode the actual search results and catalog items, leading to `exxen` being matched as the slug for unrelated movies and series (e.g. Cape Fear). Implemented a strict path structure filter ensuring that only paths with correct lengths and allowed prefixes (`/series/`, `/movies/`, `/dizi/`, `/bolum/`) are parsed, isolating the search/catalog completely.
## [2.1.9] - 2026-06-28
### Fixed
- **Logo/Menu Link Hijacking in Catalog Parser:** Fixed a critical bug in `catalog.js` where the page parser matched the site's logo/header links (which point directly to the base domain without a slug) as content cards. This resulted in `undefined` slugs being parsed and selected as the first search/catalog results, leading to broken stream lookups. Added a strict filter to discard empty slugs and static menu paths (such as `/yabanci-dizi-izle`, `/hd-film-izle`, etc.).
## [2.1.8] - 2026-06-28
### Added
- **Anti-Devtool / Anti-Headless Bypass:** Added request interception rules across all Puppeteer page navigations to block `disable-devtool` script downloads from `cdn.jsdelivr.net`. The Dizipal website recently integrated this anti-debugging script which detects headless browsers (Puppeteer) and automatically redirects them to a dummy 404 page (`https://theajack.github.io/disable-devtool/404.html`), completely blocking catalog and stream resolution. Aborting these script requests successfully bypasses the detection, restoring full functionality.
## [2.1.7] - 2026-06-28
### Added
- **Headless User-Agent Bypasses:** Set standard Chrome User-Agent header via Puppeteer's `page.setUserAgent()` in `scrapeM3U8`, `scrapeMeta`, `findCurrentDizipalDomain`, and `catalog.js`. This resolves `403 Forbidden` response blocks from video hosts (like `x.ag2m4.cfd`) when they detect headless scrapers.
- **Dynamic Series Path Fallbacks:** Added fallbacks in `proxy.js` to dynamically fetch `/dizi/` path prefixes if the standard `/series/` prefix returns a 404. This provides seamless compatibility with WordPress-based Dizipal mirrors (like `dizipal.bid`) that use the `/dizi/` path structure.
## [2.1.6] - 2026-06-28
### Removed
- **Express Rate Limiter:** Completely removed `express-rate-limit` from `/catalog`, `/stream`, and `/proxy-stream`. In Dockerized Home Assistant environments, all incoming traffic from the outside world enters through the HA supervisor proxy, meaning Express sees all requests as coming from the same local IP. This caused the rate limiter to trigger immediately and silently drop Stremio catalog and search requests with HTTP 429 errors (without running handlers or logging them), leaving the catalog empty.
## [2.1.5] - 2026-06-28
### Added
- **Hybrid DOM Layout Parser Support:** Added fallbacks to also support the older WordPress `post-item` layout tags (`.post-item a`, `.item a`, `.video-card a`) in addition to the new `data-dizipal-pageloader` structures. This ensures that even if the eklenti resolves or redirects to mirror clones like `dizipal.bid`, it will successfully parse and populate catalogs and searches.
## [2.1.4] - 2026-06-28
### Fixed
- **Auto-Domain False-Positive Fix:** Resolved a critical bug where the domain-finder regex `/dizipal[0-9]*\.[a-z]+/` was too loose and matched the mirror landing page `dizipal.bid` (since it matched zero digits). The mirror page is a WordPress clone and does not support streams or the new catalog layout. Updated the regex to require digits (`/dizipal[0-9]+\.[a-z]+/`), preventing the addon from falsely switching the base URL to `dizipal.bid` and locking it back onto the working `dizipal1558.com` domain.
## [2.1.3] - 2026-06-28
### Fixed
- **Force Update Synchronization:** Bumped version to explicitly trigger Home Assistant Add-on Store update notification, ensuring all users receive the critical `2.1.2` proxy and binge-watching fixes that were pushed simultaneously.

## [2.1.2] - 2026-06-28
### Fixed
- **Binge-Watching Episode DOM Fix:** Discovered that Dizipal also changed the layout in the series page. They removed `.episode-item` and `.episodes` classes. Updated `scrapeMeta` in `scraper.js` to parse episodes via raw `a[href*="/bolum/"]` selector, restoring Stremio Binge-Watching capabilities.
- **Smart Episode Slug Fallback:** Updated `proxy.js` to fetch the series page dynamically when an exact episode format isn't found. This prevents 404 stream errors for series that use alternative slug formats like `1x1` instead of `1-sezon-1-bolum-izle`.
## [2.1.1] - 2026-06-28
### Fixed
- **Puppeteer Hang Fix:** Removed `puppeteer-extra-plugin-adblocker`. This plugin was attempting to download adblock filter lists on fresh Docker container launches (Rebuilds). Due to network blocks or timeouts on `easylist.to`, the list download would hang indefinitely, causing the entire browser launch process and Auto-Domain check to freeze without throwing an error. Since we already block `image`, `font`, `stylesheet`, and `media` via our own request interception, the plugin was redundant and caused fatal hangs.

## [2.1.0] - 2026-06-28
### Fixed
- **Major DOM Parsing Rewrite:** Dizipal completely removed universal container classes (`.post-item`, `.item`, etc.) from their search and catalog pages. The scraper now relies on their raw anchor tag attributes (`data-dizipal-pageloader="true"` and `data-dizipalx-pageloader="true"`). This fully restores the Catalog and Search capabilities which were previously returning empty arrays.

## [2.0.9] - 2026-06-28

### Fixed
- Fixed TMDB Fallback Logic: Handled Dizipal search results returning episodes directly (e.g., `cape-fear-1x5`) instead of series slugs. The proxy now uses Regex `/-(\d+x\d+|\d+-sezon-\d+-bolum(?:-izle)?)$/i` to strip the episode suffix and correctly format the requested Season and Episode.

## [2.0.8] - 2026-06-28

### 🐛 Fusion Protocol / Manifest Fix
* **Arama ve Binge-Watching Düzeltildi:** `server.js` içerisinde dönülen `/manifest.json` rotasında `meta` kaynağı (resource) ve kataloglar için `search` özelliği eksikti. Bu eksiklikler giderildi. Artık Fusion Media Player'da arama sonuçları listelenecek ve detay/bölüm (Binge-Watching) ekranları sorunsuz çalışacaktır.

## [2.0.7] - 2026-06-28

### 🚀 Auto-Domain (Mirror) Düzeltmesi
* **Mirror Domain Sınırlandırması Kaldırıldı:** Dizipal, daha önce sadece bir yönlendirici olan `dizipal.bid` adresini artık ana yayın sitesi olarak kullanmaya başlamış. Ancak `scraper.js` içindeki Auto-Domain mantığı `dizipal.bid` adresini "geçerli olmayan ana domain" olarak görüp reddediyordu. Bu kural kaldırılarak sistemin doğrudan `dizipal.bid` adresine geçiş yapması (ve böylece zaman aşımlarından kurtulması) sağlandı.

## [2.0.6] - 2026-06-28

### 🐛 Fusion Protocol / Manifest Fix
* **Arama ve Binge-Watching Düzeltildi:** `server.js` içerisinde dönülen `/manifest.json` rotasında `meta` kaynağı (resource) ve kataloglar için `search` özelliği eksikti. Bu eksiklikler giderildi. Artık Fusion Media Player'da arama sonuçları listelenecek ve detay/bölüm (Binge-Watching) ekranları sorunsuz çalışacaktır.

## [2.0.5] - 2026-06-28

### 🚀 Arama Motoru (Search) ve Auto-Domain Düzeltmeleri
* **Stremio Arama Desteği:** Stremio üzerindeki genel aramalar (`/search=query`) için Express rotaları oluşturuldu ve `manifest.json` dosyasına eklendi. Artık Stremio'dan arama yapıldığında dizipal sonuçları katalogda görüntülenebilir.
* **Auto-Domain Başlatıcı:** Auto-domain kontrol kodu (`findCurrentDizipalDomain`) arka planda yazılmış olsa da tetikleyici eksikliği nedeniyle hiç çalışmıyordu. Sunucu başlangıcına tetikleyici eklendi.
* **IMDB İsim Eşleştirme (Cape Fear Hatası):** İngilizce IMDB aramalarının Dizipal üzerindeki Türkçe çeviri linklerini (`slug`) bulamaması sorunu çözüldü. Artık isim tahmini başarısız olursa, eklenti arka planda Dizipal'in kendi arama motorunu (`?s=query`) kullanarak doğru linki buluyor.

## [2.0.4] - 2026-06-28

### 🐛 Pino Modül Hatası Giderildi
* Eklentinin hızlanması ve CPU/RAM dostu çalışabilmesi için geçilen yüksek performanslı loglama altyapısı "Pino"nun otomatik kurulum listesinde (`package.json`) eksik olduğu tespit edildi. Pino eklendi ve çökme sorunu kalıcı olarak çözüldü.

## [2.0.3] - 2026-06-28

### 🛡️ Güvenlik ve Optimizasyon
* **Home Assistant Güvenlik Puanı (Security Rating):** Eklentinin Home Assistant ana klasörlerine (`/config`) olan okuma/yazma erişim izni güvenlik amacıyla tamamen kaldırıldı. Ayrıca `apparmor: true` profili aktif edilerek eklentinin Home Assistant Güvenlik Puanı (Security Rating) en yüksek/kusursuz seviyeye çıkartıldı.

## [2.0.2] - 2026-06-28

### 🐛 Kritik Docker Hatası Düzeltildi
* **Modül Bulunamadı (MODULE_NOT_FOUND):** Kodları okunaklı olması için `server.js`, `scraper.js`, `config.js` gibi modüllere parçaladığımızda, Docker konteyneri derlenirken sadece `server.js` dosyasının kopyalanması unutulmuştu. `Dockerfile` düzeltildi ve artık eklenti kusursuz bir şekilde ayağa kalkabiliyor.

## [2.0.1] - 2026-06-28

### 🛡️ Geliştirmeler
* **Dual-Fallback Auto-Domain:** Otomatik domain bulucu sisteme ikinci bir güvenlik katmanı eklendi. Sistem artık önce `mirror_url` (`dizipal.bid`) adresini deniyor, eğer oradan sonuç alamazsa ana sitenin (`dizipal1558.com`) kendi içerisindeki 301 yönlendirmesini takip ederek yeni adresi buluyor.

## [2.0.0] - 2026-06-28

### 🏆 MASTER SÜRÜM: Kapsamlı Revizyon
* **Otomatik Domain Bulucu (Auto-Domain):** Dizipal adres değiştirdiğinde (`dizipal1558.com` vs) sistem artık eklenti yapılandırmasında bulunan `mirror_url` (`dizipal.bid`) üzerinden yeni adresi tespit edip kendi kendini güncelleyebiliyor.
* **Çözünürlük Seçici:** Oynatma listesindeki (M3U8) `1080p`, `720p` gibi çözünürlük seçenekleri ayrıştırıldı ve Stremio'da ayrı ayrı butonlar olarak listeleniyor.
* **Katalog Meta Yönlendiricisi (Afiş Detayları):** Ana ekrandaki katalog öğelerine tıklandığında Dizipal'e ait olan güncel detaylar, oyuncular ve arka plan görselleri Stremio sayfasına ekleniyor (`/meta`).
* **Binge-Watching (Kesintisiz Dizi):** Dizi bölümleri `meta` yönlendiricisinde listelendi ve Stremio'nun bölümler arası otomatik geçiş özelliği (Pre-fetching) aktif hale getirildi.

## [1.7.1] - 2026-06-28

### 🐛 Hata Düzeltmeleri
* **Kurulum (Build) Hatası Çözüldü:** Yeni eklenen `express-rate-limit` ve `puppeteer-extra-plugin-adblocker` paketlerinin isimleri kurulum yapılandırmasına eklendiği için artık derleme esnasında çıkan hata giderildi.

## [1.7.0] - 2026-06-28

### 🌍 Yerelleştirme ve Veri Geliştirmesi
* **TMDB API (Türkçe İsim) Entegrasyonu:** Yerli yapımlarda ve Türkçe isimle siteye eklenen filmlerde yaşanan "İsim/Link Bulunamadı" sorunu çözüldü. Eklenti ayarlarına `tmdb_api_key` seçeneği eklendi. TMDB anahtarı girildiğinde dizi/filmlerin Türkçe isimleri çekilerek (Örn: "10 Thousand Steps" yerine "10 Bin Adım") link oluşturulacak. TMDB bulunamazsa veya anahtar girilmezse otomatik olarak OMDb (İngilizce) sistemine düşülecek (Dual Fallback).

## [1.6.0] - 2026-06-28

### ⭐ Premium (Aşama 3) Özellikler
* **Katalog Desteği:** Stremio ana ekranına Dizipal'den çekilen filmleri ve dizileri getiren dinamik katalog sistemi eklendi (`/catalog`).
* **Akıllı Proxy (Token Fallback):** Yayın esnasında kopmaları önlemek için proxy sistemine zeka eklendi. Hedef sunucu 403 Forbidden dönerse yayın donmadan arka planda yeni token alınarak kesintisiz devam ediyor.
* **Altyazı Avcısı (Subtitle Hunter):** M3u8 dışındaki `.vtt` ve `.srt` uzantılı Türkçe altyazı dosyaları otomatik tespit edilip Stremio'ya iletiliyor.
* **Canlı Dashboard:** Home Assistant içerisindeki arayüz artık sayfayı yenilemeden çalışıyor. Sistem durumunu ve arka plan loglarını (AJAX) canlı gösteren matrix ekranına geçildi.


## [1.5.0] - 2026-06-28

### 🚀 Eklendi (Added)
* **Kullanıcı Paneli (Dashboard):** Eklenti arayüzü (Ingress) üzerinden erişilebilen, sistemin anlık durumunu gösteren yeni bir yönetim paneli eklendi.
* **Adblocker Entegrasyonu:** Puppeteer altyapısına güçlü bir reklam engelleyici dahil edildi. Performans ciddi ölçüde arttı.
* **Rate Limiting:** API rotalarına dakikada 30 istek limiti getirilerek çökme ve aşırı yüklenme riskleri sıfırlandı.

### 🛠 Değiştirildi (Changed)
* **Modüler Mimari:** Tüm kod (server.js); `config`, `cache`, `scraper`, `proxy` ve `dashboard` modüllerine ayrılarak daha yönetilebilir hale getirildi.
* **Modern Loglama:** Eski yapı yerine profesyonel, Docker ile tam uyumlu `pino` logger entegre edildi.
* **Native Fetch API:** OMDb bağlantıları Node.js native `fetch()` altyapısına geçirildi.
* **Önbellek (Cache):** Daha stabil bellek yönetimi için TTL (Yaşam süresi) destekli `lru-cache` kütüphanesine geçildi.

### 🔐 Güvenlik (Security)
* **SSRF Koruması:** Dahili proxy (`/proxy-stream`) mekanizması kısıtlandı. Sadece .m3u8 ve .ts uzantılı medya dosyalarına erişim izni verecek filtreleme eklendi.

## [1.4.3] - 2026-04-14

### 🚀 Eklendi (Added)
* **Gelişmiş Hata Bildirimleri:** Artık bir hata oluştuğunda (API limiti, siteye erişim sorunu vb.) Stremio/Fusion ekranında boş liste yerine "⚠️ BİLGİ" başlığıyla açıklayıcı bir hata mesajı görünecek.
* **Log Temizliği & Performans Takibi:** Uygulama başladığında terminal otomatik temizlenir ve m3u8 link yakalama süreleri loglara yansıtılır.


### 🚀 Eklendi (Added)
* **Gelişmiş Loglama:** m3u8 linkinin ne kadar sürede yakalandığı (saniye cinsinden) ve OMDb üzerinden çözümlenen gerçek film/dizi isimleri loglara eklendi.
* **Log Temizliği:** Uygulama her başladığında veya güncellendiğinde terminaldeki eski oturum loglarını otomatik olarak temizleyen `console.clear()` mekanizması eklendi.

### 🛠 Düzeltildi (Fixed)
* **Sayfa Yaşam Döngüsü Güvenliği:** `scrapeM3U8` fonksiyonuna `try...finally` bloğu eklendi. Bu sayede navigasyon hataları veya zaman aşımı durumlarında bile Puppeteer sayfasının (`page.close()`) kesinlikle kapatılması sağlanarak RAM sızıntısı engellendi.
* **Hata Yönetimi:** Navigasyon sırasında oluşan küçük hataların link yakalama sürecini tamamen bozması engellendi; hata olsa dahi m3u8 isteğinin gelmesi için beklemeye devam ediliyor.

## 🛠 Düzeltildi (Fixed)
* **Boş Yanıt (Scraping) Sorunu:** Home Assistant OS (HAOS) kısıtlı Docker ortamında Chromium'un sayfa içeriğini çekememesi sorunu, `SYS_ADMIN` yetkisi geri verilerek ve tarayıcı bayrakları (`--disable-gpu` vb.) optimize edilerek çözüldü.
* **CORS Önceliği:** CORS middleware tanımı Express rotalarından en başa çekilerek, Stremio ve Fusion istemcilerinin tüm uç noktalara (manifest, stream) sorunsuz erişmesi sağlandı.
* **Bellek ve Bağlantı Yönetimi:** İstemci yayından çıktığında veya videoyu ileri/geri sardığında kaynak sunucuya açık kalan bağlantıların (`Socket Hang`) otomatik olarak yok edilmesi sağlandı.

### 🛠 Düzeltildi (Fixed)
* **Bellek Sızıntısı ve Ağ Optimizasyonu:** `/proxy-stream` rotasında istemci bağlantıyı kopardığında (video kapatıldığında veya ileri sarıldığında) arka plandaki proxy isteğinin (`pReq`) ve veri akışının (`pRes`) anında iptal edilmesi sağlandı. Bu sayede RAM ve ağ bant genişliği gereksiz yere tüketilmez.
* **Puppeteer Sayfa Kapatma Güvencesi:** `scrapeM3U8` fonksiyonuna `try...finally` bloğu eklendi. Navigasyon hatası veya zaman aşımı olsa dahi sayfanın (`page.close()`) kesinlikle kapatılması garanti altına alındı.
* **CORS Önceliği:** CORS middleware'i en başa alınarak Stremio/Fusion erişim hataları giderildi.

### 🛡️ Güvenlik (Security)
* **SYS_ADMIN Yetkisi:** Home Assistant OS altında Chromium'un sayfa işleyebilmesi (scraping) için gerekli olan kernel yetenekleri kararlılık adına korunmuştur.

### 🛠 Düzeltildi (Fixed)
* **Proxy Kaynak Yönetimi:** İstemci yayından ayrıldığında proxy isteğiyle birlikte veri akışının da sonlandırılması sağlandı.
* **Sayfa Kapatma Güvencesi:** Puppeteer tarafında hata oluşsa bile sayfanın kapatılması garanti altına alınarak RAM kullanımı optimize edildi.





