import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import type { ServerConfig } from './config.ts';
import type { DbUser } from './db.ts';

export const SESSION_COOKIE_NAME = 'atk_deck_session';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export interface PublicAuthUser {
  uid: string;
  username: string;
  email: string;
  displayName: string;
  role: 'owner' | 'user';
  emailVerified: boolean;
}

export interface AuthenticatedRequest extends Request {
  authUser?: PublicAuthUser;
  authSessionId?: string;
  authCsrfToken?: string;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      expectedBuf.length,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });
  if (derived.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuf);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Derives a cryptographic, session-bound CSRF token from the session ID and
 * stored session token hash. Automatically rotates on every login and invalidates on logout.
 */
export function deriveCsrfToken(sessionId: string, tokenHash: string): string {
  return crypto
    .createHmac('sha256', tokenHash)
    .update(`atk-deck-csrf-v1:${sessionId}`)
    .digest('hex');
}

export function verifyCsrfToken(
  sessionId: string,
  tokenHash: string,
  providedToken: string | undefined
): boolean {
  if (!providedToken || typeof providedToken !== 'string') return false;
  const expected = deriveCsrfToken(sessionId, tokenHash);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(providedToken.trim(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

export interface SessionCookieAttributes {
  secure: boolean;
  sameSite: 'None' | 'Lax';
  partitioned: boolean;
}

export function computeCookieAttributes(
  req: Request,
  config: ServerConfig
): SessionCookieAttributes {
  const rawHost = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const hostname = rawHost.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const isLocalHost =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  const forwardedHeader = String(req.headers['forwarded'] ?? '').toLowerCase();
  const originHeader = String(req.headers.origin ?? '').toLowerCase();
  const refererHeader = String(req.headers.referer ?? '').toLowerCase();
  const secFetchSite = String(req.headers['sec-fetch-site'] ?? '').toLowerCase();
  const secFetchDest = String(req.headers['sec-fetch-dest'] ?? '').toLowerCase();

  const requestIsHttps =
    Boolean(req.secure) ||
    forwardedProto.split(',').some((p) => p.trim() === 'https') ||
    String(req.headers['x-forwarded-ssl'] ?? '').toLowerCase() === 'on' ||
    forwardedHeader.includes('proto=https') ||
    originHeader.startsWith('https://') ||
    refererHeader.startsWith('https://');

  // Embedded/cross-site preview iframes (e.g., AI Studio *.run.app embedded inside aistudio.google.com)
  // require SameSite=None; Secure; Partitioned (CHIPS) so modern browsers store and transmit the HttpOnly cookie.
  const isCrossSiteContext =
    secFetchSite === 'cross-site' ||
    secFetchDest === 'iframe' ||
    /\.run\.app$/i.test(hostname);

  let secure: boolean;
  if (config.cookieSecure === 'false') {
    secure = false;
  } else if (config.cookieSecure === 'true') {
    if (config.isProduction) {
      secure = true;
    } else if (requestIsHttps || isCrossSiteContext) {
      secure = true;
    } else if (isLocalHost) {
      // Automatic fallback for local plain-HTTP development (http://localhost:3000)
      secure = false;
    } else {
      secure = requestIsHttps;
    }
  } else {
    // 'auto'
    secure = requestIsHttps || isCrossSiteContext;
  }

  if (secure && isCrossSiteContext) {
    return { secure: true, sameSite: 'None', partitioned: true };
  }
  if (secure) {
    return { secure: true, sameSite: 'Lax', partitioned: false };
  }
  return { secure: false, sameSite: 'Lax', partitioned: false };
}

export function setSessionCookie(
  req: Request,
  res: Response,
  token: string,
  config: ServerConfig
): void {
  const attrs = computeCookieAttributes(req, config);
  const maxAgeSec = config.sessionTtlDays * 24 * 60 * 60;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
    `SameSite=${attrs.sameSite}`,
  ];
  if (attrs.secure) parts.push('Secure');
  if (attrs.partitioned) parts.push('Partitioned');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response, config: ServerConfig): void {
  const attrs = computeCookieAttributes(req, config);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    `SameSite=${attrs.sameSite}`,
  ];
  if (attrs.secure) parts.push('Secure');
  if (attrs.partitioned) parts.push('Partitioned');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function toPublicAuthUser(row: DbUser): PublicAuthUser {
  return {
    uid: row.id,
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    emailVerified: true,
  };
}

export function mapDbUserRow(r: Record<string, unknown>): DbUser {
  return {
    id: String(r.id),
    username: String(r.username),
    email: String(r.email),
    displayName: String(r.display_name),
    passwordHash: String(r.password_hash),
    role: r.role === 'owner' ? 'owner' : 'user',
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function createSession(
  db: Database.Database,
  userId: string,
  userAgent: string,
  ttlDays: number
): { sessionId: string; token: string; csrfToken: string; expiresAt: string } {
  const sessionId = `sess_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(token);
  const csrfToken = deriveCsrfToken(sessionId, tokenHash);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, user_agent, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, userAgent.slice(0, 255), now.toISOString(), expiresAt);

  // Prune expired sessions opportunistically
  db.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).run(now.toISOString());

  return { sessionId, token, csrfToken, expiresAt };
}

export function resolveSessionUser(
  db: Database.Database,
  req: Request
): { user: PublicAuthUser; sessionId: string; tokenHash: string; csrfToken: string } | null {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken || rawToken.length < 32) return null;

  const tokenHash = sha256Hex(rawToken);
  const nowIso = new Date().toISOString();

  const row = db
    .prepare(`
      SELECT
        s.id AS session_id,
        s.token_hash AS session_token_hash,
        u.id, u.username, u.email, u.display_name, u.password_hash, u.role, u.created_at, u.updated_at
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `)
    .get(tokenHash, nowIso) as
    | (Record<string, unknown> & { session_id: string; session_token_hash: string })
    | undefined;

  if (!row) return null;
  const sessionId = String(row.session_id);
  const storedTokenHash = String(row.session_token_hash);
  return {
    user: toPublicAuthUser(mapDbUserRow(row)),
    sessionId,
    tokenHash: storedTokenHash,
    csrfToken: deriveCsrfToken(sessionId, storedTokenHash),
  };
}

export function createAuthMiddleware(db: Database.Database) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const resolved = resolveSessionUser(db, req);
    if (!resolved) {
      res.status(401).json({
        code: 'auth/unauthenticated',
        error: 'Authentication required. Please sign in to ATK Deck.',
      });
      return;
    }

    // Enforce cryptographic session-bound CSRF token on all authenticated state-changing requests
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const providedCsrf = String(req.headers[CSRF_HEADER_NAME] ?? '');
      if (!verifyCsrfToken(resolved.sessionId, resolved.tokenHash, providedCsrf)) {
        res.status(403).json({
          code: 'permission/csrf-token-invalid',
          error: 'Invalid or missing CSRF token. Please refresh the page and try again.',
        });
        return;
      }
    }

    req.authUser = resolved.user;
    req.authSessionId = resolved.sessionId;
    req.authCsrfToken = resolved.csrfToken;
    next();
  };
}

// Simple sliding-window login rate limiter (10 failed attempts / 15 min per key)
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const failedLoginLog = new Map<string, number[]>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (failedLoginLog.get(key) ?? []).filter(
    (t) => now - t < FAILED_LOGIN_WINDOW_MS
  );
  failedLoginLog.set(key, timestamps);
  return timestamps.length >= MAX_FAILED_LOGINS;
}

export function recordFailedLogin(key: string): void {
  const now = Date.now();
  const timestamps = (failedLoginLog.get(key) ?? []).filter(
    (t) => now - t < FAILED_LOGIN_WINDOW_MS
  );
  timestamps.push(now);
  failedLoginLog.set(key, timestamps);
}

export function clearFailedLogins(key: string): void {
  failedLoginLog.delete(key);
}
