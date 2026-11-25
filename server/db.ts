import Database from 'better-sqlite3';
import type {
  AttachmentMeta,
  AuditLogEntry,
  ChecklistConfig,
  ChecklistItemState,
  DailyJournal,
  InstrumentConfig,
  SessionEvent,
  SessionTemplate,
  Trade,
  TradeEvent,
  TradeGroup,
  TradingAccount,
  TradingReview,
  TradingSession,
  UserProfilePreferences,
} from '../src/domain/types';

export interface DbUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: 'owner' | 'user';
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
}

export const SUPPORTED_COLLECTIONS = [
  'accounts',
  'daily_journals',
  'sessions',
  'session_events',
  'trades',
  'trade_events',
  'trade_groups',
  'attachments',
  'session_templates',
  'checklists',
  'instruments',
  'preferences',
  'reviews',
  'audit_logs',
] as const;

export type CollectionName = (typeof SUPPORTED_COLLECTIONS)[number];

export function isCollectionName(val: string): val is CollectionName {
  return (SUPPORTED_COLLECTIONS as readonly string[]).includes(val);
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS accounts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  broker TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL,
  capital REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  default_risk_percent REAL NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS daily_journals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  planned_activities TEXT NOT NULL DEFAULT '',
  morning_notes TEXT NOT NULL DEFAULT '',
  daily_emotional_state TEXT NOT NULL DEFAULT '',
  discipline_rating REAL NOT NULL DEFAULT 0,
  daily_reflection TEXT NOT NULL DEFAULT '',
  checklist_items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  template_id TEXT,
  session_name TEXT NOT NULL,
  scheduled_start TEXT,
  scheduled_end TEXT,
  status TEXT NOT NULL,
  attendance TEXT NOT NULL,
  sitting_location TEXT NOT NULL,
  sitting_location_custom TEXT,
  pre_session_emotion TEXT NOT NULL,
  pre_session_emotion_note TEXT,
  session_bias TEXT NOT NULL,
  session_bias_custom TEXT,
  key_levels TEXT,
  market_expectations TEXT,
  liquidity_targets TEXT,
  invalidation_conditions TEXT,
  preparation_notes TEXT,
  checklist_items_json TEXT NOT NULL DEFAULT '[]',
  actual_start_time TEXT,
  actual_end_time TEXT,
  setup_availability TEXT,
  plan_adherence TEXT,
  post_session_emotion TEXT,
  closing_reflection TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date);

