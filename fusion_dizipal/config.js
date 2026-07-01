const fs = require('fs');
const pino = require('pino');

let opts = {};
try {
  opts = require("/data/options.json");
} catch(e) {
  // Local fallback
}

const CONFIG = {
  VERSION: "2.4.4",
  BASE_URL: opts.base_url || "https://dizipal.bid",
  MIRROR_URL: opts.mirror_url || "https://dizipal.bid",
  PORT: Number(process.env.PORT || opts.port || 7860),
  TIMEOUT_MS: Number(opts.timeout_ms || 45000),
  CACHE_TTL_MS: Number(opts.cache_ttl_hours || 12) * 60 * 60 * 1000,
  // Eklenti Xvfb sanal ekranında HEADFUL çalışır (headless tespitini geçersiz
  // kılmak için). ZORLA headful — eski kurulumlardan taşınan headless:true kayıtlı
  // seçeneği mimariyi bozmasın diye seçenek yok sayılır.
  HEADLESS: false,
  OMDB_KEY: opts.omdb_api_key || "trilogy",
  TMDB_KEY: opts.tmdb_api_key || "",
  CHROMIUM_PATH: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  LOGO_URL: "https://raw.githubusercontent.com/dzirambola/dizipal-addon/main/fusion_dizipal/image_0.png"
};

const logger = pino();

const recentLogs = [];

function log(msg, type = "info") {
  const level = type.toLowerCase() === 'error' ? 'error' : 
                type.toLowerCase() === 'system' ? 'info' : 
                type.toLowerCase() === 'debug' ? 'debug' : 'info';
  logger[level](`[${type}] ${msg}`);
  
  // Dashboard için son 50 logu hafızada tut
  recentLogs.unshift({
      time: new Date().toLocaleTimeString('tr-TR'),
      type: type.toUpperCase(),
      msg: msg
  });
  if (recentLogs.length > 50) recentLogs.pop();
}

function getRecentLogs() {
    return recentLogs;
}

module.exports = { CONFIG, log, logger, getRecentLogs };
