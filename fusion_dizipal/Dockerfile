FROM debian:bookworm-slim

LABEL maintainer="fusion-addon"
LABEL description="Fusion Media Center – Dizipal Scraper Addon (v2.3.3)"

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
    && rm -rf /var/lib/apt/lists/*

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
CMD ["node", "server.js"]
