# ATK Deck V2 — Independent Self-Hosting & Portability Guide

ATK Deck V2 is a completely self-contained personal trading journal, session logger, and analytics platform. It has **zero dependencies** on Firebase, Google OAuth, Google Fonts CDN, or external cloud APIs.

---

## 1. Architecture Summary

- **Unified Server**: Single Node.js + Express process (`server.ts`) listening on port `3000` (configurable via `PORT`).
- **Database**: Local SQLite database in WAL mode (`$DATA_DIR/atk-deck.db`) with normalized relational tables and foreign key constraints.
- **Attachments**: Locally managed screenshots stored under `$DATA_DIR/uploads/`.
- **Authentication**: Independent Username / Email + Password authentication using Node.js `crypto.scrypt` password hashing and `HttpOnly` cookie sessions stored in SQLite.
- **Fonts**: Bundled locally (`@fontsource/dm-sans`, `@fontsource/plus-jakarta-sans`, `@fontsource/jetbrains-mono`) — works 100% offline.
- **Portability**: Full ATK-UTDS v1.0 ZIP / JSON / CSV / Excel export & import, plus one-click native SQLite + Uploads server snapshot ZIP export.

---

## 2. Running Locally (Windows, macOS, Linux)

**Requirements**: Node.js `>= 22.12` (or Node.js `>= 20` using `npm run dev`).

```bash
# 1. Install dependencies
npm install

# 2. Optional: configure environment
cp .env.example .env

# 3. Build frontend & start production server
npm run build
NODE_ENV=production npm run start
```

Open **http://localhost:3000** in your browser.
On first launch, ATK Deck automatically shows the **Create Owner Account** screen. Once your owner account is created, public registration automatically locks (`ALLOW_PUBLIC_REGISTRATION=false`).

For local development with live reload:
```bash
npm run dev
```

---

## 3. Deploying on a Custom Domain (e.g., `northpeak.in`)

### Option A: VPS (Ubuntu / Debian / DigitalOcean / Hetzner / AWS Lightsail)

1. Install Node.js 22 LTS and Caddy (or Nginx) on your server.
2. Upload/clone the project to `/opt/atk-deck`.
3. Install and build:
   ```bash
   cd /opt/atk-deck
   npm install
   npm run build
   ```
4. Create `/opt/atk-deck/.env`:
   ```env
   NODE_ENV=production
   PORT=3000
   DATA_DIR=/var/lib/atk-deck
   ALLOW_PUBLIC_REGISTRATION=false
   COOKIE_SECURE=true
   SESSION_TTL_DAYS=14
   ```
5. Run with `systemd` or `pm2`:
   ```bash
   pm2 start "npm run start" --name atk-deck --cwd /opt/atk-deck
   pm2 save
   ```
6. Put Caddy in front for automatic HTTPS:
   ```caddyfile
   northpeak.in {
     reverse_proxy 127.0.0.1:3000
   }
   ```
   (If using Nginx, forward `Host`, `X-Forwarded-Proto $scheme`, and disable buffering on `/api/workspace/stream` for SSE: `proxy_buffering off;`.)

### Option B: Docker

```bash
docker build -t atk-deck:v2 .
docker run -d \
  --name atk-deck \
  --restart unless-stopped \
  -p 3000:3000 \
  -v atk_deck_data:/app/data \
  -e ALLOW_PUBLIC_REGISTRATION=false \
  atk-deck:v2
```

> **Important**: Always mount `/app/data` (or set `DATA_DIR` to a persistent disk). Do not deploy to stateless static-only hosting (such as GitHub Pages, Netlify static, or Vercel static without a persistent Node.js server and disk volume).

---

## 4. Backup, Restore & Migration

### Method 1: ATK-UTDS v1.0 ZIP Backup (Cross-Version & Cross-Platform)
- **Export**: Open **Settings & Export → Export, Import & Backup → Export Full Backup (ZIP)**.
- **Restore**: On any fresh ATK Deck installation, open **Settings & Export → Import Backup**, select your `.zip` or `.json` file (including legacy backups like `ATK_Deck_V2_Backup_2026-11-18.zip`), choose `Replace` or `Skip`, and confirm.

### Method 2: Raw SQLite + Uploads Server Snapshot
- **Export**: Open **Settings & Export → Export SQLite DB Snapshot**. Downloads a single `.zip` containing a consistent online SQLite backup (`atk-deck.db`) and your entire `uploads/` folder.
- **Restore on a new server**: Stop the server, copy `atk-deck.db` and `uploads/` into `$DATA_DIR`, and start the server again.

---

## 5. Emergency Password Reset (CLI)

If you ever forget your owner password, reset it directly from the server terminal:

```bash
npm run reset-password -- <your-username-or-email> "<NewStrongPassword>"
```

This updates your salted `scrypt` password hash and immediately revokes all active sessions.

---

## 6. Future PostgreSQL Migration Path

All database access is isolated in `server/db.ts` behind normalized tables that mirror the exact domain schema. To scale from single-user SQLite to PostgreSQL in the future, configure `DATABASE_URL` in `.env`, implement a `pg`-backed adapter implementing the same collection functions (`listCollectionRows`, `getRecordById`, `upsertRecordRow`, `deleteRecordRow`), and migrate your data cleanly via an ATK-UTDS v1.0 ZIP export/import.
