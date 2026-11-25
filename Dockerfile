# ATK Deck V2 — Portable Self-Hosted Trading Platform (Railway & Docker Ready)
FROM node:22-bookworm-slim

# Native build tools for better-sqlite3 (node-gyp) and HTTPS certificates for prebuild downloads
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Reproducible dependency installation using npm + package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy application source and build the React frontend
COPY . .
RUN npm run build

# Ensure default persistent data mount point exists (attach a Railway Volume or Docker volume at /app/data)
RUN mkdir -p /app/data/uploads

# Production defaults (PORT is intentionally omitted so Railway's dynamic PORT is used automatically)
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV ALLOW_PUBLIC_REGISTRATION=false
ENV SESSION_TTL_DAYS=14
ENV COOKIE_SECURE=true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start"]
