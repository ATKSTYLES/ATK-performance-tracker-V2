import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import JSZip from 'jszip';
import multer from 'multer';
import { resolveNetPnl } from '../src/domain/calculations.ts';
import {
  DEFAULT_CURRENCY,
  DEFAULT_ENTRY_TYPES,
  DEFAULT_SETUP_LABELS,
  DEFAULT_TIMEFRAMES,
  DEFAULT_TIMEZONE,
  QUICK_SESSION_EVENT_TYPES,
  SCHEMA_VERSION,
} from '../src/domain/enums.ts';
import type { AttachmentMeta, Trade, TradingSession } from '../src/domain/types.ts';
import {
  generateRecordId,
  isValidId,
  sanitizeFirestorePayload,
  stripUndefinedFields,
  validateCompleteTradeDocument,
  validateTradeClosure,
  validateTradeCreation,
} from '../src/domain/validation.ts';
import {
  type AuthenticatedRequest,
  clearFailedLogins,
  clearSessionCookie,
  createAuthMiddleware,
  createSession,
  hashPassword,
  isRateLimited,
  mapDbUserRow,
  recordFailedLogin,
  resolveSessionUser,
  setSessionCookie,
  toPublicAuthUser,
  verifyPassword,
} from './auth.ts';
import { loadServerConfig, type ServerConfig } from './config.ts';
import {
  type CollectionName,
  deleteRecordRow,
  getRecordById,
  isCollectionName,
  listCollectionRows,
  openSqliteDatabase,
  SUPPORTED_COLLECTIONS,
  upsertRecordRow,
} from './db.ts';
import { attachWorkspaceStream, notifyWorkspaceChange } from './sse.ts';
import {
  computeBufferSha256,
  deleteAttachmentFile,
  MAX_ATTACHMENT_BYTES,
  readAttachmentFile,
  sanitizeFileName,
  validateImageUpload,
  writeAttachmentFile,
} from './storage.ts';
import {
  ApiValidationError,
  APPEND_ONLY_COLLECTIONS,
  assertValidRecordId,
  seedInitialWorkspaceIfEmpty,
  validateCollectionRecord,
} from './validation.ts';

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

function buildClosureEventId(operationId: string, index?: number): string {
  const base = operationId.startsWith('close_') ? `te_${operationId}` : `te_close_${operationId}`;
  return index === undefined ? base : `${base}_${index}`;
}

function getClientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '');
  return fwd.split(',')[0].trim() || req.ip || 'unknown';
}

