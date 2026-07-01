FROM debian:bookworm-slim

LABEL maintainer="fusion-addon"
LABEL description="Fusion Media Center – Dizipal Scraper Addon (v2.4.6)"

# ── 1. Bağımlılıklar & Node.js 20 LTS (NodeSource) ───────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    dumb-init \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends \
    nodejs \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    fonts-liberation \
    fonts-noto \
    xvfb \
    xauth \
    libgtk-3-0 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# ── 1b. curl-impersonate (Chrome TLS/JA3 taklidi) ────────────────────────────
# Yayın CDN'i (uk-traffic vb.) Node/normal curl'ün TLS parmak izini engelliyor.
# curl-impersonate Chrome'un TLS el sıkışmasını birebir taklit ederek 403'ü aşar.
RUN set -e; \
    ARCH="$(uname -m)"; \
    case "$ARCH" in \
      x86_64)  CI="x86_64-linux-gnu" ;; \
      aarch64) CI="aarch64-linux-gnu" ;; \
      armv7l)  CI="arm-linux-gnueabihf" ;; \
      *)       CI="" ;; \
    esac; \
    if [ -n "$CI" ]; then \
      curl -fsSL -o /tmp/ci.tar.gz "https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/curl-impersonate-v0.6.1.${CI}.tar.gz" \
      && mkdir -p /opt/curl-impersonate \
      && tar -xzf /tmp/ci.tar.gz -C /opt/curl-impersonate \
      && chmod +x /opt/curl-impersonate/* \
      && rm -f /tmp/ci.tar.gz \
      && (cp /opt/curl-impersonate/*.so* /usr/lib/ 2>/dev/null || true) \
      && ldconfig || echo "curl-impersonate kurulamadı (arch=$ARCH), Node fetch'e düşülecek"; \
    else echo "curl-impersonate bu arch için yok ($ARCH), Node fetch kullanılacak"; fi
# Wrapper (curl_chrome116) tüm JA3/cipher/H2 flag'lerini uygular; PATH'e ekle ki
# içinden `curl-impersonate-chrome`'u bulabilsin.
ENV PATH="/opt/curl-impersonate:${PATH}"
ENV CURL_IMPERSONATE=/opt/curl-impersonate/curl_chrome116
ENV LD_LIBRARY_PATH=/opt/curl-impersonate

# ── 2. Güvenlik: Non-root kullanıcı (pptruser) ──────────────────────────────
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser \
    && chown -R pptruser:pptruser /home/pptruser

# ── 3. Uygulama Yapılandırması ────────────────────────────────────────────────
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY *.js ./
COPY manifest.json ./
RUN chown -R pptruser:pptruser /app

USER pptruser

# ── 4. Sağlık Kontrolü & Başlatma ─────────────────────────────────────────────
# dumb-init kullanımı PID 1 sorunlarını (zombi süreçleri) önler.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:7860/manifest.json || exit 1

EXPOSE 7860
# Headful Chromium'u sanal ekranda (Xvfb) çalıştır. Headless tespitini (disable-devtool
# vb.) kökten geçersiz kılar; tarayıcı gerçek bir GUI oturumu gibi görünür.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x1024x24 -ac -nolisten tcp", "node", "server.js"]
