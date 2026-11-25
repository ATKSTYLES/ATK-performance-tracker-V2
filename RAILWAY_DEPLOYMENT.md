# ATK Deck V2 — Private GitHub & Railway Production Deployment Guide

This guide walks you step-by-step — with zero prior DevOps experience required — through downloading ATK Deck V2, uploading it safely to a **Private GitHub repository**, and deploying it to **Railway** with persistent SQLite storage, local screenshots, and your custom domain (`northpeak.in`).

---

## Architecture on Railway

- **Runtime**: Single Node.js 22 (`node:22-bookworm-slim`) Docker container built from `/Dockerfile` with reproducible `npm ci` (`package-lock.json`) and native C++ build tools (`python3`, `make`, `g++`) for `better-sqlite3`.
- **Database**: Local SQLite in WAL mode at `/app/data/atk-deck.db` (persisted on a Railway Volume).
- **Attachments**: Local screenshot uploads at `/app/data/uploads/` (persisted on the same Railway Volume).
- **Security**: Independent email/username + `scrypt` password login, `HttpOnly; SameSite=Lax; Secure` cookies over HTTPS, cryptographic session-bound CSRF tokens (`X-CSRF-Token`), reverse-proxy HTTPS enforcement, HSTS, and live SSE multi-tab sync.
- **Health Check**: `GET /api/health` verifies live SQLite connectivity (`SELECT 1`) and writable persistent storage (`200 OK` / `503 Service Unavailable`).
- **Port Binding**: Automatically listens on `0.0.0.0:$PORT` using Railway’s dynamically assigned `PORT`.
- **Replicas**: Locked to **1 replica** (`numReplicas: 1` in `railway.json`), as required for SQLite on a mounted persistent Volume.

---

## Part 1: Download ATK Deck V2 as a ZIP & Upload to a Private GitHub Repo

### Step 1: Download the Project ZIP from AI Studio
1. In the top-right toolbar of Google AI Studio, click the **Download** icon (down-arrow / **Download app** button) to save the project as a `.zip` file on your computer.
2. Unzip the downloaded `.zip` file into a folder on your computer (for example, `atk-deck-v2`).

### Step 2: Double-Check No Private Local Files Are Inside Before Uploading
`.gitignore` and `.dockerignore` automatically block private files when using Git or Docker, **but if you upload via GitHub’s web drag-and-drop**, manually confirm these folders/files are **NOT** inside the folder you drag into GitHub:
- Delete `.env` or `.env.local` if present *(keep `.env.example` — it has no secrets)*.
- Delete `data/` or any `*.db`, `*.db-wal`, `*.db-shm` files if present.
- Delete `uploads/` if present.
- Delete `node_modules/` and `dist/` if present.
- Delete `public/assets/aistudio/` and `public/backups/` if present *(keep your permanent backup ZIP saved safely on your own computer/drive instead of in GitHub)*.

Make sure these key files **ARE** present in the root of your folder:
- `Dockerfile`
- `.dockerignore`
- `.gitignore`
- `railway.json`
- `package.json`
- `package-lock.json`
- `.nvmrc` & `.node-version`
- `server.ts`, `server/`, `src/`, `scripts/`, `index.html`

### Step 3: Create a New PRIVATE GitHub Repository
1. Go to **https://github.com** and sign in (or create a free account).
2. Click the **`+`** icon in the top-right corner → **New repository**.
3. Enter a **Repository name** (for example: `atk-deck-v2`).
4. Under visibility, select **Private** *(important — keeps your source code private)*.
5. Leave **Add a README**, **.gitignore**, and **license** unchecked (your project already includes them).
6. Click **Create repository**.

### Step 4: Upload Your Project to the Private Repository
Choose whichever method is easiest for you:

