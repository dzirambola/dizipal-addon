# Dizipal Fusion Addon

Dizipal içeriklerini Fusion Media Center (Stremio uyumlu) protokolü üzerinden sunan, Puppeteer tabanlı gelişmiş bir Home Assistant eklentisidir. Bu eklenti, web üzerindeki içerikleri dinamik olarak tarar, m3u8 bağlantılarını ve altyazıları yakalar ve yerel ağınızda bir API/Manifest üzerinden servis eder.

## 🚀 Özellikler

* **Otomatik Adres Bulucu (Auto-Domain):** Dizipal sürekli domain değiştirse bile sistem `mirror_url` üzerinden ve 301 yönlendirmelerinden güncel adresi kendi kendine bulur. Bağlantı kopma sorunlarını tamamen ortadan kaldırır.
* **Katalog ve Meta Desteği:** Stremio ana ekranında Dizipal kataloğunu gezebilir; dizi/film posterleri, IMDB puanları, özetleri ve oyuncu kadrolarını detaylı şekilde görüntüleyebilirsiniz.
* **Çoklu Çözünürlük Seçici:** Yayınların desteklediği çözünürlükler (1080p, 720p, 480p) ayrıştırılarak Stremio'da ayrı seçenekler olarak sunulur. İnternet hızınıza en uygun kaliteyi seçebilirsiniz.
* **Binge-Watching (Kesintisiz Dizi İzleme):** Dizi bölümleri Stremio tarafından otomatik algılanır, bölüm sonuna gelindiğinde sıradaki bölüm arka planda önbelleğe alınarak tıpkı Netflix gibi anında başlatılır.
* **Otomatik Altyazı Yakalama:** Dizipal'deki gömülü JS altyazı dosyaları tespit edilip otomatik olarak Stremio oynatıcınıza aktarılır.
* **Akıllı Proxy ve Anti-Bot Aşımı:** `puppeteer-extra` ve `stealth` eklentisi ile Cloudflare/403 engellerini aşar. Tüm video trafiği Home Assistant üzerinden aktarılarak referer sorunları çözülür.

## 🏗️ Mimari (Architecture)

Bu eklenti, yerel ağınızda çalışan izole bir web kazıyıcı ve proxy sunucusu olarak dizayn edilmiştir. Arka planda şu teknolojiler ve yaklaşımlar kullanılır:

* **Puppeteer & Stealth:** Kaynak sitelerdeki gelişmiş bot korumalarını aşmak için Node.js tabanlı, arayüzsüz (headless) bir Chromium instance'ı çalıştırılır. `Stealth` eklentisi tarayıcı parmak izini gizleyerek gerçek bir kullanıcı simülasyonu yaratır.
* **Singleton Tarayıcı Lock Mekanizması:** Home Assistant kurulu cihazlarda (örn. Raspberry Pi) RAM darboğazını önlemek için, tarayıcı sadece istek geldiğinde ayağa kalkar. "Race condition" kilit mekanizması sayesinde aynı anda gelen çoklu izleme istekleri tek bir tarayıcı oturumu üzerinden sırayla işlenir.
* **Gelişmiş Stream Proxy & Range Headers:** Apple TV ve iPad Pro gibi modern cihazlardaki medya oynatıcılar, videoları ileri/geri sararken katı HTTP `Range` (byte-range) başlıkları talep eder ve CORS kısıtlamalarına takılırlar. Eklenti içindeki dahili Proxy rotası, bu başlıkları hedefe eksiksiz ileterek stream deneyiminin natif ve kesintisiz olmasını sağlar.

## 🛠 Kurulum (Home Assistant)

1. Home Assistant paneline gidin.
2. **Ayarlar** > **Eklentiler** > **Eklenti Mağazası** bölümüne girin.
3. Sağ üstteki üç noktadan **Depolar** (Repositories) seçeneğine tıklayın.
4. Depo URL'sini ekleyin:
   `https://github.com/dzirambola/hassio-addons`
5. Listede **Dizipal** eklentisini bulun ve **Yükle** butonuna basın.
6. Kurulum bittikten sonra **Başlat** butonuna tıklayarak eklentiyi çalıştırın.

## ⚙️ Yapılandırma

Eklenti ayarları (Configuration) sekmesinden aşağıdaki parametreleri özelleştirebilirsiniz:

| Seçenek | Açıklama | Varsayılan |
|---|---|---|
| base_url | İçeriklerin çekileceği ilk/güncel adres. (Sistem sonrasında kendi günceller) | https://dizipal1558.com |
| mirror_url | Otomatik adres bulucu için kullanılacak ayna (mirror) site. | https://dizipal.bid |
| port | API'nin yerel ağda yayın yapacağı port. | 7860 |
| cache_ttl_hours | Yayın linklerinin bellekte tutulma süresi (saat). | 12 |
| omdb_api_key | Film/Dizi meta verileri için OMDB API anahtarı. | trilogy |
| tmdb_api_key | Türkçe detaylar ve Katalog arkaplanları için TMDB API anahtarı. | (Boş) |
| headless | Tarayıcının arayüzsüz modda çalışması (Önerilen: true). | true |

> [!TIP]
> **Önemli:** Eklentinin tamamen Türkçe açıklamalar, oyuncular ve HD posterlerle çalışması için TheMovieDB'den (TMDB) ücretsiz bir API anahtarı alıp `tmdb_api_key` kısmına girmeniz şiddetle tavsiye edilir.

## 📺 Stremio Entegrasyonu

Eklentiyi başlattıktan sonra, Stremio destekli medya oynatıcınıza eklemeniz gereken Manifest URL'si şöyledir:

`http://<HOME_ASSISTANT_IP>:7860/manifest.json`

*(Not: `<HOME_ASSISTANT_IP>` kısmına, eklentinin kurulu olduğu Home Assistant cihazınızın yerel IP adresini yazmalısınız. Örn: `192.168.1.100`)*

---

## ⚖️ Yasal Uyarı (Disclaimer)

* **Dizipal Fusion Addon**, yalnızca eğitim, ağ otomasyonu ve kişisel kullanım amacıyla geliştirilmiş **açık kaynaklı bir web kazıma (web scraping) aracıdır.**
* Bu yazılım, kendi sunucularında veya kod tabanında **hiçbir telif hakkıyla korunan materyal barındırmaz, yüklemez, kopyalamaz veya dağıtmaz.**
* Eklenti, yalnızca internet üzerindeki herkese açık web sitelerinde bulunan verilere erişimi otomatize eden bir köprü (proxy) görevi görür. Sunulan içeriklerin yasal statüsü, telif durumu veya kaynağın güvenilirliği ile ilgili eklenti geliştiricisinin hiçbir yetkisi ve sorumluluğu yoktur.
* Bu aracın kullanımından, erişilen içeriklerden ve yayınların kişisel cihazlarda oynatılmasından doğabilecek her türlü yasal sorumluluk **tamamen son kullanıcıya aittir.** Eklentiyi kuran ve kullanan her kişi bu şartları kabul etmiş sayılır.