function sendApiError(res: Response, err: unknown): void {
  if (err instanceof ApiValidationError) {
    res.status(err.status).json({ code: err.code, error: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  res.status(500).json({ code: 'database/internal-error', error: msg });
}

export interface CreatedApp {
  app: Express;
  db: Database.Database;
  config: ServerConfig;
}

export function createApp(configOverrides?: Partial<ServerConfig>): CreatedApp {
  const config = loadServerConfig(configOverrides);
  const db = openSqliteDatabase(config.dbPath);
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50mb' }));

  // Baseline security headers and production reverse-proxy HTTPS handling (Railway / Caddy / Nginx)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (config.isProduction) {
      const forwardedProtoHeader = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
      const firstForwardedProto = forwardedProtoHeader.split(',')[0]?.trim();
      const rawHost = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
        .split(',')[0]
        .trim();
      const hostname = rawHost.toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      const isLocalHost =
        hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

      // Redirect external plain-HTTP traffic to HTTPS behind reverse proxies, while keeping internal /api/health checks direct
      if (
        firstForwardedProto === 'http' &&
        req.path !== '/api/health' &&
        !isLocalHost &&
        rawHost
      ) {
        res.redirect(301, `https://${rawHost}${req.originalUrl}`);
        return;
      }

      const isHttps =
        Boolean(req.secure) ||
        forwardedProtoHeader.split(',').some((p) => p.trim() === 'https');
      if (isHttps && !isLocalHost) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }

      // Prevent clickjacking on standalone production domains while keeping *.run.app preview compatible
      if (!/\.run\.app$/i.test(hostname)) {
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      }
    }

    next();
  });

  // Prevent reverse proxies or browsers from caching authenticated API responses or stripping Set-Cookie
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vary', 'Cookie, Origin');
    next();
  });

  // Custom client header guard for mutating API endpoints (blocks cross-origin simple form POSTs)
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    const clientHeader = req.headers['x-atk-client'];
    if (clientHeader !== '1') {
      res.status(403).json({
        code: 'permission/csrf-header-missing',
        error: 'Missing required X-ATK-Client request header.',
      });
      return;
    }
    next();
  });

  const requireAuth = createAuthMiddleware(db);

  // --- Production Health & Readiness Endpoint ---
  app.get('/api/health', (_req, res) => {
    let dbOk = false;
    let storageOk = false;

    try {
      const row = db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
      dbOk = row?.ok === 1;
    } catch {
      dbOk = false;
    }

    try {
      fs.accessSync(config.uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
      storageOk = true;
    } catch {
      storageOk = false;
    }

    const healthy = dbOk && storageOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      engine: 'sqlite',
      database: dbOk ? 'connected' : 'unavailable',
      storage: storageOk ? 'writable' : 'unavailable',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // --- Authentication Endpoints ---
  app.get('/api/auth/status', (req, res) => {
    try {
      const userCount = (
        db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }
      ).cnt;
      const resolved = resolveSessionUser(db, req);
      res.json({
        initialized: userCount > 0,
        registrationOpen: userCount === 0 || config.allowPublicRegistration,
        user: resolved?.user ?? null,
        csrfToken: resolved?.csrfToken ?? null,
      });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.get('/api/auth/csrf', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ csrfToken: req.authCsrfToken ?? null });
  });

  app.post('/api/auth/setup', async (req, res) => {
    try {
      const userCount = (
        db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }
      ).cnt;
      if (userCount > 0 && !config.allowPublicRegistration) {
        res.status(403).json({
          code: 'auth/registration-disabled',
          error:
            'Owner account is already configured and public registration is disabled on this server.',
        });
        return;
      }

      const username = String(req.body?.username ?? '').trim();
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const displayName = String(req.body?.displayName ?? '').trim() || username || 'Trader';
      const password = String(req.body?.password ?? '');

      if (!username || !/^[a-zA-Z0-9._-]{2,40}$/.test(username)) {
        throw new ApiValidationError(
          'Username must be 2–40 characters using letters, numbers, dots, hyphens, or underscores.',
          400,
          'auth/invalid-username'
        );
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
        throw new ApiValidationError('Please enter a valid email address.', 400, 'auth/invalid-email');
      }
      if (password.length < 8 || password.length > 128) {
        throw new ApiValidationError(
          'Password must be between 8 and 128 characters.',
          400,
          'auth/weak-password'
        );
      }

      const existing = db
        .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
        .get(username, email);
      if (existing) {
        throw new ApiValidationError(
          'An account with this username or email already exists.',
          409,
          'auth/account-exists'
        );
      }

      const userId = `usr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      const passwordHash = await hashPassword(password);
      const now = new Date().toISOString();
      const role = userCount === 0 ? 'owner' : 'user';

      db.prepare(`
        INSERT INTO users (id, username, email, display_name, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, username, email, displayName.slice(0, 100), passwordHash, role, now, now);

      seedInitialWorkspaceIfEmpty(db, userId, displayName);

      const session = createSession(
        db,
        userId,
        String(req.headers['user-agent'] ?? ''),
        config.sessionTtlDays
      );
      setSessionCookie(req, res, session.token, config);

      res.status(201).json({
        user: {
          uid: userId,
          username,
          email,
          displayName: displayName.slice(0, 100),
          role,
          emailVerified: true,
        },
        csrfToken: session.csrfToken,
      });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const identifier = String(req.body?.identifier ?? '').trim();
      const password = String(req.body?.password ?? '');
      const rateKey = `${getClientIp(req)}:${identifier.toLowerCase()}`;

      if (isRateLimited(rateKey)) {
        res.status(429).json({
          code: 'auth/too-many-requests',
          error: 'Too many failed login attempts. Please wait 15 minutes and try again.',
        });
        return;
      }

      if (!identifier || !password) {
        throw new ApiValidationError(
          'Email/username and password are required.',
          400,
          'auth/invalid-credentials'
        );
      }

      const row = db
        .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
        .get(identifier, identifier.toLowerCase()) as Record<string, unknown> | undefined;

      if (!row) {
        recordFailedLogin(rateKey);
        res.status(401).json({
          code: 'auth/invalid-credentials',
          error: 'Invalid email/username or password.',
        });
        return;
      }

      const dbUser = mapDbUserRow(row);
      const valid = await verifyPassword(password, dbUser.passwordHash);
      if (!valid) {
        recordFailedLogin(rateKey);
        res.status(401).json({
          code: 'auth/invalid-credentials',
          error: 'Invalid email/username or password.',
        });
        return;
      }

      clearFailedLogins(rateKey);
      seedInitialWorkspaceIfEmpty(db, dbUser.id, dbUser.displayName);

      const session = createSession(
        db,
        dbUser.id,
        String(req.headers['user-agent'] ?? ''),
        config.sessionTtlDays
      );
      setSessionCookie(req, res, session.token, config);

      res.json({ user: toPublicAuthUser(dbUser), csrfToken: session.csrfToken });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    try {
      const resolved = resolveSessionUser(db, req);
      if (resolved) {
        db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(resolved.sessionId);
      }
      clearSessionCookie(req, res, config);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const currentPassword = String(req.body?.currentPassword ?? '');
      const newPassword = String(req.body?.newPassword ?? '');
      const revokeOtherSessions = req.body?.revokeOtherSessions !== false;

      if (newPassword.length < 8 || newPassword.length > 128) {
        throw new ApiValidationError(
          'New password must be between 8 and 128 characters.',
          400,
          'auth/weak-password'
        );
      }

      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        res.status(404).json({ code: 'auth/user-not-found', error: 'Account not found.' });
        return;
      }

      const dbUser = mapDbUserRow(row);
      const ok = await verifyPassword(currentPassword, dbUser.passwordHash);
      if (!ok) {
        res.status(401).json({
          code: 'auth/invalid-credentials',
          error: 'Current password is incorrect.',
        });
        return;
      }

      const nextHash = await hashPassword(newPassword);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        nextHash,
        new Date().toISOString(),
        uid
      );

      if (revokeOtherSessions && req.authSessionId) {
        db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND id != ?').run(
          uid,
          req.authSessionId
        );
      }

      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/auth/logout-all', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      if (req.authSessionId) {
        db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND id != ?').run(
          uid,
          req.authSessionId
        );
      }
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // --- Workspace Bootstrap & Live Sync Stream ---
  app.get('/api/workspace/bootstrap', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      seedInitialWorkspaceIfEmpty(db, uid, req.authUser!.displayName);

      const data: Record<string, unknown[]> = {};
      for (const col of SUPPORTED_COLLECTIONS) {
        data[col] = listCollectionRows(db, uid, col);
      }
      res.json({ user: req.authUser, collections: data });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.get('/api/workspace/stream', requireAuth, (req: AuthenticatedRequest, res) => {
    attachWorkspaceStream(req.authUser!.uid, res);
  });

  // --- Generic Collection CRUD ---
  app.get('/api/records/:collection', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const col = String(req.params.collection);
      if (!isCollectionName(col)) {
        throw new ApiValidationError(`Unsupported collection "${col}".`);
      }
      const items = listCollectionRows(db, req.authUser!.uid, col);
      res.json({ items });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/records/:collection/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const col = String(req.params.collection);
      const id = String(req.params.id);
      if (!isCollectionName(col)) {
        throw new ApiValidationError(`Unsupported collection "${col}".`);
      }
      assertValidRecordId(id, `${col} ID`);

      const clean = stripUndefinedFields((req.body?.data ?? req.body ?? {}) as Record<string, unknown>);
      const now = new Date().toISOString();
      const record: Record<string, unknown> = {
        ...clean,
        id,
        userId: uid,
        schemaVersion: SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      };

      // Foreign key checks mirroring firestore.rules
      if (col === 'session_events') {
        const parent = getRecordById(db, uid, 'sessions', String(record.sessionId ?? ''));
        if (!parent) {
          throw new ApiValidationError('Referenced session does not exist.');
        }
      }
      if (col === 'trade_events') {
        const parent = getRecordById(db, uid, 'trades', String(record.tradeId ?? ''));
        if (!parent) {
          throw new ApiValidationError('Referenced trade does not exist.');
        }
      }
      if (col === 'trades' && record.isOutOfSession !== true) {
        const parent = getRecordById(db, uid, 'sessions', String(record.sessionId ?? ''));
        if (!parent) {
          throw new ApiValidationError('In-session trade must reference an existing session.');
        }
      }

      validateCollectionRecord(col, record, uid, id);
      upsertRecordRow(db, uid, col, record);
      notifyWorkspaceChange(uid, [col]);
      res.status(201).json({ record: getRecordById(db, uid, col, id) });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.patch('/api/records/:collection/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const col = String(req.params.collection);
      const id = String(req.params.id);
      if (!isCollectionName(col)) {
        throw new ApiValidationError(`Unsupported collection "${col}".`);
      }
      if (APPEND_ONLY_COLLECTIONS.has(col)) {
        throw new ApiValidationError(
          `Collection "${col}" is append-only and cannot be updated.`,
          403,
          'permission/denied'
        );
      }
      assertValidRecordId(id, `${col} ID`);

      const existing = getRecordById(db, uid, col, id);
      if (!existing) {
        throw new ApiValidationError(`Record ${col}/${id} not found.`, 404, 'database/not-found');
      }

      const patch = stripUndefinedFields((req.body?.patch ?? req.body ?? {}) as Record<string, unknown>);
      delete patch.id;
      delete patch.userId;
      delete patch.createdAt;
      delete patch.schemaVersion;

      // Enforce completed-session immutability (only post-completion reflection fields may be edited)
      if (col === 'sessions' && existing.status === 'completed') {
        const ALLOWED_COMPLETED_SESSION_PATCH_KEYS = new Set([
          'closingReflection',
          'planAdherence',
          'setupAvailability',
          'postSessionEmotion',
          'attendance',
        ]);
        const disallowedKeys = Object.keys(patch).filter(
          (k) => !ALLOWED_COMPLETED_SESSION_PATCH_KEYS.has(k)
        );
        if (disallowedKeys.length > 0) {
          throw new ApiValidationError(
            `Completed sessions cannot modify locked field(s): ${disallowedKeys.join(', ')}.`,
            400,
            'validation/session-locked'
          );
        }
      }

      // Keep user displayName in sync when preferences.displayName updates
      const merged: Record<string, unknown> = {
        ...existing,
        ...patch,
        id: existing.id,
        userId: uid,
        schemaVersion: existing.schemaVersion,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };

      validateCollectionRecord(col, merged, uid, id);
      upsertRecordRow(db, uid, col, merged);

      if (col === 'preferences' && typeof patch.displayName === 'string' && patch.displayName.trim()) {
        db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(
          patch.displayName.trim().slice(0, 100),
          new Date().toISOString(),
          uid
        );
      }

      notifyWorkspaceChange(uid, [col]);
      res.json({ record: getRecordById(db, uid, col, id) });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.delete('/api/records/:collection/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const col = String(req.params.collection);
      const id = String(req.params.id);
      if (!isCollectionName(col)) {
        throw new ApiValidationError(`Unsupported collection "${col}".`);
      }
      assertValidRecordId(id, `${col} ID`);

      deleteRecordRow(db, uid, col, id);
      notifyWorkspaceChange(uid, [col]);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // --- Daily Journal Upsert ---
  app.put('/api/daily-journals/:date', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const date = String(req.params.date);
      assertValidRecordId(date, 'daily journal date');

      const data = stripUndefinedFields((req.body?.data ?? req.body ?? {}) as Record<string, unknown>);
      const existing = getRecordById(db, uid, 'daily_journals', date);
      const now = new Date().toISOString();

      const record: Record<string, unknown> = existing
        ? {
            ...existing,
            timezone: data.timezone ?? existing.timezone,
            plannedActivities: data.plannedActivities ?? existing.plannedActivities,
            morningNotes: data.morningNotes ?? existing.morningNotes,
            dailyEmotionalState: data.dailyEmotionalState ?? existing.dailyEmotionalState,
            disciplineRating: data.disciplineRating ?? existing.disciplineRating,
            dailyReflection: data.dailyReflection ?? existing.dailyReflection,
            checklistItems: data.checklistItems ?? existing.checklistItems,
            updatedAt: now,
          }
        : {
            ...data,
            id: date,
            date,
            userId: uid,
            schemaVersion: SCHEMA_VERSION,
            createdAt: now,
            updatedAt: now,
          };

      validateCollectionRecord('daily_journals', record, uid, date);
      upsertRecordRow(db, uid, 'daily_journals', record);
      notifyWorkspaceChange(uid, ['daily_journals']);
      res.json({ record: getRecordById(db, uid, 'daily_journals', date) });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // --- Atomic Session Lifecycle ---
  app.post('/api/sessions/start', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const sessionId = String(req.body?.sessionId ?? '');
      const sessionInput = stripUndefinedFields(
        (req.body?.sessionInput ?? {}) as Record<string, unknown>
      );
      assertValidRecordId(sessionId, 'session ID');

      const existing = getRecordById(db, uid, 'sessions', sessionId);
      if (existing) {
        res.json({ record: existing, idempotent: true });
        return;
      }

      const now = new Date().toISOString();
      const sessionRecord: Record<string, unknown> = {
        ...sessionInput,
        id: sessionId,
        userId: uid,
        schemaVersion: SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      };
      validateCollectionRecord('sessions', sessionRecord, uid, sessionId);

      const eventId = `se_${sessionId}_start`;
      const eventRecord: Record<string, unknown> = {
        id: eventId,
        userId: uid,
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        date: sessionRecord.date,
        eventType: 'session_started',
        description: `Started ${String(sessionRecord.sessionName)} session (${String(sessionRecord.sessionBias)} bias).`,
        timestamp: String(sessionRecord.actualStartTime || now),
        createdAt: now,
        updatedAt: now,
      };
      validateCollectionRecord('session_events', eventRecord, uid, eventId);

      const tx = db.transaction(() => {
        upsertRecordRow(db, uid, 'sessions', sessionRecord);
        upsertRecordRow(db, uid, 'session_events', eventRecord);
      });
      tx();

      notifyWorkspaceChange(uid, ['sessions', 'session_events']);
      res.status(201).json({ record: getRecordById(db, uid, 'sessions', sessionId) });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/sessions/:id/end', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const sessionId = String(req.params.id);
      assertValidRecordId(sessionId, 'session ID');

      const existing = getRecordById(db, uid, 'sessions', sessionId) as TradingSession | null;
      if (!existing) {
        throw new ApiValidationError('Session record does not exist.', 404, 'database/not-found');
      }
      if (existing.status === 'completed') {
        res.json({ record: existing, idempotent: true });
        return;
      }

      const date = String(req.body?.date ?? existing.date);
      const closing = (req.body?.closing ?? {}) as {
        actualEndTime: string;
        setupAvailability?: TradingSession['setupAvailability'];
        planAdherence?: TradingSession['planAdherence'];
        postSessionEmotion?: string;
        closingReflection?: string;
      };
      const now = new Date().toISOString();

      const updatedSession: Record<string, unknown> = {
        ...existing,
        status: 'completed',
        attendance: 'attended',
        actualEndTime: closing.actualEndTime || now,
        setupAvailability: closing.setupAvailability ?? 'pending',
        planAdherence: closing.planAdherence ?? 'pending',
        postSessionEmotion: closing.postSessionEmotion ?? '',
        closingReflection: closing.closingReflection ?? '',
        updatedAt: now,
      };
      validateCollectionRecord('sessions', updatedSession, uid, sessionId);

      const eventId = `se_${sessionId}_end`;
      const eventRecord: Record<string, unknown> = {
        id: eventId,
        userId: uid,
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        date,
        eventType: 'session_ended',
        description: `Session completed. Plan adherence: ${closing.planAdherence ?? 'pending'}.`,
        timestamp: closing.actualEndTime || now,
        createdAt: now,
        updatedAt: now,
      };
      validateCollectionRecord('session_events', eventRecord, uid, eventId);

      const tx = db.transaction(() => {
        upsertRecordRow(db, uid, 'sessions', updatedSession);
        upsertRecordRow(db, uid, 'session_events', eventRecord);
      });
      tx();

      notifyWorkspaceChange(uid, ['sessions', 'session_events']);
      res.json({ record: getRecordById(db, uid, 'sessions', sessionId) });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.delete('/api/sessions/:id/cascade', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const sessionId = String(req.params.id);
      assertValidRecordId(sessionId, 'session ID');

      const allAttachments = listCollectionRows(db, uid, 'attachments') as AttachmentMeta[];
      const sessionAttachments = allAttachments.filter(
        (att) => att.relatedType === 'session' && att.relatedId === sessionId
      );
      const deletingIds = new Set(sessionAttachments.map((a) => a.id));

      const tx = db.transaction(() => {
        db.prepare('DELETE FROM session_events WHERE user_id = ? AND session_id = ?').run(
          uid,
          sessionId
        );
        for (const att of sessionAttachments) {
          deleteRecordRow(db, uid, 'attachments', att.id);
        }
        deleteRecordRow(db, uid, 'sessions', sessionId);
      });
      tx();

      // Best-effort cleanup of unreferenced disk binaries
      for (const att of sessionAttachments) {
        const stillReferenced = allAttachments.some(
          (other) => !deletingIds.has(other.id) && other.storagePath === att.storagePath
        );
        if (!stillReferenced && att.storagePath) {
          deleteAttachmentFile(config.uploadsDir, att.storagePath);
        }
      }

      notifyWorkspaceChange(uid, ['sessions', 'session_events', 'attachments']);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // --- Atomic Trade Operations ---
  app.post('/api/trades/open-batch', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const tradeInputs = (req.body?.tradeInputs ?? []) as Array<{
        tradeId: string;
        data: Record<string, unknown>;
      }>;
      const tradeGroup = req.body?.tradeGroup as Record<string, unknown> | undefined;

      if (!Array.isArray(tradeInputs) || tradeInputs.length === 0) {
        res.json({ ok: true, createdIds: [] });
        return;
      }

      const uniqueIds = new Set(tradeInputs.map((t) => t.tradeId));
      if (uniqueIds.size !== tradeInputs.length) {
        throw new ApiValidationError('Duplicate trade IDs found in trade creation batch.');
      }

      const now = new Date().toISOString();
      const staged: Array<{
        tradeId: string;
        tradeRecord: Record<string, unknown>;
        openEvent: Record<string, unknown>;
      }> = [];

      for (const item of tradeInputs) {
        assertValidRecordId(item.tradeId, 'trade ID');
        const cleanData = sanitizeFirestorePayload(item.data, {
          rejectNonFinite: true,
          stripNulls: true,
          stripEmptyStringKeys: [
            'sessionId',
            'sessionName',
            'tradeGroupId',
            'setupLabel',
            'entryType',
            'timeframe',
            'entryReasoning',
            'expectedOutcome',
          ],
        }) as Record<string, unknown>;

        const creationCheck = validateTradeCreation({
          accountId: String(cleanData.accountId ?? ''),
          instrument: String(cleanData.instrument ?? ''),
          direction: String(cleanData.direction ?? ''),
          riskPercent: Number(cleanData.riskPercent),
          expectedProfitPercent: Number(cleanData.expectedProfitPercent),
          preTradeEmotion: String(cleanData.preTradeEmotion ?? ''),
          confidence: Number(cleanData.confidence),
          isOutOfSession: Boolean(cleanData.isOutOfSession),
          sessionId: typeof cleanData.sessionId === 'string' ? cleanData.sessionId : undefined,
        });
        if (!creationCheck.valid) {
          throw new ApiValidationError(
            `Trade creation validation failed (${item.tradeId}): ${creationCheck.errors.join(' ')}`
          );
        }

        if (cleanData.isOutOfSession !== true) {
          const parentSession = getRecordById(db, uid, 'sessions', String(cleanData.sessionId ?? ''));
          if (!parentSession) {
            throw new ApiValidationError(
              `Referenced session "${String(cleanData.sessionId ?? '')}" does not exist.`
            );
          }
        }

        const tradeRecord: Record<string, unknown> = {
          ...cleanData,
          id: item.tradeId,
          userId: uid,
          schemaVersion: SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
        };
        validateCollectionRecord('trades', tradeRecord, uid, item.tradeId);

        const openEventId = `te_${item.tradeId}_open`;
        const openEvent: Record<string, unknown> = {
          id: openEventId,
          userId: uid,
          schemaVersion: SCHEMA_VERSION,
          tradeId: item.tradeId,
          eventType: 'trade_opened',
          description: `Opened ${String(cleanData.direction).toUpperCase()} ${String(cleanData.instrument)} on ${String(cleanData.accountName)} (${String(cleanData.riskPercent)}% risk).`,
          emotion: String(cleanData.preTradeEmotion ?? ''),
          timestamp: String(cleanData.openedAt || now),
          createdAt: now,
          updatedAt: now,
        };
        validateCollectionRecord('trade_events', openEvent, uid, openEventId);

        staged.push({ tradeId: item.tradeId, tradeRecord, openEvent });
      }

      let groupRecord: Record<string, unknown> | undefined;
      if (tradeGroup) {
        const cleanGroup = sanitizeFirestorePayload(tradeGroup, {
          rejectNonFinite: true,
          stripNulls: true,
          stripEmptyStringKeys: ['setupLabel'],
        }) as Record<string, unknown>;
        const groupId = String(cleanGroup.id ?? '');
        assertValidRecordId(groupId, 'trade group ID');
        groupRecord = {
          ...cleanGroup,
          id: groupId,
          userId: uid,
          schemaVersion: SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
        };
        validateCollectionRecord('trade_groups', groupRecord, uid, groupId);
      }

      const tx = db.transaction(() => {
        if (groupRecord && !getRecordById(db, uid, 'trade_groups', String(groupRecord.id))) {
          upsertRecordRow(db, uid, 'trade_groups', groupRecord);
        }
        for (const item of staged) {
          if (!getRecordById(db, uid, 'trades', item.tradeId)) {
            upsertRecordRow(db, uid, 'trades', item.tradeRecord);
          }
          if (!getRecordById(db, uid, 'trade_events', String(item.openEvent.id))) {
            upsertRecordRow(db, uid, 'trade_events', item.openEvent);
          }
        }
      });
      tx();

      const changed = ['trades', 'trade_events', ...(groupRecord ? ['trade_groups'] : [])];
      notifyWorkspaceChange(uid, changed);
      res.status(201).json({ ok: true, createdIds: staged.map((s) => s.tradeId) });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/trades/close-batch', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const operationId = String(req.body?.operationId ?? '').trim();
      const entries = (req.body?.entries ?? []) as Array<{
        tradeId: string;
        closing: Record<string, unknown>;
      }>;

      if (!operationId || operationId.length > 128) {
        throw new ApiValidationError('A valid closure operationId is required.');
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        res.json({ ok: true });
        return;
      }

      const uniqueIds = new Set(entries.map((e) => e.tradeId));
      if (uniqueIds.size !== entries.length) {
        throw new ApiValidationError('Duplicate trade IDs found in linked trade closure batch.');
      }

      const closedAt = new Date().toISOString();
      const stagedWrites: Array<{
        tradeId: string;
        mergedTrade: Record<string, unknown>;
        eventId: string;
        eventRecord: Record<string, unknown>;
        eventAlreadyExists: boolean;
      }> = [];
      const seenGroupIds = new Set<string>();
      let alreadyClosedSameOpCount = 0;

      for (let i = 0; i < entries.length; i += 1) {
        const { tradeId, closing } = entries[i];
        assertValidRecordId(tradeId, 'trade ID');

        const closureValidation = validateTradeClosure({
          exitOutcome: String(closing.exitOutcome ?? ''),
          exitReason: String(closing.exitReason ?? ''),
          tpStatus: String(closing.tpStatus ?? ''),
          slStatus: String(closing.slStatus ?? ''),
          actualProfitPercent:
            typeof closing.actualProfitPercent === 'number'
              ? closing.actualProfitPercent
              : undefined,
          actualOutcomeNotes:
            typeof closing.actualOutcomeNotes === 'string' ? closing.actualOutcomeNotes : undefined,
          followedPlan: String(closing.followedPlan ?? ''),
          followedRiskRules: String(closing.followedRiskRules ?? ''),
          impulsiveEntry: String(closing.impulsiveEntry ?? ''),
          exitedPerPlan: String(closing.exitedPerPlan ?? ''),
          postTradeEmotion:
            typeof closing.postTradeEmotion === 'string' ? closing.postTradeEmotion : undefined,
          lessonsLearned:
            typeof closing.lessonsLearned === 'string' ? closing.lessonsLearned : undefined,
          mistakes: Array.isArray(closing.mistakes) ? (closing.mistakes as string[]) : [],
        });
        if (!closureValidation.valid) {
          throw new ApiValidationError(
            `Closure validation failed: ${closureValidation.errors.join(' ')}`
          );
        }

        const existing = getRecordById(db, uid, 'trades', tradeId) as Trade | null;
        if (!existing) {
          throw new ApiValidationError(
            `Persisted trade ${tradeId} not found.`,
            404,
            'database/not-found'
          );
        }
        if (existing.tradeGroupId) {
          seenGroupIds.add(existing.tradeGroupId);
        }

        if (existing.status === 'closed' && existing.closureOperationId === operationId) {
          alreadyClosedSameOpCount += 1;
          continue;
        }
        if (existing.status === 'closed') {
          throw new ApiValidationError(
            `Trade ${tradeId} is already closed under a different operation.`,
            409,
            'conflict/already-closed'
          );
        }
        if (existing.isDeleted) {
          throw new ApiValidationError(
            `Cannot close trade ${tradeId} because it is in Trash. Restore it first.`,
            409,
            'conflict/in-trash'
          );
        }

        const reconciledNetPnl = resolveNetPnl(
          typeof closing.grossPnl === 'number' ? closing.grossPnl : undefined,
          typeof closing.commission === 'number' ? closing.commission : undefined,
          typeof closing.otherCharges === 'number' ? closing.otherCharges : undefined,
          typeof closing.netPnl === 'number' ? closing.netPnl : undefined
        );

        const updateFields = sanitizeFirestorePayload(
          {
            status: 'closed',
            closedAt,
            exitOutcome: closing.exitOutcome,
            exitReason: closing.exitReason,
            tpStatus: closing.tpStatus,
            slStatus: closing.slStatus,
            actualProfitPercent: closing.actualProfitPercent,
            actualOutcomeNotes:
              typeof closing.actualOutcomeNotes === 'string'
                ? closing.actualOutcomeNotes.trim()
                : undefined,
            entryPrice: closing.entryPrice,
            exitPrice: closing.exitPrice,
            stopLossPrice: closing.stopLossPrice,
            takeProfitPrice: closing.takeProfitPrice,
            positionSize: closing.positionSize,
            grossPnl: closing.grossPnl,
            commission: closing.commission,
            otherCharges: closing.otherCharges,
            netPnl: reconciledNetPnl,
            realisedR: closing.realisedR,
            followedPlan: closing.followedPlan,
            followedRiskRules: closing.followedRiskRules,
            impulsiveEntry: closing.impulsiveEntry,
            exitedPerPlan: closing.exitedPerPlan,
            postTradeEmotion: String(closing.postTradeEmotion ?? '').trim(),
            mistakes: Array.isArray(closing.mistakes) ? closing.mistakes : [],
            lessonsLearned:
              typeof closing.lessonsLearned === 'string' ? closing.lessonsLearned.trim() : undefined,
            closureOperationId: operationId,
          },
          {
            rejectNonFinite: true,
            stripNulls: true,
            stripEmptyStringKeys: ['actualOutcomeNotes', 'lessonsLearned'],
          }
        ) as Record<string, unknown>;

        const mergedTrade: Record<string, unknown> = {
          ...existing,
          ...updateFields,
          updatedAt: closedAt,
        };
        const docCheck = validateCompleteTradeDocument(mergedTrade as unknown as Trade);
        if (!docCheck.valid) {
          throw new ApiValidationError(
            `Validation failed for ${tradeId}: ${docCheck.errors.join(' ')}`
          );
        }

        const eventId =
          entries.length === 1
            ? buildClosureEventId(operationId)
            : buildClosureEventId(operationId, i);
        const eventAlreadyExists = Boolean(getRecordById(db, uid, 'trade_events', eventId));
        const actualPct = Number(closing.actualProfitPercent);
        const eventRecord: Record<string, unknown> = {
          id: eventId,
          userId: uid,
          schemaVersion: SCHEMA_VERSION,
          tradeId,
          eventType: 'trade_closed',
          description: `Closed trade as ${String(closing.exitOutcome).toUpperCase()} (${actualPct >= 0 ? '+' : ''}${actualPct}%).`,
          emotion: String(closing.postTradeEmotion ?? '').trim(),
          operationId,
          timestamp: closedAt,
          createdAt: closedAt,
          updatedAt: closedAt,
        };
        validateCollectionRecord('trade_events', eventRecord, uid, eventId);

        stagedWrites.push({
          tradeId,
          mergedTrade,
          eventId,
          eventRecord,
          eventAlreadyExists,
        });
      }

      if (entries.length > 1 && seenGroupIds.size > 1) {
        throw new ApiValidationError(
          'Linked trade closure cannot mix trades from different trade groups.'
        );
      }

      if (alreadyClosedSameOpCount === entries.length) {
        res.json({ ok: true, idempotent: true });
        return;
      }

      if (alreadyClosedSameOpCount > 0 && stagedWrites.length > 0) {
        throw new ApiValidationError(
          `Inconsistent linked closure state for operation ${operationId}: ${alreadyClosedSameOpCount} already closed, ${stagedWrites.length} still open.`,
          409,
          'conflict/inconsistent-state'
        );
      }

      const tx = db.transaction(() => {
        for (const item of stagedWrites) {
          upsertRecordRow(db, uid, 'trades', item.mergedTrade);
          if (!item.eventAlreadyExists) {
            upsertRecordRow(db, uid, 'trade_events', item.eventRecord);
          }
        }
      });
      tx();

      notifyWorkspaceChange(uid, ['trades', 'trade_events']);
      res.json({ ok: true, closedIds: stagedWrites.map((w) => w.tradeId) });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.patch('/api/trades/:id/details', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const tradeId = String(req.params.id);
      assertValidRecordId(tradeId, 'trade ID');

      const existing = getRecordById(db, uid, 'trades', tradeId);
      if (!existing) {
        throw new ApiValidationError(`Trade ${tradeId} not found.`, 404, 'database/not-found');
      }

      const patch = sanitizeFirestorePayload(
        (req.body?.patch ?? {}) as Record<string, unknown>,
        { rejectNonFinite: true, stripNulls: true }
      ) as Record<string, unknown>;
      const clearFields = Array.isArray(req.body?.clearFields)
        ? (req.body.clearFields as string[])
        : [];

      delete patch.id;
      delete patch.userId;
      delete patch.createdAt;
      delete patch.schemaVersion;
      delete patch.closureOperationId;
      delete patch.isDeleted;
      delete patch.deletedAt;
      delete patch.deletedBy;

      const merged: Record<string, unknown> = { ...existing, ...patch };
      for (const field of clearFields) {
        if (
          !(field in patch) &&
          !['id', 'userId', 'createdAt', 'schemaVersion', 'closureOperationId'].includes(field)
        ) {
          delete merged[field];
        }
      }
      merged.updatedAt = new Date().toISOString();

      if (merged.isOutOfSession !== true && merged.sessionId !== existing.sessionId) {
        const parentSession = getRecordById(db, uid, 'sessions', String(merged.sessionId ?? ''));
        if (!parentSession) {
          throw new ApiValidationError('Referenced session does not exist.');
        }
      }

      validateCollectionRecord('trades', merged, uid, tradeId);
      upsertRecordRow(db, uid, 'trades', merged);
      notifyWorkspaceChange(uid, ['trades']);
      res.json({ record: getRecordById(db, uid, 'trades', tradeId) });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/trades/:id/soft-delete', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const tradeId = String(req.params.id);
      assertValidRecordId(tradeId, 'trade ID');

      const existing = getRecordById(db, uid, 'trades', tradeId);
      if (!existing) {
        throw new ApiValidationError(`Trade ${tradeId} not found.`, 404, 'database/not-found');
      }
      const now = new Date().toISOString();
      upsertRecordRow(db, uid, 'trades', {
        ...existing,
        isDeleted: true,
        deletedAt: now,
        deletedBy: uid,
        updatedAt: now,
      });
      notifyWorkspaceChange(uid, ['trades']);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/trades/:id/restore', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const tradeId = String(req.params.id);
      assertValidRecordId(tradeId, 'trade ID');

      const existing = getRecordById(db, uid, 'trades', tradeId);
      if (!existing) {
        throw new ApiValidationError(`Trade ${tradeId} not found.`, 404, 'database/not-found');
      }
      const restored: Record<string, unknown> = { ...existing, isDeleted: false, updatedAt: new Date().toISOString() };
      delete restored.deletedAt;
      delete restored.deletedBy;
      upsertRecordRow(db, uid, 'trades', restored);
      notifyWorkspaceChange(uid, ['trades']);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/trade-groups/soft-delete', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const tradeIds = (req.body?.tradeIds ?? []) as string[];
      if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
        res.json({ ok: true });
        return;
      }
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        for (const id of tradeIds) {
          assertValidRecordId(id, 'trade ID');
          const existing = getRecordById(db, uid, 'trades', id);
          if (existing) {
            upsertRecordRow(db, uid, 'trades', {
              ...existing,
              isDeleted: true,
              deletedAt: now,
              deletedBy: uid,
              updatedAt: now,
            });
          }
        }
      });
      tx();
      notifyWorkspaceChange(uid, ['trades']);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.post('/api/trade-groups/restore', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const tradeIds = (req.body?.tradeIds ?? []) as string[];
      if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
        res.json({ ok: true });
        return;
      }
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        for (const id of tradeIds) {
          assertValidRecordId(id, 'trade ID');
          const existing = getRecordById(db, uid, 'trades', id);
          if (existing) {
            const restored: Record<string, unknown> = { ...existing, isDeleted: false, updatedAt: now };
            delete restored.deletedAt;
            delete restored.deletedBy;
            upsertRecordRow(db, uid, 'trades', restored);
          }
        }
      });
      tx();
      notifyWorkspaceChange(uid, ['trades']);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.delete('/api/trades/:id/cascade', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const tradeId = String(req.params.id);
      assertValidRecordId(tradeId, 'trade ID');

      const existingTrade = getRecordById(db, uid, 'trades', tradeId) as Trade | null;
      const allGroups = listCollectionRows(db, uid, 'trade_groups') as Array<{
        id: string;
        tradeIds: string[];
        accountIds: string[];
      }>;
      const allAttachments = listCollectionRows(db, uid, 'attachments') as AttachmentMeta[];
      const tradeAttachments = allAttachments.filter(
        (att) => att.relatedType === 'trade' && att.relatedId === tradeId
      );
      const now = new Date().toISOString();

      const tx = db.transaction(() => {
        db.prepare('DELETE FROM trade_events WHERE user_id = ? AND trade_id = ?').run(uid, tradeId);
        deleteRecordRow(db, uid, 'trades', tradeId);

        const matchingGroups = allGroups.filter(
          (g) => g.id === existingTrade?.tradeGroupId || g.tradeIds.includes(tradeId)
        );
        for (const group of matchingGroups) {
          const remainingTradeIds = group.tradeIds.filter((id) => id !== tradeId);
          if (remainingTradeIds.length <= 1) {
            deleteRecordRow(db, uid, 'trade_groups', group.id);
            if (remainingTradeIds.length === 1) {
              const sibling = getRecordById(db, uid, 'trades', remainingTradeIds[0]);
              if (sibling) {
                const unlinked: Record<string, unknown> = { ...sibling, updatedAt: now };
                delete unlinked.tradeGroupId;
                upsertRecordRow(db, uid, 'trades', unlinked);
              }
            }
          } else {
            const accountIdToRemove = existingTrade?.accountId;
            const remainingAccountIds = accountIdToRemove
              ? group.accountIds.filter((accId, idx) => {
                  if (accId !== accountIdToRemove) return true;
                  return group.accountIds.indexOf(accountIdToRemove) !== idx;
                })
              : group.accountIds;
            const fullGroup = getRecordById(db, uid, 'trade_groups', group.id);
            if (fullGroup) {
              upsertRecordRow(db, uid, 'trade_groups', {
                ...fullGroup,
                tradeIds: remainingTradeIds,
                accountIds:
                  remainingAccountIds.length > 0 ? remainingAccountIds : group.accountIds,
                updatedAt: now,
              });
            }
          }
        }

        for (const att of tradeAttachments) {
          deleteRecordRow(db, uid, 'attachments', att.id);
        }
      });
      tx();

      for (const att of tradeAttachments) {
        const referencedElsewhere = allAttachments.some(
          (other) => other.relatedId !== tradeId && other.storagePath === att.storagePath
        );
        if (!referencedElsewhere && att.storagePath) {
          deleteAttachmentFile(config.uploadsDir, att.storagePath);
        }
      }

      notifyWorkspaceChange(uid, ['trades', 'trade_events', 'trade_groups', 'attachments']);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // --- Local Attachment Storage Endpoints ---
  app.post(
    '/api/attachments/upload',
    requireAuth,
    uploadMemory.single('file'),
    (req: AuthenticatedRequest, res) => {
      try {
        const uid = req.authUser!.uid;
        const file = req.file;
        if (!file) {
          throw new ApiValidationError('No image file uploaded.');
        }

        const relatedType = String(req.body?.relatedType ?? '');
        const relatedId = String(req.body?.relatedId ?? '');
        const category = String(req.body?.category ?? '');

        if (!['trade', 'session'].includes(relatedType)) {
          throw new ApiValidationError('Invalid attachment relatedType.');
        }
        assertValidRecordId(relatedId, 'relatedId');
        if (!['before_entry', 'entry', 'exit', 'post_trade', 'session_note'].includes(category)) {
          throw new ApiValidationError('Invalid attachment category.');
        }

        const check = validateImageUpload(file.buffer, file.mimetype);
        if (!check.valid) {
          throw new ApiValidationError(check.error || 'Invalid image upload.');
        }

        const attachmentId = generateRecordId('att');
        const safeName = sanitizeFileName(file.originalname || 'screenshot.png');
        const storagePath = `users/${uid}/attachments/${attachmentId}/${safeName}`;
        const checksum = computeBufferSha256(file.buffer);
        const now = new Date().toISOString();

        writeAttachmentFile(config.uploadsDir, storagePath, file.buffer);

        const meta: AttachmentMeta = {
          id: attachmentId,
          userId: uid,
          schemaVersion: SCHEMA_VERSION,
          relatedType: relatedType as 'trade' | 'session',
          relatedId,
          category: category as AttachmentMeta['category'],
          fileName: safeName,
          storagePath,
          contentType: check.normalizedContentType,
          fileSize: file.buffer.length,
          checksum,
          createdAt: now,
          updatedAt: now,
        };

        upsertRecordRow(db, uid, 'attachments', meta as unknown as Record<string, unknown>);
        notifyWorkspaceChange(uid, ['attachments']);
        res.status(201).json({ attachment: meta });
      } catch (err) {
        sendApiError(res, err);
      }
    }
  );

  // Raw binary upload used during UTDS restore
  app.post(
    '/api/attachments/raw',
    requireAuth,
    express.raw({ type: '*/*', limit: '12mb' }),
    (req: AuthenticatedRequest, res) => {
      try {
        const uid = req.authUser!.uid;
        const storagePath = String(req.headers['x-storage-path'] ?? '');
        const contentType = String(req.headers['content-type'] ?? 'image/png');
        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

        if (!storagePath.startsWith(`users/${uid}/attachments/`)) {
          throw new ApiValidationError('Storage path does not belong to the authenticated user.', 403, 'permission/denied');
        }
        const check = validateImageUpload(buf, contentType, { strictMagicBytes: false });
        if (!check.valid) {
          throw new ApiValidationError(check.error || 'Invalid attachment binary.');
        }

        writeAttachmentFile(config.uploadsDir, storagePath, buf);
        res.status(201).json({ ok: true, checksum: computeBufferSha256(buf) });
      } catch (err) {
        sendApiError(res, err);
      }
    }
  );

  app.get('/api/attachments/by-path', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const storagePath = String(req.query.path ?? '');
      if (!storagePath) {
        throw new ApiValidationError('Missing path query parameter.');
      }

      // Verify ownership via attachments metadata table OR user-scoped path prefix
      const attRow = db
        .prepare('SELECT * FROM attachments WHERE user_id = ? AND storage_path = ? LIMIT 1')
        .get(uid, storagePath) as Record<string, unknown> | undefined;

      if (!attRow && !storagePath.startsWith(`users/${uid}/attachments/`)) {
        res.status(403).json({ code: 'permission/denied', error: 'Access denied.' });
        return;
      }

      const buf = readAttachmentFile(config.uploadsDir, storagePath);
      if (!buf) {
        res.status(404).json({ code: 'storage/not-found', error: 'Attachment file not found.' });
        return;
      }

      const contentType = attRow ? String(attRow.content_type) : 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(buf);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  app.delete('/api/attachments/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const id = String(req.params.id);
      assertValidRecordId(id, 'attachment ID');

      const existing = getRecordById(db, uid, 'attachments', id) as AttachmentMeta | null;
      if (!existing) {
        res.json({ ok: true });
        return;
      }

      const allAttachments = listCollectionRows(db, uid, 'attachments') as AttachmentMeta[];
      const stillReferenced = allAttachments.some(
        (other) => other.id !== id && other.storagePath === existing.storagePath
      );

      deleteRecordRow(db, uid, 'attachments', id);
      if (!stillReferenced && existing.storagePath) {
        deleteAttachmentFile(config.uploadsDir, existing.storagePath);
      }

      notifyWorkspaceChange(uid, ['attachments']);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // --- Atomic UTDS v1.0 Bulk Import ---
  app.post('/api/backup/import-utds', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const strategy = String(req.body?.strategy ?? 'skip') as 'skip' | 'copy' | 'replace';
      const bundle = req.body?.bundle as Record<string, unknown> | undefined;

      if (!bundle || typeof bundle !== 'object') {
        throw new ApiValidationError('Missing ATK-UTDS bundle payload.');
      }
      if (!['skip', 'copy', 'replace'].includes(strategy)) {
        throw new ApiValidationError('Invalid import conflict strategy.');
      }

      const report = {
        created: 0,
        replaced: 0,
        copied: 0,
        skipped: 0,
        attachmentsRestored: 0,
        errors: [] as string[],
        attachmentTargets: [] as Array<{ originalId: string; targetId: string; storagePath: string; contentType: string }>,
      };

      const existingSets: Record<string, Set<string>> = {};
      for (const col of SUPPORTED_COLLECTIONS) {
        const rows = db
          .prepare(`SELECT id FROM ${col} WHERE user_id = ?`)
          .all(uid) as Array<{ id: string }>;
        existingSets[col] = new Set(rows.map((r) => r.id));
      }

      const idRemap = new Map<string, string>();
      const deleteOps: Array<{ col: CollectionName; id: string }> = [];
      const upsertOps: Array<{ col: CollectionName; id: string; data: Record<string, unknown> }> = [];
      const now = new Date().toISOString();

      const prepareRecords = <T extends { id: string; createdAt?: string }>(
        col: CollectionName,
        records: T[],
        prefix: string,
        transform?: (rec: T, newId: string) => T
      ) => {
        const existingSet = existingSets[col] ?? new Set<string>();
        for (const rec of records) {
          if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string') continue;
          const exists = existingSet.has(rec.id);
          if (exists && strategy === 'skip') {
            report.skipped += 1;
            continue;
          }

          let targetId = isValidId(rec.id) ? rec.id : generateRecordId(prefix);
          if (!isValidId(rec.id)) {
            idRemap.set(rec.id, targetId);
          }

          if (exists && strategy === 'copy') {
            if (col === 'daily_journals') {
              report.skipped += 1;
              continue;
            }
            targetId = generateRecordId(`${prefix}_imp`);
            idRemap.set(rec.id, targetId);
            report.copied += 1;
          } else if (exists && strategy === 'replace') {
            deleteOps.push({ col, id: targetId });
            report.replaced += 1;
          } else {
            report.created += 1;
          }

          const finalRec = transform ? transform(rec, targetId) : rec;
          const sanitizedBase = sanitizeFirestorePayload(
            {
              ...finalRec,
              id: targetId,
              userId: uid,
              schemaVersion: SCHEMA_VERSION,
              originalCreatedAt:
                typeof finalRec.createdAt === 'string'
                  ? finalRec.createdAt.slice(0, 64)
                  : undefined,
            },
            {
              rejectNonFinite: false,
              stripNulls: true,
              stripStaleSentinels: true,
            }
          ) as Record<string, unknown>;

          sanitizedBase.createdAt =
            typeof finalRec.createdAt === 'string' ? finalRec.createdAt : now;
          sanitizedBase.updatedAt = now;

          if (col === 'trades') {
            const tradeCheck = validateCompleteTradeDocument(sanitizedBase as unknown as Trade);
            if (!tradeCheck.valid) {
              report.errors.push(
                `Skipped invalid imported trade ${targetId}: ${tradeCheck.errors.join(' ')}`
              );
              continue;
            }
          }

          upsertOps.push({ col, id: targetId, data: sanitizedBase });
        }
      };

      type ImportableRec = { id: string; createdAt?: string };
      const arr = <T = ImportableRec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

      // Parents before children to satisfy foreign-key constraints
      prepareRecords('accounts', arr<ImportableRec>(bundle.accounts), 'acc');
      prepareRecords('session_templates', arr<ImportableRec>(bundle.templates), 'tpl');
      prepareRecords('checklists', arr<ImportableRec>(bundle.checklists), 'chk');
      prepareRecords('instruments', arr<ImportableRec>(bundle.instruments), 'inst');
      prepareRecords('daily_journals', arr<ImportableRec>(bundle.daily_journals), 'dj');
      prepareRecords('sessions', arr<ImportableRec>(bundle.sessions), 'ses');
      prepareRecords(
        'session_events',
        arr<{ id: string; sessionId: string; createdAt?: string }>(bundle.session_events),
        'se',
        (ev) => ({
          ...ev,
          sessionId: idRemap.get(ev.sessionId) ?? ev.sessionId,
        })
      );
      prepareRecords('trade_groups', arr<ImportableRec>(bundle.trade_groups), 'tg');
      prepareRecords(
        'trades',
        arr<{
          id: string;
          accountId: string;
          sessionId?: string;
          tradeGroupId?: string;
          createdAt?: string;
        }>(bundle.trades),
        'tr',
        (tr) => ({
          ...tr,
          accountId: idRemap.get(tr.accountId) ?? tr.accountId,
          sessionId: tr.sessionId ? idRemap.get(tr.sessionId) ?? tr.sessionId : undefined,
          tradeGroupId: tr.tradeGroupId
            ? idRemap.get(tr.tradeGroupId) ?? tr.tradeGroupId
            : undefined,
        })
      );
      prepareRecords(
        'trade_events',
        arr<{ id: string; tradeId: string; createdAt?: string }>(bundle.trade_events),
        'te',
        (ev) => ({
          ...ev,
          tradeId: idRemap.get(ev.tradeId) ?? ev.tradeId,
        })
      );
      prepareRecords('reviews', arr<ImportableRec>(bundle.reviews), 'rev');

      // Restore preferences when replacing workspace
      const prefSource = (bundle.settings ?? bundle.profile) as Record<string, unknown> | null;
      if (strategy === 'replace' && prefSource && typeof prefSource === 'object') {
        const cleanArr = (val: unknown, fallback: string[], maxCount: number): string[] => {
          if (!Array.isArray(val)) return fallback;
          return val
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .map((x) => x.trim().slice(0, 120))
            .slice(0, maxCount);
        };
        const pauseSecs = Math.min(60, Math.max(1, Number(prefSource.antiBiasPauseSeconds) || 5));
        const maxSess = Math.min(20, Math.max(1, Number(prefSource.maxSessionsPerDay) || 4));
        const theme =
          prefSource.theme === 'dark' || prefSource.theme === 'system' ? prefSource.theme : 'light';
        const prefCurrency =
          typeof prefSource.preferredCurrency === 'string' &&
          prefSource.preferredCurrency.trim().length >= 3
            ? prefSource.preferredCurrency.trim().toUpperCase().slice(0, 10)
            : DEFAULT_CURRENCY;

        deleteOps.push({ col: 'preferences', id: 'default' });
        upsertOps.push({
          col: 'preferences',
          id: 'default',
          data: stripUndefinedFields({
            id: 'default',
            userId: uid,
            schemaVersion: SCHEMA_VERSION,
            displayName:
              typeof prefSource.displayName === 'string' && prefSource.displayName.trim()
                ? prefSource.displayName.trim().slice(0, 100)
                : 'Trader',
            tradingDeskName:
              typeof prefSource.tradingDeskName === 'string'
                ? prefSource.tradingDeskName.slice(0, 100)
                : 'Personal Desk',
            timezone:
              typeof prefSource.timezone === 'string' && prefSource.timezone.trim()
                ? prefSource.timezone.trim().slice(0, 64)
                : DEFAULT_TIMEZONE,
            preferredCurrency: prefCurrency,
            theme,
            antiBiasPauseEnabled: Boolean(prefSource.antiBiasPauseEnabled ?? true),
            antiBiasPauseSeconds: pauseSecs,
            maxSessionsPerDay: maxSess,
            timeframes: cleanArr(prefSource.timeframes, DEFAULT_TIMEFRAMES, 30),
            entryTypes: cleanArr(prefSource.entryTypes, DEFAULT_ENTRY_TYPES, 30),
            setupLabels: cleanArr(prefSource.setupLabels, DEFAULT_SETUP_LABELS, 40),
            quickSessionEvents: cleanArr(
              prefSource.quickSessionEvents,
              QUICK_SESSION_EVENT_TYPES,
              30
            ),
            originalCreatedAt:
              typeof prefSource.createdAt === 'string'
                ? prefSource.createdAt.slice(0, 64)
                : undefined,
            createdAt: now,
            updatedAt: now,
          }) as Record<string, unknown>,
        });
      }

      // Prepare attachments metadata
      for (const att of arr<AttachmentMeta>(bundle.attachments_index)) {
        const exists = existingSets.attachments.has(att.id);
        if (exists && strategy === 'skip') {
          report.skipped += 1;
          continue;
        }
        let targetId = isValidId(att.id) ? att.id : generateRecordId('att_imp');
        if (exists && strategy === 'copy') {
          targetId = generateRecordId('att_imp');
          report.copied += 1;
        } else if (exists && strategy === 'replace') {
          deleteOps.push({ col: 'attachments', id: targetId });
          report.replaced += 1;
        } else {
          report.created += 1;
        }

        const safeFileName = sanitizeFileName(att.fileName || 'screenshot.png');
        const relatedId = idRemap.get(att.relatedId) ?? att.relatedId;
        const storagePath = `users/${uid}/attachments/${targetId}/${safeFileName}`;

        report.attachmentTargets.push({
          originalId: att.id,
          targetId,
          storagePath,
          contentType: att.contentType || 'image/png',
        });

        const cleanAtt = stripUndefinedFields(
          att as unknown as Record<string, unknown>
        ) as Record<string, unknown>;
        upsertOps.push({
          col: 'attachments',
          id: targetId,
          data: {
            ...cleanAtt,
            id: targetId,
            userId: uid,
            schemaVersion: SCHEMA_VERSION,
            relatedId,
            fileName: safeFileName,
            storagePath,
            originalCreatedAt:
              typeof att.createdAt === 'string' ? att.createdAt.slice(0, 64) : undefined,
            createdAt: typeof att.createdAt === 'string' ? att.createdAt : now,
            updatedAt: now,
          },
        });
      }

      // Execute atomically inside a single SQLite transaction
      // Temporarily defer FK enforcement only if orphaned events exist in a partial backup
      const tx = db.transaction(() => {
        const reverseDeletes = [...deleteOps].reverse();
        for (const del of reverseDeletes) {
          deleteRecordRow(db, uid, del.col, del.id);
        }
        for (const op of upsertOps) {
          // Guard FK references cleanly so an orphaned legacy event never aborts an entire backup restore
          if (op.col === 'session_events') {
            const parent = getRecordById(db, uid, 'sessions', String(op.data.sessionId ?? ''));
            if (!parent) {
              report.errors.push(
                `Skipped orphaned session_event ${op.id} (missing session ${String(op.data.sessionId ?? '')}).`
              );
              continue;
            }
          }
          if (op.col === 'trade_events') {
            const parent = getRecordById(db, uid, 'trades', String(op.data.tradeId ?? ''));
            if (!parent) {
              report.errors.push(
                `Skipped orphaned trade_event ${op.id} (missing trade ${String(op.data.tradeId ?? '')}).`
              );
              continue;
            }
          }
          upsertRecordRow(db, uid, op.col, op.data);
        }
      });
      tx();

      notifyWorkspaceChange(uid, [...SUPPORTED_COLLECTIONS]);
      res.json({ report });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // --- Native Portable Server Snapshot (SQLite DB + Local Uploads ZIP) ---
  app.get('/api/backup/server-snapshot', requireAuth, async (req: AuthenticatedRequest, res) => {
    const tmpDbFile = path.join(
      os.tmpdir(),
      `atk-deck-snapshot-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`
    );
    try {
      const uid = req.authUser!.uid;
      const zip = new JSZip();

      if (config.dbPath !== ':memory:') {
        await db.backup(tmpDbFile);
        const dbBytes = fs.readFileSync(tmpDbFile);
        zip.file('atk-deck.db', dbBytes);
      }

      // Include user's local attachment binaries
      const userUploadsDir = path.join(config.uploadsDir, 'users', uid);
      const addDirToZip = (dir: string, relBase: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const rel = path.posix.join(relBase, entry.name);
          if (entry.isDirectory()) {
            addDirToZip(full, rel);
          } else if (entry.isFile()) {
            zip.file(rel, fs.readFileSync(full));
          }
        }
      };
      addDirToZip(userUploadsDir, `uploads/users/${uid}`);

      zip.file(
        'snapshot_info.json',
        JSON.stringify(
          {
            application: 'ATK Deck',
            snapshotType: 'sqlite_portable_snapshot',
            createdAt: new Date().toISOString(),
            engine: 'sqlite-wal',
            note: 'Place atk-deck.db and the uploads/ directory inside your server DATA_DIR to restore directly.',
          },
          null,
          2
        )
      );

      const archiveBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const dateStamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="ATK_Deck_SQLite_Snapshot_${dateStamp}.zip"`
      );
      res.send(archiveBuf);
    } catch (err) {
      sendApiError(res, err);
    } finally {
      try {
        if (fs.existsSync(tmpDbFile)) fs.unlinkSync(tmpDbFile);
      } catch {
        // ignore temp cleanup failure
      }
    }
  });

  // Catch-all for unknown /api routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'api/not-found', error: 'API endpoint not found.' });
  });

  return { app, db, config };
}
