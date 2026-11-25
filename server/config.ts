import fs from 'node:fs';
import path from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
  isProduction: boolean;
  dataDir: string;
  dbPath: string;
  uploadsDir: string;
  allowPublicRegistration: boolean;
  sessionTtlDays: number;
  cookieSecure: 'auto' | 'true' | 'false';
  databaseUrl?: string;
}

export function loadServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const nodeEnv = overrides?.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const dataDir = path.resolve(
    overrides?.dataDir ??
      process.env.DATA_DIR ??
      process.env.RAILWAY_VOLUME_MOUNT_PATH ??
      path.join(process.cwd(), 'data')
  );
  const dbPath = overrides?.dbPath ?? process.env.DB_PATH ?? path.join(dataDir, 'atk-deck.db');
  const uploadsDir =
    overrides?.uploadsDir ?? process.env.UPLOADS_DIR ?? path.join(dataDir, 'uploads');

  const defaultCookieSecure = isProduction ? 'true' : 'auto';
  const rawCookieSecure = String(
    overrides?.cookieSecure ?? process.env.COOKIE_SECURE ?? defaultCookieSecure
  ).toLowerCase();
  const cookieSecure: 'auto' | 'true' | 'false' =
    rawCookieSecure === 'true' ? 'true' : rawCookieSecure === 'false' ? 'false' : 'auto';

  const sessionTtlDays = Math.max(
    1,
    Math.min(365, Number(overrides?.sessionTtlDays ?? process.env.SESSION_TTL_DAYS ?? 14) || 14)
  );

  const allowPublicRegistration =
    overrides?.allowPublicRegistration ??
    (process.env.ALLOW_PUBLIC_REGISTRATION === 'true');

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  fs.mkdirSync(uploadsDir, { recursive: true });

  const parsedPort = Number.parseInt(String(overrides?.port ?? process.env.PORT ?? '3000'), 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;

  return {
    port,
    host: overrides?.host ?? process.env.HOST ?? '0.0.0.0',
    nodeEnv,
    isProduction,
    dataDir,
    dbPath,
    uploadsDir,
    allowPublicRegistration,
    sessionTtlDays,
    cookieSecure,
    databaseUrl: overrides?.databaseUrl ?? process.env.DATABASE_URL,
  };
}