CREATE TABLE IF NOT EXISTS session_events (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  session_id TEXT NOT NULL,
  date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, session_id) REFERENCES sessions(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(user_id, session_id);

CREATE TABLE IF NOT EXISTS trade_groups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL,
  setup_label TEXT,
  trade_ids_json TEXT NOT NULL DEFAULT '[]',
  account_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS trades (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  trade_number_of_day INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  session_id TEXT,
  session_name TEXT,
  is_out_of_session INTEGER NOT NULL DEFAULT 0,
  trade_group_id TEXT,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL,
  setup_label TEXT,
  entry_type TEXT,
  timeframe TEXT,
  status TEXT NOT NULL,
  risk_percent REAL NOT NULL,
  expected_profit_percent REAL NOT NULL,
  actual_profit_percent REAL,
  entry_reasoning TEXT,
  expected_outcome TEXT,
  pre_trade_emotion TEXT NOT NULL,
  confidence REAL NOT NULL,
  guard_passed INTEGER,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  exit_outcome TEXT NOT NULL,
  exit_reason TEXT NOT NULL,
  tp_status TEXT NOT NULL,
  sl_status TEXT NOT NULL,
  actual_outcome_notes TEXT,
  entry_price REAL,
  exit_price REAL,
  stop_loss_price REAL,
  take_profit_price REAL,
  position_size REAL,
  gross_pnl REAL,
  commission REAL,
  other_charges REAL,
  net_pnl REAL,
  realised_r REAL,
  currency TEXT,
  followed_plan TEXT NOT NULL,
  followed_risk_rules TEXT NOT NULL,
  impulsive_entry TEXT NOT NULL,
  exited_per_plan TEXT NOT NULL,
  post_trade_emotion TEXT,
  mistakes_json TEXT NOT NULL DEFAULT '[]',
  lessons_learned TEXT,
  closure_operation_id TEXT,
  is_deleted INTEGER,
  deleted_at TEXT,
  deleted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_trades_user_date ON trades(user_id, date);
CREATE INDEX IF NOT EXISTS idx_trades_user_session ON trades(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_group ON trades(user_id, trade_group_id);

CREATE TABLE IF NOT EXISTS trade_events (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  trade_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  partial_close_percent REAL,
  emotion TEXT,
  operation_id TEXT,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, trade_id) REFERENCES trades(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trade_events_trade ON trade_events(user_id, trade_id);

CREATE TABLE IF NOT EXISTS attachments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  related_type TEXT NOT NULL,
  related_id TEXT NOT NULL,
  category TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_attachments_related ON attachments(user_id, related_type, related_id);

CREATE TABLE IF NOT EXISTS session_templates (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS checklists (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS instruments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  trading_desk_name TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL,
  preferred_currency TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'light',
  anti_bias_pause_enabled INTEGER NOT NULL DEFAULT 1,
  anti_bias_pause_seconds INTEGER NOT NULL DEFAULT 5,
  max_sessions_per_day INTEGER NOT NULL DEFAULT 4,
  timeframes_json TEXT NOT NULL DEFAULT '[]',
  entry_types_json TEXT NOT NULL DEFAULT '[]',
  setup_labels_json TEXT NOT NULL DEFAULT '[]',
  quick_session_events_json TEXT NOT NULL DEFAULT '[]',
  quick_trade_events_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS reviews (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  review_type TEXT NOT NULL,
  period_label TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  trading_mistakes TEXT NOT NULL DEFAULT '',
  lessons_learned TEXT NOT NULL DEFAULT '',
  behavioural_patterns TEXT NOT NULL DEFAULT '',
  improvement_goals TEXT NOT NULL DEFAULT '',
  rating REAL NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_created_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  operation_id TEXT NOT NULL,
  module TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  record_id TEXT NOT NULL DEFAULT '',
  document_path TEXT NOT NULL DEFAULT '',
  error_category TEXT NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
`;

export function openSqliteDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);
  return db;
}

function parseJsonArray<T>(raw: unknown, fallback: T[] = []): T[] {
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function optNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function optBool(v: unknown): boolean | undefined {
  if (v === null || v === undefined) return undefined;
  return Boolean(v);
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// --- Row Mappers (SQLite -> Exact Frontend TypeScript Records) ---

export function rowToAccount(r: Record<string, unknown>): TradingAccount {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    name: String(r.name),
    broker: String(r.broker),
    accountType: r.account_type as TradingAccount['accountType'],
    capital: Number(r.capital),
    currency: String(r.currency),
    defaultRiskPercent: Number(r.default_risk_percent),
    isActive: Boolean(r.is_active),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToDailyJournal(r: Record<string, unknown>): DailyJournal {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    date: String(r.date),
    timezone: String(r.timezone),
    plannedActivities: String(r.planned_activities),
    morningNotes: String(r.morning_notes),
    dailyEmotionalState: String(r.daily_emotional_state),
    disciplineRating: Number(r.discipline_rating),
    dailyReflection: String(r.daily_reflection),
    checklistItems: parseJsonArray<ChecklistItemState>(r.checklist_items_json),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToSession(r: Record<string, unknown>): TradingSession {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    date: String(r.date),
    timezone: String(r.timezone),
    templateId: optStr(r.template_id),
    sessionName: String(r.session_name),
    scheduledStart: optStr(r.scheduled_start),
    scheduledEnd: optStr(r.scheduled_end),
    status: r.status as TradingSession['status'],
    attendance: r.attendance as TradingSession['attendance'],
    sittingLocation: r.sitting_location as TradingSession['sittingLocation'],
    sittingLocationCustom: optStr(r.sitting_location_custom),
    preSessionEmotion: String(r.pre_session_emotion),
    preSessionEmotionNote: optStr(r.pre_session_emotion_note),
    sessionBias: r.session_bias as TradingSession['sessionBias'],
    sessionBiasCustom: optStr(r.session_bias_custom),
    keyLevels: optStr(r.key_levels),
    marketExpectations: optStr(r.market_expectations),
    liquidityTargets: optStr(r.liquidity_targets),
    invalidationConditions: optStr(r.invalidation_conditions),
    preparationNotes: optStr(r.preparation_notes),
    checklistItems: parseJsonArray<ChecklistItemState>(r.checklist_items_json),
    actualStartTime: optStr(r.actual_start_time),
    actualEndTime: optStr(r.actual_end_time),
    setupAvailability: optStr(r.setup_availability) as TradingSession['setupAvailability'],
    planAdherence: optStr(r.plan_adherence) as TradingSession['planAdherence'],
    postSessionEmotion: optStr(r.post_session_emotion),
    closingReflection: optStr(r.closing_reflection),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToSessionEvent(r: Record<string, unknown>): SessionEvent {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    sessionId: String(r.session_id),
    date: String(r.date),
    eventType: r.event_type as SessionEvent['eventType'],
    description: String(r.description),
    timestamp: String(r.timestamp),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToTradeGroup(r: Record<string, unknown>): TradeGroup {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    date: String(r.date),
    instrument: String(r.instrument),
    direction: r.direction as TradeGroup['direction'],
    setupLabel: optStr(r.setup_label),
    tradeIds: parseJsonArray<string>(r.trade_ids_json),
    accountIds: parseJsonArray<string>(r.account_ids_json),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToTrade(r: Record<string, unknown>): Trade {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    date: String(r.date),
    timezone: String(r.timezone),
    tradeNumberOfDay: Number(r.trade_number_of_day),
    accountId: String(r.account_id),
    accountName: String(r.account_name),
    sessionId: optStr(r.session_id),
    sessionName: optStr(r.session_name),
    isOutOfSession: Boolean(r.is_out_of_session),
    tradeGroupId: optStr(r.trade_group_id),
    instrument: String(r.instrument),
    direction: r.direction as Trade['direction'],
    setupLabel: optStr(r.setup_label),
    entryType: optStr(r.entry_type),
    timeframe: optStr(r.timeframe),
    status: r.status as Trade['status'],
    riskPercent: Number(r.risk_percent),
    expectedProfitPercent: Number(r.expected_profit_percent),
    actualProfitPercent: optNum(r.actual_profit_percent),
    entryReasoning: optStr(r.entry_reasoning),
    expectedOutcome: optStr(r.expected_outcome),
    preTradeEmotion: String(r.pre_trade_emotion),
    confidence: Number(r.confidence),
    guardPassed: optBool(r.guard_passed),
    openedAt: String(r.opened_at),
    closedAt: optStr(r.closed_at),
    exitOutcome: r.exit_outcome as Trade['exitOutcome'],
    exitReason: r.exit_reason as Trade['exitReason'],
    tpStatus: r.tp_status as Trade['tpStatus'],
    slStatus: r.sl_status as Trade['slStatus'],
    actualOutcomeNotes: optStr(r.actual_outcome_notes),
    entryPrice: optNum(r.entry_price),
    exitPrice: optNum(r.exit_price),
    stopLossPrice: optNum(r.stop_loss_price),
    takeProfitPrice: optNum(r.take_profit_price),
    positionSize: optNum(r.position_size),
    grossPnl: optNum(r.gross_pnl),
    commission: optNum(r.commission),
    otherCharges: optNum(r.other_charges),
    netPnl: optNum(r.net_pnl),
    realisedR: optNum(r.realised_r),
    currency: optStr(r.currency),
    followedPlan: r.followed_plan as Trade['followedPlan'],
    followedRiskRules: r.followed_risk_rules as Trade['followedRiskRules'],
    impulsiveEntry: r.impulsive_entry as Trade['impulsiveEntry'],
    exitedPerPlan: r.exited_per_plan as Trade['exitedPerPlan'],
    postTradeEmotion: optStr(r.post_trade_emotion),
    mistakes: parseJsonArray<string>(r.mistakes_json),
    lessonsLearned: optStr(r.lessons_learned),
    closureOperationId: optStr(r.closure_operation_id),
    isDeleted: optBool(r.is_deleted),
    deletedAt: optStr(r.deleted_at),
    deletedBy: optStr(r.deleted_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToTradeEvent(r: Record<string, unknown>): TradeEvent {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    tradeId: String(r.trade_id),
    eventType: r.event_type as TradeEvent['eventType'],
    description: String(r.description),
    partialClosePercent: optNum(r.partial_close_percent),
    emotion: optStr(r.emotion),
    operationId: optStr(r.operation_id),
    timestamp: String(r.timestamp),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToAttachment(r: Record<string, unknown>): AttachmentMeta {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    relatedType: r.related_type as AttachmentMeta['relatedType'],
    relatedId: String(r.related_id),
    category: r.category as AttachmentMeta['category'],
    fileName: String(r.file_name),
    storagePath: String(r.storage_path),
    contentType: String(r.content_type),
    fileSize: Number(r.file_size),
    checksum: optStr(r.checksum),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToSessionTemplate(r: Record<string, unknown>): SessionTemplate {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    name: String(r.name),
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    isActive: Boolean(r.is_active),
    sortOrder: Number(r.sort_order),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToChecklist(r: Record<string, unknown>): ChecklistConfig {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    scope: r.scope as ChecklistConfig['scope'],
    items: parseJsonArray<string>(r.items_json),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToInstrument(r: Record<string, unknown>): InstrumentConfig {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    symbol: String(r.symbol),
    assetClass: r.asset_class as InstrumentConfig['assetClass'],
    isActive: Boolean(r.is_active),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToPreferences(r: Record<string, unknown>): UserProfilePreferences {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    displayName: String(r.display_name),
    tradingDeskName: String(r.trading_desk_name),
    timezone: String(r.timezone),
    preferredCurrency: String(r.preferred_currency),
    theme: r.theme as UserProfilePreferences['theme'],
    antiBiasPauseEnabled: Boolean(r.anti_bias_pause_enabled),
    antiBiasPauseSeconds: Number(r.anti_bias_pause_seconds),
    maxSessionsPerDay: Number(r.max_sessions_per_day),
    timeframes: parseJsonArray<string>(r.timeframes_json),
    entryTypes: parseJsonArray<string>(r.entry_types_json),
    setupLabels: parseJsonArray<string>(r.setup_labels_json),
    quickSessionEvents: parseJsonArray<string>(r.quick_session_events_json),
    quickTradeEvents:
      typeof r.quick_trade_events_json === 'string'
        ? parseJsonArray<string>(r.quick_trade_events_json)
        : undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToReview(r: Record<string, unknown>): TradingReview {
  return stripUndefined({
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    reviewType: r.review_type as TradingReview['reviewType'],
    periodLabel: String(r.period_label),
    date: String(r.date),
    summary: String(r.summary),
    tradingMistakes: String(r.trading_mistakes),
    lessonsLearned: String(r.lessons_learned),
    behaviouralPatterns: String(r.behavioural_patterns),
    improvementGoals: String(r.improvement_goals),
    rating: Number(r.rating),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    originalCreatedAt: optStr(r.original_created_at),
  });
}

export function rowToAuditLog(r: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    schemaVersion: Number(r.schema_version),
    operationId: String(r.operation_id),
    module: String(r.module),
    operationType: String(r.operation_type),
    recordId: String(r.record_id),
    documentPath: String(r.document_path),
    errorCategory: r.error_category as AuditLogEntry['errorCategory'],
    errorCode: String(r.error_code),
    message: String(r.message),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function listCollectionRows(
  db: Database.Database,
  userId: string,
  collection: CollectionName
): unknown[] {
  const rows = db
    .prepare(`SELECT * FROM ${collection} WHERE user_id = ?`)
    .all(userId) as Record<string, unknown>[];

  switch (collection) {
    case 'accounts':
      return rows.map(rowToAccount);
    case 'daily_journals':
      return rows.map(rowToDailyJournal);
    case 'sessions':
      return rows.map(rowToSession);
    case 'session_events':
      return rows.map(rowToSessionEvent);
    case 'trades':
      return rows.map(rowToTrade);
    case 'trade_events':
      return rows.map(rowToTradeEvent);
    case 'trade_groups':
      return rows.map(rowToTradeGroup);
    case 'attachments':
      return rows.map(rowToAttachment);
    case 'session_templates':
      return rows
        .map(rowToSessionTemplate)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    case 'checklists':
      return rows.map(rowToChecklist);
    case 'instruments':
      return rows.map(rowToInstrument);
    case 'preferences':
      return rows.map(rowToPreferences);
    case 'reviews':
      return rows.map(rowToReview);
    case 'audit_logs':
      return rows.map(rowToAuditLog);
  }
}

export function getRecordById(
  db: Database.Database,
  userId: string,
  collection: CollectionName,
  id: string
): Record<string, unknown> | null {
  const row = db
    .prepare(`SELECT * FROM ${collection} WHERE user_id = ? AND id = ?`)
    .get(userId, id) as Record<string, unknown> | undefined;
  if (!row) return null;
  switch (collection) {
    case 'accounts':
      return rowToAccount(row) as unknown as Record<string, unknown>;
    case 'daily_journals':
      return rowToDailyJournal(row) as unknown as Record<string, unknown>;
    case 'sessions':
      return rowToSession(row) as unknown as Record<string, unknown>;
    case 'session_events':
      return rowToSessionEvent(row) as unknown as Record<string, unknown>;
    case 'trades':
      return rowToTrade(row) as unknown as Record<string, unknown>;
    case 'trade_events':
      return rowToTradeEvent(row) as unknown as Record<string, unknown>;
    case 'trade_groups':
      return rowToTradeGroup(row) as unknown as Record<string, unknown>;
    case 'attachments':
      return rowToAttachment(row) as unknown as Record<string, unknown>;
    case 'session_templates':
      return rowToSessionTemplate(row) as unknown as Record<string, unknown>;
    case 'checklists':
      return rowToChecklist(row) as unknown as Record<string, unknown>;
    case 'instruments':
      return rowToInstrument(row) as unknown as Record<string, unknown>;
    case 'preferences':
      return rowToPreferences(row) as unknown as Record<string, unknown>;
    case 'reviews':
      return rowToReview(row) as unknown as Record<string, unknown>;
    case 'audit_logs':
      return rowToAuditLog(row) as unknown as Record<string, unknown>;
  }
}

export function upsertRecordRow(
  db: Database.Database,
  userId: string,
  collection: CollectionName,
  record: Record<string, unknown>
): void {
  const now = new Date().toISOString();
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : now;
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : now;
  const schemaVersion = Number(record.schemaVersion) || 1;
  const originalCreatedAt =
    typeof record.originalCreatedAt === 'string' ? record.originalCreatedAt : null;

  switch (collection) {
    case 'accounts': {
      db.prepare(`
        INSERT OR REPLACE INTO accounts (
          user_id, id, schema_version, name, broker, account_type, capital, currency,
          default_risk_percent, is_active, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.name),
        String(record.broker ?? ''),
        String(record.accountType),
        Number(record.capital ?? 0),
        String(record.currency),
        Number(record.defaultRiskPercent ?? 1),
        record.isActive === false ? 0 : 1,
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'daily_journals': {
      db.prepare(`
        INSERT OR REPLACE INTO daily_journals (
          user_id, id, schema_version, date, timezone, planned_activities, morning_notes,
          daily_emotional_state, discipline_rating, daily_reflection, checklist_items_json,
          created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.date),
        String(record.timezone),
        String(record.plannedActivities ?? ''),
        String(record.morningNotes ?? ''),
        String(record.dailyEmotionalState ?? ''),
        Number(record.disciplineRating ?? 0),
        String(record.dailyReflection ?? ''),
        JSON.stringify(Array.isArray(record.checklistItems) ? record.checklistItems : []),
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'sessions': {
      db.prepare(`
        INSERT OR REPLACE INTO sessions (
          user_id, id, schema_version, date, timezone, template_id, session_name,
          scheduled_start, scheduled_end, status, attendance, sitting_location,
          sitting_location_custom, pre_session_emotion, pre_session_emotion_note,
          session_bias, session_bias_custom, key_levels, market_expectations,
          liquidity_targets, invalidation_conditions, preparation_notes, checklist_items_json,
          actual_start_time, actual_end_time, setup_availability, plan_adherence,
          post_session_emotion, closing_reflection, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.date),
        String(record.timezone),
        optStr(record.templateId) ?? null,
        String(record.sessionName),
        optStr(record.scheduledStart) ?? null,
        optStr(record.scheduledEnd) ?? null,
        String(record.status),
        String(record.attendance),
        String(record.sittingLocation),
        optStr(record.sittingLocationCustom) ?? null,
        String(record.preSessionEmotion),
        optStr(record.preSessionEmotionNote) ?? null,
        String(record.sessionBias),
        optStr(record.sessionBiasCustom) ?? null,
        optStr(record.keyLevels) ?? null,
        optStr(record.marketExpectations) ?? null,
        optStr(record.liquidityTargets) ?? null,
        optStr(record.invalidationConditions) ?? null,
        optStr(record.preparationNotes) ?? null,
        JSON.stringify(Array.isArray(record.checklistItems) ? record.checklistItems : []),
        optStr(record.actualStartTime) ?? null,
        optStr(record.actualEndTime) ?? null,
        optStr(record.setupAvailability) ?? null,
        optStr(record.planAdherence) ?? null,
        optStr(record.postSessionEmotion) ?? null,
        optStr(record.closingReflection) ?? null,
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'session_events': {
      db.prepare(`
        INSERT OR REPLACE INTO session_events (
          user_id, id, schema_version, session_id, date, event_type, description,
          timestamp, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.sessionId),
        String(record.date),
        String(record.eventType),
        String(record.description ?? ''),
        String(record.timestamp),
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'trade_groups': {
      db.prepare(`
        INSERT OR REPLACE INTO trade_groups (
          user_id, id, schema_version, date, instrument, direction, setup_label,
          trade_ids_json, account_ids_json, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.date),
        String(record.instrument),
        String(record.direction),
        optStr(record.setupLabel) ?? null,
        JSON.stringify(Array.isArray(record.tradeIds) ? record.tradeIds : []),
        JSON.stringify(Array.isArray(record.accountIds) ? record.accountIds : []),
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'trades': {
      db.prepare(`
        INSERT OR REPLACE INTO trades (
          user_id, id, schema_version, date, timezone, trade_number_of_day, account_id,
          account_name, session_id, session_name, is_out_of_session, trade_group_id,
          instrument, direction, setup_label, entry_type, timeframe, status,
          risk_percent, expected_profit_percent, actual_profit_percent, entry_reasoning,
          expected_outcome, pre_trade_emotion, confidence, guard_passed, opened_at,
          closed_at, exit_outcome, exit_reason, tp_status, sl_status, actual_outcome_notes,
          entry_price, exit_price, stop_loss_price, take_profit_price, position_size,
          gross_pnl, commission, other_charges, net_pnl, realised_r, currency,
          followed_plan, followed_risk_rules, impulsive_entry, exited_per_plan,
          post_trade_emotion, mistakes_json, lessons_learned, closure_operation_id,
          is_deleted, deleted_at, deleted_by, created_at, updated_at, original_created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.date),
        String(record.timezone),
        Number(record.tradeNumberOfDay),
        String(record.accountId),
        String(record.accountName),
        optStr(record.sessionId) ?? null,
        optStr(record.sessionName) ?? null,
        record.isOutOfSession ? 1 : 0,
        optStr(record.tradeGroupId) ?? null,
        String(record.instrument),
        String(record.direction),
        optStr(record.setupLabel) ?? null,
        optStr(record.entryType) ?? null,
        optStr(record.timeframe) ?? null,
        String(record.status),
        Number(record.riskPercent),
        Number(record.expectedProfitPercent),
        optNum(record.actualProfitPercent) ?? null,
        optStr(record.entryReasoning) ?? null,
        optStr(record.expectedOutcome) ?? null,
        String(record.preTradeEmotion),
        Number(record.confidence),
        record.guardPassed === undefined ? null : record.guardPassed ? 1 : 0,
        String(record.openedAt),
        optStr(record.closedAt) ?? null,
        String(record.exitOutcome),
        String(record.exitReason),
        String(record.tpStatus),
        String(record.slStatus),
        optStr(record.actualOutcomeNotes) ?? null,
        optNum(record.entryPrice) ?? null,
        optNum(record.exitPrice) ?? null,
        optNum(record.stopLossPrice) ?? null,
        optNum(record.takeProfitPrice) ?? null,
        optNum(record.positionSize) ?? null,
        optNum(record.grossPnl) ?? null,
        optNum(record.commission) ?? null,
        optNum(record.otherCharges) ?? null,
        optNum(record.netPnl) ?? null,
        optNum(record.realisedR) ?? null,
        optStr(record.currency) ?? null,
        String(record.followedPlan),
        String(record.followedRiskRules),
        String(record.impulsiveEntry),
        String(record.exitedPerPlan),
        optStr(record.postTradeEmotion) ?? null,
        JSON.stringify(Array.isArray(record.mistakes) ? record.mistakes : []),
        optStr(record.lessonsLearned) ?? null,
        optStr(record.closureOperationId) ?? null,
        record.isDeleted === undefined ? null : record.isDeleted ? 1 : 0,
        optStr(record.deletedAt) ?? null,
        optStr(record.deletedBy) ?? null,
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'trade_events': {
      db.prepare(`
        INSERT OR REPLACE INTO trade_events (
          user_id, id, schema_version, trade_id, event_type, description,
          partial_close_percent, emotion, operation_id, timestamp,
          created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.tradeId),
        String(record.eventType),
        String(record.description ?? ''),
        optNum(record.partialClosePercent) ?? null,
        optStr(record.emotion) ?? null,
        optStr(record.operationId) ?? null,
        String(record.timestamp),
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'attachments': {
      db.prepare(`
        INSERT OR REPLACE INTO attachments (
          user_id, id, schema_version, related_type, related_id, category, file_name,
          storage_path, content_type, file_size, checksum, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.relatedType),
        String(record.relatedId),
        String(record.category),
        String(record.fileName),
        String(record.storagePath),
        String(record.contentType),
        Number(record.fileSize ?? 0),
        optStr(record.checksum) ?? null,
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'session_templates': {
      db.prepare(`
        INSERT OR REPLACE INTO session_templates (
          user_id, id, schema_version, name, start_time, end_time, is_active,
          sort_order, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.name),
        String(record.startTime),
        String(record.endTime),
        record.isActive === false ? 0 : 1,
        Number(record.sortOrder ?? 0),
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'checklists': {
      db.prepare(`
        INSERT OR REPLACE INTO checklists (
          user_id, id, schema_version, scope, items_json, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.scope),
        JSON.stringify(Array.isArray(record.items) ? record.items : []),
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'instruments': {
      db.prepare(`
        INSERT OR REPLACE INTO instruments (
          user_id, id, schema_version, symbol, asset_class, is_active,
          created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.symbol),
        String(record.assetClass),
        record.isActive === false ? 0 : 1,
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'preferences': {
      db.prepare(`
        INSERT OR REPLACE INTO preferences (
          user_id, id, schema_version, display_name, trading_desk_name, timezone,
          preferred_currency, theme, anti_bias_pause_enabled, anti_bias_pause_seconds,
          max_sessions_per_day, timeframes_json, entry_types_json, setup_labels_json,
          quick_session_events_json, quick_trade_events_json, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.displayName),
        String(record.tradingDeskName ?? ''),
        String(record.timezone),
        String(record.preferredCurrency),
        String(record.theme ?? 'light'),
        record.antiBiasPauseEnabled === false ? 0 : 1,
        Number(record.antiBiasPauseSeconds ?? 5),
        Number(record.maxSessionsPerDay ?? 4),
        JSON.stringify(Array.isArray(record.timeframes) ? record.timeframes : []),
        JSON.stringify(Array.isArray(record.entryTypes) ? record.entryTypes : []),
        JSON.stringify(Array.isArray(record.setupLabels) ? record.setupLabels : []),
        JSON.stringify(Array.isArray(record.quickSessionEvents) ? record.quickSessionEvents : []),
        Array.isArray(record.quickTradeEvents) ? JSON.stringify(record.quickTradeEvents) : null,
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'reviews': {
      db.prepare(`
        INSERT OR REPLACE INTO reviews (
          user_id, id, schema_version, review_type, period_label, date, summary,
          trading_mistakes, lessons_learned, behavioural_patterns, improvement_goals,
          rating, created_at, updated_at, original_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.reviewType),
        String(record.periodLabel),
        String(record.date),
        String(record.summary ?? ''),
        String(record.tradingMistakes ?? ''),
        String(record.lessonsLearned ?? ''),
        String(record.behaviouralPatterns ?? ''),
        String(record.improvementGoals ?? ''),
        Number(record.rating ?? 5),
        createdAt,
        updatedAt,
        originalCreatedAt
      );
      return;
    }
    case 'audit_logs': {
      db.prepare(`
        INSERT OR REPLACE INTO audit_logs (
          user_id, id, schema_version, operation_id, module, operation_type,
          record_id, document_path, error_category, error_code, message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(record.id),
        schemaVersion,
        String(record.operationId),
        String(record.module),
        String(record.operationType),
        String(record.recordId ?? ''),
        String(record.documentPath ?? ''),
        String(record.errorCategory),
        String(record.errorCode ?? ''),
        String(record.message ?? ''),
        createdAt,
        updatedAt
      );
      return;
    }
  }
}

export function deleteRecordRow(
  db: Database.Database,
  userId: string,
  collection: CollectionName,
  id: string
): boolean {
  const result = db
    .prepare(`DELETE FROM ${collection} WHERE user_id = ? AND id = ?`)
    .run(userId, id);
  return result.changes > 0;
}
