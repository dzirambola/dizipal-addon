const { LRUCache } = require('lru-cache');
const { CONFIG, log } = require('./config');

const cache = new LRUCache({
  max: 5000, // Maximum items in cache
  ttl: CONFIG.CACHE_TTL_MS, // Default TTL from config (for m3u8)
  updateAgeOnGet: false,
  updateAgeOnHas: false,
});

const cacheSet = (key, val, ttlOverride = null) => {
    if (ttlOverride) {
        cache.set(key, val, { ttl: ttlOverride });
    } else {
        cache.set(key, val);
    }
};

const cacheGet = (key) => {
  return cache.get(key) || null;
};

module.exports = { cacheSet, cacheGet };