#### Method A (Easiest for Beginners — GitHub Desktop, respects `.gitignore` automatically)
1. Download and open **GitHub Desktop** (https://desktop.github.com) and sign in.
2. Click **File → Add Local Repository** and choose your unzipped `atk-deck-v2` folder (if asked, click **create a repository**).
3. GitHub Desktop automatically obeys `.gitignore` and excludes `.env`, `data/`, `uploads/`, `*.db`, `node_modules/`, and `dist/`.
4. Type a commit summary (e.g. `Initial ATK Deck V2 Railway-ready release`), click **Commit to main**, then click **Publish repository** (make sure **Keep this code private** is checked!).

#### Method B (GitHub Website — No Software Required)
1. On your newly created empty private repository page, click the link **uploading an existing file**.
2. Open your unzipped `atk-deck-v2` folder on your computer (after confirming Step 2’s excluded files are deleted).
3. Select **all files and folders inside** `atk-deck-v2` (do **not** drag the outer wrapper folder itself — `Dockerfile`, `package.json`, and `railway.json` must sit directly in the root of the repository).
4. Drag them into the GitHub upload area and wait for all files to finish uploading.
5. Enter `Initial ATK Deck V2 commit` in the commit box and click **Commit changes**.

---

## Part 2: Deploy ATK Deck V2 on Railway

### Step 1: Create the Railway Service
1. Log in to **https://railway.com** (you can sign in with your GitHub account).
2. Click **New Project → Deploy from GitHub Repo**.
3. Authorize Railway to access your private `atk-deck-v2` repository and select it.
4. Railway automatically detects `railway.json` and `Dockerfile`:
   - **Builder**: `DOCKERFILE` (`Dockerfile`)
   - **Start Command**: `npm run start`
   - **Healthcheck Path**: `/api/health`
   - **Replicas**: `1`

### Step 2: Attach the Persistent Railway Volume (CRITICAL)
Without a mounted Volume, your SQLite database and screenshots would be wiped whenever Railway redeploys.

1. Open your ATK Deck service in Railway.
2. Go to **Settings → Volumes** (or right-click the service canvas → **Add Volume**).
3. Click **Add Volume** and set the **Mount Path** to:
   ```text
   /app/data
   ```
4. Save and apply the change.

### Step 3: Set Production Environment Variables
Open the service’s **Variables** tab and add these exact 5 variables:

| Variable | Value | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production build serving, HTTPS enforcement, HSTS, and `Secure` cookies |
| `DATA_DIR` | `/app/data` | Stores `atk-deck.db` and `uploads/` on your persistent Railway Volume |
| `ALLOW_PUBLIC_REGISTRATION` | `false` | Locks registration automatically after you create your owner account |
| `SESSION_TTL_DAYS` | `14` | Keeps your browser signed in for 14 days |
| `COOKIE_SECURE` | `true` | Forces `HttpOnly; Secure; SameSite=Lax` cookies over HTTPS |

> **Do NOT add a `PORT` variable manually.** Railway assigns `PORT` dynamically, and ATK Deck automatically listens on `0.0.0.0:$PORT`.

### Step 4: Verify the Deployment & Health Check
1. Wait for the Docker build and deploy to turn **Active (Green)**.
2. Open **Deploy Logs** and confirm:
   ```text
   ATK Deck server listening on http://0.0.0.0:<PORT> (production, DATA_DIR: /app/data, SQLite: /app/data/atk-deck.db)
   ```
3. Under **Settings → Networking**, click **Generate Domain** (e.g., `https://atk-deck-production.up.railway.app`).
4. Visit `https://<your-railway-domain>/api/health` and confirm HTTP `200`:
   ```json
   {
     "status": "ok",
     "engine": "sqlite",
     "database": "connected",
     "storage": "writable",
     "uptimeSeconds": 12,
     "timestamp": "..."
   }
   ```

### Step 5: Connect Your Custom Domain (`northpeak.in`)
1. Go to **Settings → Networking → Custom Domain → + Custom Domain**.
2. Enter `northpeak.in` (and optionally `www.northpeak.in`).
3. Add the DNS record Railway shows at your domain registrar (`CNAME` / `ALIAS` / Cloudflare flattened `CNAME`).
4. Once verified, Railway automatically issues a free HTTPS SSL certificate. Plain `http://northpeak.in` automatically redirects (`301`) to `https://northpeak.in`.

### Step 6: Create Your Owner Account & Verify Persistence
1. Visit `https://northpeak.in` and complete the one-time **Create Owner Account** screen.
2. *(Optional)* Import your existing trading history via **Settings & Export → Export, Import & Backup → Import Backup** (ATK-UTDS `.zip` or `.json`).
3. Add a quick test note in Daily Journal, click **Deployments → ⋮ → Restart** in Railway, wait for green health, and refresh `https://northpeak.in` — you should remain signed in and see your saved note intact.

---

## Ongoing Backups & Recovery

- **Full Server Snapshot**: **Settings & Export → Export SQLite DB Snapshot** downloads a `.zip` with a consistent online backup of `atk-deck.db` plus all uploaded screenshots.
- **Portable Data Export**: **Settings & Export → Export Full Backup (ZIP)** exports an ATK-UTDS v1.0 archive.
- **Emergency Password Reset**: From Railway CLI (`railway run`) or Service Shell:
  ```bash
  npm run reset-password -- <your-username-or-email> "<NewStrongPassword>"
  ```
