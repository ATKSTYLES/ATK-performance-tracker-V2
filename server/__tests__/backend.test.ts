import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../routes.ts';
import {
  exportBackupZip,
  parseAndValidateImportFile,
  type WorkspaceExportBundle,
} from '../../src/portability/utds';
import type { Trade, TradingAccount, TradingSession } from '../../src/domain/types';

// Minimal valid 1x1 PNG buffer (with authentic PNG magic bytes)
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

async function apiJson(
  baseUrl: string,
  urlPath: string,
  options: {
    method?: string;
    cookie?: string;
    csrfToken?: string;
    body?: unknown;
    skipCsrfHeader?: boolean;
    extraHeaders?: Record<string, string>;
  } = {}
) {
  const headers: Record<string, string> = { ...(options.extraHeaders ?? {}) };
  if (!options.skipCsrfHeader) headers['X-ATK-Client'] = '1';
  if (options.cookie) headers['Cookie'] = options.cookie;
  if (options.csrfToken) headers['X-CSRF-Token'] = options.csrfToken;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json, setCookie: res.headers.get('set-cookie') ?? '' };
}

describe('ATK Deck V2 — Independent Backend, Auth, CSRF, Cookies, Storage, Sessions & UTDS Integration', () => {
  let tmpDir: string;
  let server: http.Server;
  let db: Database.Database;
  let baseUrl: string;
  let ownerCookie = '';
  let ownerCsrf = '';

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-backend-e2e-'));
    const created = createApp({
      dataDir: tmpDir,
      dbPath: path.join(tmpDir, 'atk-deck.db'),
      uploadsDir: path.join(tmpDir, 'uploads'),
      cookieSecure: 'false',
      allowPublicRegistration: false,
    });
    db = created.db;
    server = http.createServer(created.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    db?.close();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Reports health, requires first-run owner setup, enforces single-user lock, CSRF tokens, and authenticates by email or username', async () => {
    const health = await apiJson(baseUrl, '/api/health');
    expect(health.res.status).toBe(200);
    expect((health.json as { status: string; engine: string }).status).toBe('ok');
    expect((health.json as { engine: string }).engine).toBe('sqlite');
    expect(health.res.headers.get('cache-control')).toContain('no-store');

    // Unauthenticated workspace access is rejected
    const unauth = await apiJson(baseUrl, '/api/workspace/bootstrap');
    expect(unauth.res.status).toBe(401);

    // Initial auth status indicates setup required
    const status0 = await apiJson(baseUrl, '/api/auth/status');
    expect((status0.json as { initialized: boolean; registrationOpen: boolean }).initialized).toBe(false);
    expect((status0.json as { registrationOpen: boolean }).registrationOpen).toBe(true);
    expect((status0.json as { user: unknown }).user).toBeNull();
    expect((status0.json as { csrfToken: unknown }).csrfToken).toBeNull();

    // Missing X-ATK-Client header on POST is blocked
    const noClientHeader = await apiJson(baseUrl, '/api/auth/setup', {
      method: 'POST',
      skipCsrfHeader: true,
      body: { username: 'atk', email: 'atk@northpeak.in', displayName: 'ATK', password: 'StrongPassword!1' },
    });
    expect(noClientHeader.res.status).toBe(403);

    // First-run owner creation succeeds and issues HttpOnly cookie + session-bound csrfToken
    const reg = await apiJson(baseUrl, '/api/auth/setup', {
      method: 'POST',
      body: { username: 'atk_owner', email: 'atk@northpeak.in', displayName: 'ATK Trader', password: 'StrongPassword!1' },
    });
    expect(reg.res.status).toBe(201);
    expect(reg.setCookie).toContain('atk_deck_session=');
    expect(reg.setCookie).toContain('HttpOnly');
    ownerCookie = reg.setCookie.split(';')[0];
    ownerCsrf = (reg.json as { csrfToken: string }).csrfToken;
    expect(ownerCsrf).toMatch(/^[a-f0-9]{64}$/);

    // Simulated full page reload: GET /api/auth/status & GET /api/auth/csrf return authenticated user and same csrfToken
    const statusAfter = await apiJson(baseUrl, '/api/auth/status', { cookie: ownerCookie });
    expect(statusAfter.res.status).toBe(200);
    expect((statusAfter.json as { user: { username: string }; csrfToken: string }).user.username).toBe('atk_owner');
    expect((statusAfter.json as { csrfToken: string }).csrfToken).toBe(ownerCsrf);

    const csrfRes = await apiJson(baseUrl, '/api/auth/csrf', { cookie: ownerCookie });
    expect(csrfRes.res.status).toBe(200);
    expect((csrfRes.json as { csrfToken: string }).csrfToken).toBe(ownerCsrf);

    // Authenticated mutating write WITHOUT X-CSRF-Token is blocked with 403
    const missingCsrf = await apiJson(baseUrl, '/api/daily-journals/2026-11-18', {
      method: 'PUT',
      cookie: ownerCookie,
      body: { date: '2026-11-18', timezone: 'Asia/Kolkata' },
    });
    expect(missingCsrf.res.status).toBe(403);
    expect((missingCsrf.json as { code: string }).code).toBe('permission/csrf-token-invalid');

    // Authenticated mutating write with INVALID X-CSRF-Token is blocked with 403
    const wrongCsrf = await apiJson(baseUrl, '/api/daily-journals/2026-11-18', {
      method: 'PUT',
      cookie: ownerCookie,
      csrfToken: '0'.repeat(64),
      body: { date: '2026-11-18', timezone: 'Asia/Kolkata' },
    });
    expect(wrongCsrf.res.status).toBe(403);

    // Second registration blocked by single-user lock
    const reg2 = await apiJson(baseUrl, '/api/auth/setup', {
      method: 'POST',
      body: { username: 'intruder', email: 'intruder@example.com', displayName: 'Intruder', password: 'StrongPassword!2' },
    });
    expect(reg2.res.status).toBe(403);

    // Wrong password rejected
    const badLogin = await apiJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { identifier: 'atk_owner', password: 'WrongPassword!99' },
    });
    expect(badLogin.res.status).toBe(401);

    // Login by username and by email both succeed and issue distinct session-bound CSRF tokens
    const loginUser = await apiJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { identifier: 'atk_owner', password: 'StrongPassword!1' },
    });
    expect(loginUser.res.status).toBe(200);
    const secondCookie = loginUser.setCookie.split(';')[0];
    const secondCsrf = (loginUser.json as { csrfToken: string }).csrfToken;
    expect(secondCsrf).not.toBe(ownerCsrf);

    const loginEmail = await apiJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { identifier: 'ATK@NORTHPEAK.IN', password: 'StrongPassword!1' },
    });
    expect(loginEmail.res.status).toBe(200);

    // Change password revokes other sessions while keeping current session valid
    const pwdChange = await apiJson(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: { currentPassword: 'StrongPassword!1', newPassword: 'UpdatedPassword!2026' },
    });
    expect(pwdChange.res.status).toBe(200);

    // Old secondCookie should now be invalidated
    const revokedCheck = await apiJson(baseUrl, '/api/workspace/bootstrap', { cookie: secondCookie });
    expect(revokedCheck.res.status).toBe(401);

    // Current ownerCookie still works
    const activeCheck = await apiJson(baseUrl, '/api/workspace/bootstrap', { cookie: ownerCookie });
    expect(activeCheck.res.status).toBe(200);
  });

  it('Auto-seeds default workspace and verifies Daily Journal, Accounts, Sessions, Trades, Linked Executions & Cascade Delete', async () => {
    const boot = await apiJson(baseUrl, '/api/workspace/bootstrap', { cookie: ownerCookie });
    expect(boot.res.status).toBe(200);
    const collections = (boot.json as { collections: Record<string, unknown[]> }).collections;
    expect(collections.preferences.length).toBeGreaterThanOrEqual(1);
    expect(collections.accounts.length).toBeGreaterThanOrEqual(1);
    expect(collections.session_templates.length).toBeGreaterThanOrEqual(3);
    expect(collections.instruments.length).toBeGreaterThanOrEqual(5);

    // Create additional trading account and retrieve it
    const createAcc = await apiJson(baseUrl, '/api/records/accounts/acc_funded_test', {
      method: 'POST',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: {
        data: {
          name: 'Funded Eval 100K',
          broker: 'FTMO',
          accountType: 'funded',
          capital: 100000,
          currency: 'USD',
          defaultRiskPercent: 1,
          isActive: true,
        },
      },
    });
    expect(createAcc.res.status).toBe(201);

    // Daily Journal upsert & reload
    const dj = await apiJson(baseUrl, '/api/daily-journals/2026-11-19', {
      method: 'PUT',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: {
        date: '2026-11-19',
        timezone: 'Asia/Kolkata',
        plannedActivities: 'London + NY',
        morningNotes: 'Well rested',
        dailyEmotionalState: 'Calm',
        disciplineRating: 9,
        dailyReflection: 'Clean discipline',
        checklistItems: [{ id: 'c1', label: 'Review HTF', completed: true }],
      },
    });
    expect(dj.res.status).toBe(200);

    const djList = await apiJson(baseUrl, '/api/records/daily_journals', { cookie: ownerCookie });
    expect(
      (djList.json as { items: Array<{ id: string; morningNotes: string }> }).items.find(
        (j) => j.id === '2026-11-19'
      )?.morningNotes
    ).toBe('Well rested');

    // Start session atomically
    const start = await apiJson(baseUrl, '/api/sessions/start', {
      method: 'POST',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: {
        sessionId: 'ses_e2e_london',
        sessionInput: {
          date: '2026-11-19',
          timezone: 'Asia/Kolkata',
          templateId: 'london',
          sessionName: 'London',
          scheduledStart: '12:30',
          scheduledEnd: '15:30',
          status: 'live',
          attendance: 'attended',
          sittingLocation: 'trading_desk',
          preSessionEmotion: 'Calm',
          sessionBias: 'bullish',
          checklistItems: [{ id: 's1', label: 'Levels Marked', completed: true }],
          actualStartTime: '2026-11-19T07:00:00.000Z',
          setupAvailability: 'pending',
          planAdherence: 'pending',
        },
      },
    });
    expect(start.res.status).toBe(201);

    // Open a trade inside this session
    const openTrade = await apiJson(baseUrl, '/api/trades/open-batch', {
      method: 'POST',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: {
        tradeInputs: [
          {
            tradeId: 'tr_in_ses_e2e',
            data: {
              date: '2026-11-19',
              timezone: 'Asia/Kolkata',
              tradeNumberOfDay: 1,
              accountId: 'acc_primary',
              accountName: 'Primary Personal Account',
              sessionId: 'ses_e2e_london',
              sessionName: 'London',
              isOutOfSession: false,
              instrument: 'XAUUSD',
              direction: 'long',
              status: 'during_trade',
              riskPercent: 1,
              expectedProfitPercent: 2.5,
              preTradeEmotion: 'Calm',
              confidence: 8,
              openedAt: '2026-11-19T07:30:00.000Z',
              exitOutcome: 'pending',
              exitReason: 'pending',
              tpStatus: 'pending',
              slStatus: 'pending',
              followedPlan: 'na',
              followedRiskRules: 'na',
              impulsiveEntry: 'na',
              exitedPerPlan: 'na',
              mistakes: [],
            },
          },
        ],
      },
    });
    expect(openTrade.res.status).toBe(201);

    // End session atomically
    const end = await apiJson(baseUrl, '/api/sessions/ses_e2e_london/end', {
      method: 'POST',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: {
        date: '2026-11-19',
        closing: {
          actualEndTime: '2026-11-19T10:00:00.000Z',
          setupAvailability: 'available',
          planAdherence: 'yes',
          postSessionEmotion: 'Calm & Satisfied',
          closingReflection: 'Respected rules.',
        },
      },
    });
    expect(end.res.status).toBe(200);

    // Post-completion reflection edit is allowed
    const editReflection = await apiJson(baseUrl, '/api/records/sessions/ses_e2e_london', {
      method: 'PATCH',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: { patch: { closingReflection: 'Updated closing reflection.', planAdherence: 'partial' } },
    });
    expect(editReflection.res.status).toBe(200);

    // Reopening completed session is rejected
    const reopen = await apiJson(baseUrl, '/api/records/sessions/ses_e2e_london', {
      method: 'PATCH',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: { patch: { status: 'live' } },
    });
    expect(reopen.res.status).toBe(400);

    // Cascade delete session deletes session & session_events while preserving linked trade
    const delSes = await apiJson(baseUrl, '/api/sessions/ses_e2e_london/cascade', {
      method: 'DELETE',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
    });
    expect(delSes.res.status).toBe(200);

    const sessionsAfter = await apiJson(baseUrl, '/api/records/sessions', { cookie: ownerCookie });
    expect(
      (sessionsAfter.json as { items: Array<{ id: string }> }).items.some((s) => s.id === 'ses_e2e_london')
    ).toBe(false);

    const sessionEventsAfter = await apiJson(baseUrl, '/api/records/session_events', { cookie: ownerCookie });
    expect(
      (sessionEventsAfter.json as { items: Array<{ sessionId: string }> }).items.some(
        (e) => e.sessionId === 'ses_e2e_london'
      )
    ).toBe(false);

    const tradesAfter = await apiJson(baseUrl, '/api/records/trades', { cookie: ownerCookie });
    const preserved = (
      tradesAfter.json as { items: Array<{ id: string; instrument: string }> }
    ).items.find((t) => t.id === 'tr_in_ses_e2e');
    expect(preserved).toBeTruthy();
    expect(preserved?.instrument).toBe('XAUUSD');
  });

  it('Stores validated image screenshots locally, rejects non-image payloads, serves authenticated downloads, and deletes files from disk', async () => {
    // Reject spoofed non-image file
    const badForm = new FormData();
    badForm.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
    badForm.append('relatedType', 'trade');
    badForm.append('relatedId', 'tr_in_ses_e2e');
    badForm.append('category', 'entry');
    const badRes = await fetch(`${baseUrl}/api/attachments/upload`, {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'X-ATK-Client': '1', 'X-CSRF-Token': ownerCsrf },
      body: badForm,
    });
    expect(badRes.status).toBe(400);

    // Upload genuine PNG
    const goodForm = new FormData();
    goodForm.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'setup_chart.png');
    goodForm.append('relatedType', 'trade');
    goodForm.append('relatedId', 'tr_in_ses_e2e');
    goodForm.append('category', 'entry');
    const uploadRes = await fetch(`${baseUrl}/api/attachments/upload`, {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'X-ATK-Client': '1', 'X-CSRF-Token': ownerCsrf },
      body: goodForm,
    });
    expect(uploadRes.status).toBe(201);
    const meta = (
      (await uploadRes.json()) as {
        attachment: { id: string; storagePath: string; checksum: string };
      }
    ).attachment;
    expect(meta.id).toBeTruthy();
    expect(meta.checksum).toMatch(/^[a-f0-9]{64}$/);

    // Verify file exists on disk inside tmpDir/uploads
    const diskPath = path.join(tmpDir, 'uploads', meta.storagePath);
    expect(fs.existsSync(diskPath)).toBe(true);

    const downloadPath = `/api/attachments/by-path?path=${encodeURIComponent(meta.storagePath)}`;

    // Unauthenticated download blocked
    const unauthDl = await fetch(`${baseUrl}${downloadPath}`);
    expect(unauthDl.status).toBe(401);

    // Authenticated download returns exact PNG bytes
    const authDl = await fetch(`${baseUrl}${downloadPath}`, {
      headers: { Cookie: ownerCookie },
    });
    expect(authDl.status).toBe(200);
    const downloadedBytes = Buffer.from(await authDl.arrayBuffer());
    expect(downloadedBytes.equals(TINY_PNG)).toBe(true);

    // Delete attachment removes both DB record and disk file
    const delAtt = await apiJson(baseUrl, `/api/attachments/${encodeURIComponent(meta.id)}`, {
      method: 'DELETE',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
    });
    expect(delAtt.res.status).toBe(200);
    expect(fs.existsSync(diskPath)).toBe(false);
  });

  it('Round-trips ATK-UTDS v1.0 ZIP export/import (skip/replace/copy), exports valid SQLite Server Snapshot ZIP, and preserves permanent backup untouched', async () => {
    const permanentBackupPath = path.resolve(process.cwd(), 'public/backups/ATK_Deck_V2_Backup_2026-11-18.zip');
    expect(fs.existsSync(permanentBackupPath)).toBe(true);
    expect(fs.statSync(permanentBackupPath).size).toBeGreaterThan(1000);

    const boot = await apiJson(baseUrl, '/api/workspace/bootstrap', { cookie: ownerCookie });
    const cols = (boot.json as { collections: Record<string, unknown[]> }).collections;
    const bundle: WorkspaceExportBundle = {
      profile: (cols.preferences[0] ?? null) as WorkspaceExportBundle['profile'],
      settings: null,
      accounts: cols.accounts as TradingAccount[],
      daily_journals: cols.daily_journals as WorkspaceExportBundle['daily_journals'],
      sessions: cols.sessions as TradingSession[],
      session_events: cols.session_events as WorkspaceExportBundle['session_events'],
      trades: cols.trades as Trade[],
      trade_events: cols.trade_events as WorkspaceExportBundle['trade_events'],
      trade_groups: cols.trade_groups as WorkspaceExportBundle['trade_groups'],
      reviews: cols.reviews as WorkspaceExportBundle['reviews'],
      templates: cols.session_templates as WorkspaceExportBundle['templates'],
      instruments: cols.instruments as WorkspaceExportBundle['instruments'],
      checklists: cols.checklists as WorkspaceExportBundle['checklists'],
      attachments_index: [],
    };

    const { blob: zipBlob } = await exportBackupZip(bundle);
    const zipFile = new File([await zipBlob.arrayBuffer()], 'ATK_UTDS_Roundtrip.zip', {
      type: 'application/zip',
    });

    const existingIds = {
      accounts: new Set((cols.accounts as Array<{ id: string }>).map((r) => r.id)),
      daily_journals: new Set((cols.daily_journals as Array<{ id: string }>).map((r) => r.id)),
      sessions: new Set((cols.sessions as Array<{ id: string }>).map((r) => r.id)),
      session_events: new Set((cols.session_events as Array<{ id: string }>).map((r) => r.id)),
      trades: new Set((cols.trades as Array<{ id: string }>).map((r) => r.id)),
      trade_events: new Set((cols.trade_events as Array<{ id: string }>).map((r) => r.id)),
      trade_groups: new Set((cols.trade_groups as Array<{ id: string }>).map((r) => r.id)),
      reviews: new Set((cols.reviews as Array<{ id: string }>).map((r) => r.id)),
      templates: new Set((cols.session_templates as Array<{ id: string }>).map((r) => r.id)),
      instruments: new Set((cols.instruments as Array<{ id: string }>).map((r) => r.id)),
      checklists: new Set((cols.checklists as Array<{ id: string }>).map((r) => r.id)),
      attachments: new Set<string>(),
    };

    const parsed = await parseAndValidateImportFile(zipFile, existingIds);
    expect(parsed.checksumValid).toBe(true);
    expect(parsed.totalRecords).toBeGreaterThan(0);

    // 1. Skip strategy
    const skipRes = await apiJson(baseUrl, '/api/backup/import-utds', {
      method: 'POST',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: { strategy: 'skip', bundle: parsed.bundle },
    });
    expect(skipRes.res.status).toBe(200);
    expect((skipRes.json as { report: { errors: string[]; skipped: number } }).report.errors).toHaveLength(0);
    expect((skipRes.json as { report: { skipped: number } }).report.skipped).toBeGreaterThan(0);

    // 2. Replace strategy
    const replaceRes = await apiJson(baseUrl, '/api/backup/import-utds', {
      method: 'POST',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: { strategy: 'replace', bundle: parsed.bundle },
    });
    expect(replaceRes.res.status).toBe(200);
    expect((replaceRes.json as { report: { errors: string[]; replaced: number } }).report.errors).toHaveLength(0);
    expect((replaceRes.json as { report: { replaced: number } }).report.replaced).toBeGreaterThan(0);

    // 3. Copy strategy
    const copyRes = await apiJson(baseUrl, '/api/backup/import-utds', {
      method: 'POST',
      cookie: ownerCookie,
      csrfToken: ownerCsrf,
      body: { strategy: 'copy', bundle: parsed.bundle },
    });
    expect(copyRes.res.status).toBe(200);
    expect((copyRes.json as { report: { errors: string[]; copied: number } }).report.errors).toHaveLength(0);
    expect((copyRes.json as { report: { copied: number } }).report.copied).toBeGreaterThan(0);

    // 4. Native SQLite + Uploads Server Snapshot ZIP
    const snapRes = await fetch(`${baseUrl}/api/backup/server-snapshot`, {
      headers: { Cookie: ownerCookie },
    });
    expect(snapRes.status).toBe(200);
    const snapBuf = Buffer.from(await snapRes.arrayBuffer());
    const snapZip = await JSZip.loadAsync(snapBuf);
    const dbEntry = snapZip.file('atk-deck.db');
    expect(dbEntry).toBeTruthy();

    const extractedDbPath = path.join(tmpDir, 'snapshot-verify.db');
    fs.writeFileSync(extractedDbPath, await dbEntry!.async('nodebuffer'));
    const verifyDb = new Database(extractedDbPath, { readonly: true });
    const tradeCountRow = verifyDb.prepare('SELECT COUNT(*) AS count FROM trades').get() as { count: number };
    expect(tradeCountRow.count).toBeGreaterThanOrEqual(2);
    verifyDb.close();
  });

  it('Emits correct HttpOnly cookie attributes for local HTTP dev, standalone HTTPS production, and cross-site iframe hosting, and invalidates sessions on logout', async () => {
    const devTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-dev-cookie-'));
    const prodTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-prod-cookie-'));
    const devCreated = createApp({
      nodeEnv: 'development',
      dataDir: devTmp,
      dbPath: path.join(devTmp, 'atk-deck.db'),
      uploadsDir: path.join(devTmp, 'uploads'),
      cookieSecure: 'true',
      sessionTtlDays: 14,
      allowPublicRegistration: false,
    });
    const prodCreated = createApp({
      nodeEnv: 'production',
      dataDir: prodTmp,
      dbPath: path.join(prodTmp, 'atk-deck.db'),
      uploadsDir: path.join(prodTmp, 'uploads'),
    });

    const devSrv = http.createServer(devCreated.app);
    const prodSrv = http.createServer(prodCreated.app);
    await new Promise<void>((resolve) => devSrv.listen(0, '127.0.0.1', () => resolve()));
    await new Promise<void>((resolve) => prodSrv.listen(0, '127.0.0.1', () => resolve()));

    try {
      expect(prodCreated.config.allowPublicRegistration).toBe(false);
      expect(prodCreated.config.sessionTtlDays).toBe(14);
      expect(prodCreated.config.cookieSecure).toBe('true');

      const devUrl = `http://127.0.0.1:${(devSrv.address() as AddressInfo).port}`;
      const prodUrl = `http://127.0.0.1:${(prodSrv.address() as AddressInfo).port}`;

      // 1. Local plain-HTTP dev with COOKIE_SECURE=true automatically uses non-secure Lax cookie
      const devReg = await apiJson(devUrl, '/api/auth/setup', {
        method: 'POST',
        body: { username: 'dev_owner', email: 'dev@local.test', displayName: 'Dev', password: 'StrongPassword!1' },
      });
      expect(devReg.res.status).toBe(201);
      expect(devReg.setCookie).toContain('Max-Age=1209600');
      expect(devReg.setCookie).toContain('SameSite=Lax');
      expect(devReg.setCookie).not.toContain('Secure');
      expect(devReg.setCookie).not.toContain('Partitioned');

      // 2. AI Studio / cross-site proxied iframe (even if internal nginx drops X-Forwarded-Proto!)
      // MUST emit SameSite=None; Secure; Partitioned so Chrome stores & sends the cookie in the iframe!
      const iframeLogin = await apiJson(devUrl, '/api/auth/login', {
        method: 'POST',
        extraHeaders: {
          'X-Forwarded-Host': 'ais-dev-example.asia-east1.run.app',
          Origin: 'https://ais-dev-example.asia-east1.run.app',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: { identifier: 'dev_owner', password: 'StrongPassword!1' },
      });
      expect(iframeLogin.res.status).toBe(200);
      expect(iframeLogin.setCookie).toContain('HttpOnly');
      expect(iframeLogin.setCookie).toContain('SameSite=None');
      expect(iframeLogin.setCookie).toContain('Secure');
      expect(iframeLogin.setCookie).toContain('Partitioned');
      const iframeCookie = iframeLogin.setCookie.split(';')[0];

      // Session works across reload and logout clears cookie with matching Partitioned attribute
      const iframeStatus = await apiJson(devUrl, '/api/auth/status', { cookie: iframeCookie });
      expect((iframeStatus.json as { user: { username: string } }).user.username).toBe('dev_owner');

      const iframeLogout = await apiJson(devUrl, '/api/auth/logout', {
        method: 'POST',
        cookie: iframeCookie,
        extraHeaders: {
          'X-Forwarded-Host': 'ais-dev-example.asia-east1.run.app',
          Origin: 'https://ais-dev-example.asia-east1.run.app',
          'Sec-Fetch-Site': 'cross-site',
        },
      });
      expect(iframeLogout.res.status).toBe(200);
      expect(iframeLogout.setCookie).toContain('Max-Age=0');
      expect(iframeLogout.setCookie).toContain('SameSite=None');
      expect(iframeLogout.setCookie).toContain('Secure');
      expect(iframeLogout.setCookie).toContain('Partitioned');

      // After logout, session is rejected with 401
      const afterLogout = await apiJson(devUrl, '/api/workspace/bootstrap', { cookie: iframeCookie });
      expect(afterLogout.res.status).toBe(401);

      // 3. Standalone HTTPS production (e.g. northpeak.in) strictly sets SameSite=Lax; Secure
      const prodReg = await apiJson(prodUrl, '/api/auth/setup', {
        method: 'POST',
        extraHeaders: {
          'X-Forwarded-Host': 'northpeak.in',
          'X-Forwarded-Proto': 'https',
          Origin: 'https://northpeak.in',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: { username: 'prod_owner', email: 'prod@northpeak.in', displayName: 'Prod', password: 'StrongPassword!1' },
      });
      expect(prodReg.res.status).toBe(201);
      expect(prodReg.setCookie).toContain('Max-Age=1209600');
      expect(prodReg.setCookie).toContain('SameSite=Lax');
      expect(prodReg.setCookie).toContain('Secure');
      expect(prodReg.setCookie).not.toContain('Partitioned');
      expect(prodReg.res.headers.get('strict-transport-security')).toContain('max-age=31536000');
      expect(prodReg.res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(prodReg.res.headers.get('x-content-type-options')).toBe('nosniff');

      // 4. Production reverse-proxy HTTP redirect skips /api/health while redirecting external HTTP to HTTPS
      const prodHealth = await apiJson(prodUrl, '/api/health', {
        extraHeaders: {
          'X-Forwarded-Host': 'northpeak.in',
          'X-Forwarded-Proto': 'http',
        },
      });
      expect(prodHealth.res.status).toBe(200);
      expect((prodHealth.json as { database: string; storage: string }).database).toBe('connected');
      expect((prodHealth.json as { storage: string }).storage).toBe('writable');

      const httpRedirectRes = await fetch(`${prodUrl}/api/auth/status`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'northpeak.in',
          'X-Forwarded-Proto': 'http',
        },
      });
      expect(httpRedirectRes.status).toBe(301);
      expect(httpRedirectRes.headers.get('location')).toBe('https://northpeak.in/api/auth/status');
    } finally {
      await new Promise<void>((resolve) => devSrv.close(() => resolve()));
      await new Promise<void>((resolve) => prodSrv.close(() => resolve()));
      devCreated.db.close();
      prodCreated.db.close();
      fs.rmSync(devTmp, { recursive: true, force: true });
      fs.rmSync(prodTmp, { recursive: true, force: true });
    }
  });

  it('Persists SQLite records, active sessions, and local screenshot attachments across full server restarts on a shared DATA_DIR volume', async () => {
    const volumeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-railway-volume-'));
    const prevPort = process.env.PORT;
    const prevMount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    const prevDataDir = process.env.DATA_DIR;

    let sessionCookie = '';
    let savedAttachmentId = '';
    let savedStoragePath = '';
    const savedJournalDate = '2026-11-20';

    try {
      // Simulate Railway dynamic PORT and mounted volume fallback
      process.env.PORT = '48765';
      delete process.env.DATA_DIR;
      process.env.RAILWAY_VOLUME_MOUNT_PATH = volumeDir;

      // --- Boot #1 (before restart/redeploy) ---
      const boot1 = createApp({
        nodeEnv: 'production',
        cookieSecure: 'true',
        allowPublicRegistration: false,
      });
      expect(boot1.config.port).toBe(48765);
      expect(boot1.config.host).toBe('0.0.0.0');
      expect(boot1.config.dataDir).toBe(path.resolve(volumeDir));
      expect(boot1.config.dbPath).toBe(path.join(path.resolve(volumeDir), 'atk-deck.db'));
      expect(boot1.config.uploadsDir).toBe(path.join(path.resolve(volumeDir), 'uploads'));

      const srv1 = http.createServer(boot1.app);
      await new Promise<void>((resolve) => srv1.listen(0, '127.0.0.1', () => resolve()));
      const url1 = `http://127.0.0.1:${(srv1.address() as AddressInfo).port}`;

      const httpsHeaders = {
        'X-Forwarded-Host': 'northpeak.in',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://northpeak.in',
        'Sec-Fetch-Site': 'same-origin',
      };

      const setup = await apiJson(url1, '/api/auth/setup', {
        method: 'POST',
        extraHeaders: httpsHeaders,
        body: {
          username: 'railway_owner',
          email: 'owner@northpeak.in',
          displayName: 'Railway Owner',
          password: 'StrongPassword!1',
        },
      });
      expect(setup.res.status).toBe(201);
      sessionCookie = setup.setCookie.split(';')[0];
      const csrf = (setup.json as { csrfToken: string }).csrfToken;

      // Write a Daily Journal record
      const journalSave = await apiJson(url1, `/api/daily-journals/${savedJournalDate}`, {
        method: 'PUT',
        cookie: sessionCookie,
        csrfToken: csrf,
        extraHeaders: httpsHeaders,
        body: {
          data: {
            date: savedJournalDate,
            timezone: 'Asia/Kolkata',
            plannedActivities: 'London + NY session review',
            morningNotes: 'Testing Railway volume persistence',
            dailyEmotionalState: 'Calm',
            disciplineRating: 9,
            dailyReflection: 'Survived restart cleanly.',
            checklistItems: [],
          },
        },
      });
      expect(journalSave.res.status).toBe(200);

      // Upload a local screenshot attachment into /app/data/uploads
      const form = new FormData();
      form.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'chart-persist.png');
      form.append('relatedType', 'trade');
      form.append('relatedId', 'tr_persist_check');
      form.append('category', 'entry');

      const uploadRes = await fetch(`${url1}/api/attachments/upload`, {
        method: 'POST',
        headers: {
          ...httpsHeaders,
          'X-ATK-Client': '1',
          'X-CSRF-Token': csrf,
          Cookie: sessionCookie,
        },
        body: form,
      });
      expect(uploadRes.status).toBe(201);
      const uploaded = (await uploadRes.json()) as {
        attachment: { id: string; storagePath: string };
      };
      savedAttachmentId = uploaded.attachment.id;
      savedStoragePath = uploaded.attachment.storagePath;

      // Simulate graceful Railway SIGTERM shutdown (flush WAL + close DB + close HTTP server)
      await new Promise<void>((resolve) => srv1.close(() => resolve()));
      boot1.db.pragma('wal_checkpoint(TRUNCATE)');
      boot1.db.close();

      // --- Boot #2 (fresh container/process mounted to the exact same volumeDir on a new dynamic PORT) ---
      process.env.PORT = '48766';
      const boot2 = createApp({
        nodeEnv: 'production',
        dataDir: volumeDir,
        cookieSecure: 'true',
        allowPublicRegistration: false,
      });
      expect(boot2.config.port).toBe(48766);

      const srv2 = http.createServer(boot2.app);
      await new Promise<void>((resolve) => srv2.listen(0, '127.0.0.1', () => resolve()));
      const url2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}`;

      try {
        // Health check succeeds on fresh boot
        const health2 = await apiJson(url2, '/api/health');
        expect(health2.res.status).toBe(200);
        expect((health2.json as { status: string; database: string; storage: string }).status).toBe('ok');
        expect((health2.json as { database: string }).database).toBe('connected');
        expect((health2.json as { storage: string }).storage).toBe('writable');

        // Owner account registration stays locked after restart
        const status2 = await apiJson(url2, '/api/auth/status', {
          cookie: sessionCookie,
          extraHeaders: httpsHeaders,
        });
        expect(status2.res.status).toBe(200);
        const statusPayload = status2.json as {
          initialized: boolean;
          registrationOpen: boolean;
          user: { username: string } | null;
        };
        expect(statusPayload.initialized).toBe(true);
        expect(statusPayload.registrationOpen).toBe(false);
        expect(statusPayload.user?.username).toBe('railway_owner');

        // Saved Daily Journal & attachment metadata persist in SQLite
        const bootData = await apiJson(url2, '/api/workspace/bootstrap', {
          cookie: sessionCookie,
          extraHeaders: httpsHeaders,
        });
        expect(bootData.res.status).toBe(200);
        const collections = (bootData.json as { collections: Record<string, Array<Record<string, unknown>>> }).collections;
        const persistedJournal = collections.daily_journals.find((j) => j.date === savedJournalDate);
        expect(persistedJournal?.morningNotes).toBe('Testing Railway volume persistence');
        expect(collections.attachments.some((a) => a.id === savedAttachmentId)).toBe(true);

        // Uploaded screenshot binary persists on disk and streams back identically
        const dlRes = await fetch(
          `${url2}/api/attachments/by-path?path=${encodeURIComponent(savedStoragePath)}`,
          {
            headers: { ...httpsHeaders, Cookie: sessionCookie },
          }
        );
        expect(dlRes.status).toBe(200);
        const dlBytes = Buffer.from(await dlRes.arrayBuffer());
        expect(dlBytes.equals(TINY_PNG)).toBe(true);
      } finally {
        await new Promise<void>((resolve) => srv2.close(() => resolve()));
        boot2.db.close();
      }
    } finally {
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
      if (prevMount === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
      else process.env.RAILWAY_VOLUME_MOUNT_PATH = prevMount;
      if (prevDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevDataDir;
      fs.rmSync(volumeDir, { recursive: true, force: true });
    }
  });
});
