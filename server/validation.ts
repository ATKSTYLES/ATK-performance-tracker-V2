import type Database from 'better-sqlite3';
import {
  DEFAULT_CURRENCY,
  DEFAULT_DAILY_CHECKLIST,
  DEFAULT_ENTRY_TYPES,
  DEFAULT_INSTRUMENTS,
  DEFAULT_SESSION_CHECKLIST,
  DEFAULT_SESSION_TEMPLATES,
  DEFAULT_SETUP_LABELS,
  DEFAULT_TIMEFRAMES,
  DEFAULT_TIMEZONE,
  QUICK_SESSION_EVENT_TYPES,
  SCHEMA_VERSION,
} from '../src/domain/enums.ts';
import type { Trade } from '../src/domain/types.ts';
import {
  DATE_PATTERN,
  isValidId,
  TIME_PATTERN,
  validateCompleteTradeDocument,
} from '../src/domain/validation.ts';
import { type CollectionName, getRecordById, upsertRecordRow } from './db.ts';

export class ApiValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number = 400, code: string = 'validation/invalid-argument') {
    super(message);
    this.name = 'ApiValidationError';
    this.status = status;
    this.code = code;
  }
}

export const APPEND_ONLY_COLLECTIONS = new Set<CollectionName>([
  'session_events',
  'trade_events',
  'attachments',
  'audit_logs',
]);

export function assertValidRecordId(id: string, label: string = 'record ID'): void {
  if (!isValidId(id)) {
    throw new ApiValidationError(`Invalid ${label}: "${id}".`);
  }
}

export function validateCollectionRecord(
  collection: CollectionName,
  record: Record<string, unknown>,
  userId: string,
  docId: string
): void {
  assertValidRecordId(docId, `${collection} ID`);
  if (record.id !== docId) {
    throw new ApiValidationError(`Document id mismatch (${String(record.id)} !== ${docId}).`);
  }
  if (record.userId !== userId) {
    throw new ApiValidationError('Owner identity mismatch.', 403, 'permission/denied');
  }

  switch (collection) {
    case 'accounts': {
      const name = String(record.name ?? '').trim();
      const broker = String(record.broker ?? '');
      const currency = String(record.currency ?? '');
      const capital = Number(record.capital);
      const risk = Number(record.defaultRiskPercent);
      if (!name || name.length > 100) {
        throw new ApiValidationError('Account name must be 1–100 characters.');
      }
      if (broker.length > 100) {
        throw new ApiValidationError('Broker name must be 100 characters or fewer.');
      }
      if (!['live', 'funded', 'evaluation', 'demo', 'personal'].includes(String(record.accountType))) {
        throw new ApiValidationError('Invalid accountType.');
      }
      if (!Number.isFinite(capital) || capital < 0) {
        throw new ApiValidationError('Capital must be a finite non-negative number.');
      }
      if (currency.length < 3 || currency.length > 10) {
        throw new ApiValidationError('Currency code must be 3–10 characters.');
      }
      if (!Number.isFinite(risk) || risk < 0) {
        throw new ApiValidationError('Default risk % must be a finite non-negative number.');
      }
      return;
    }

    case 'daily_journals': {
      if (!DATE_PATTERN.test(String(record.date ?? '')) || record.date !== docId) {
        throw new ApiValidationError('Daily journal date must match YYYY-MM-DD document ID.');
      }
      const rating = Number(record.disciplineRating ?? 0);
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
        throw new ApiValidationError('Discipline rating must be between 0 and 10.');
      }
      if (!Array.isArray(record.checklistItems) || record.checklistItems.length > 50) {
        throw new ApiValidationError('Checklist items must be an array of at most 50 items.');
      }
      return;
    }

    case 'sessions': {
      if (!DATE_PATTERN.test(String(record.date ?? ''))) {
        throw new ApiValidationError('Session date must be YYYY-MM-DD.');
      }
      const sessionName = String(record.sessionName ?? '').trim();
      if (!sessionName || sessionName.length > 120) {
        throw new ApiValidationError('Session name must be 1–120 characters.');
      }
      if (!['planned', 'live', 'completed', 'missed', 'cancelled'].includes(String(record.status))) {
        throw new ApiValidationError('Invalid session status.');
      }
      if (!['attended', 'missed', 'planned', 'cancelled'].includes(String(record.attendance))) {
        throw new ApiValidationError('Invalid session attendance.');
      }
      if (
        !['home', 'office', 'trading_desk', 'travelling', 'other'].includes(
          String(record.sittingLocation)
        )
      ) {
        throw new ApiValidationError('Invalid sitting location.');
      }
      if (!['bullish', 'bearish', 'neutral', 'custom'].includes(String(record.sessionBias))) {
        throw new ApiValidationError('Invalid session bias.');
      }
      return;
    }

    case 'session_events': {
      if (!isValidId(String(record.sessionId ?? ''))) {
        throw new ApiValidationError('Session event requires a valid sessionId.');
      }
      if (!DATE_PATTERN.test(String(record.date ?? ''))) {
        throw new ApiValidationError('Session event date must be YYYY-MM-DD.');
      }
      if (String(record.description ?? '').length > 1000) {
        throw new ApiValidationError('Session event description must be <= 1000 characters.');
      }
      return;
    }

    case 'trades': {
      const check = validateCompleteTradeDocument(record as unknown as Trade);
      if (!check.valid) {
        throw new ApiValidationError(`Trade validation failed: ${check.errors.join(' ')}`);
      }
      return;
    }

    case 'trade_events': {
      if (!isValidId(String(record.tradeId ?? ''))) {
        throw new ApiValidationError('Trade event requires a valid tradeId.');
      }
      if (String(record.description ?? '').length > 1000) {
        throw new ApiValidationError('Trade event description must be <= 1000 characters.');
      }
      return;
    }

    case 'trade_groups': {
      if (!DATE_PATTERN.test(String(record.date ?? ''))) {
        throw new ApiValidationError('Trade group date must be YYYY-MM-DD.');
      }
      if (!['long', 'short'].includes(String(record.direction))) {
        throw new ApiValidationError('Trade group direction must be long or short.');
      }
      if (!Array.isArray(record.tradeIds) || record.tradeIds.length > 25) {
        throw new ApiValidationError('Trade group tradeIds must contain <= 25 items.');
      }
      if (!Array.isArray(record.accountIds) || record.accountIds.length > 25) {
        throw new ApiValidationError('Trade group accountIds must contain <= 25 items.');
      }
      return;
    }

    case 'session_templates': {
      const name = String(record.name ?? '').trim();
      if (!name || name.length > 80) {
        throw new ApiValidationError('Session template name must be 1–80 characters.');
      }
      if (!TIME_PATTERN.test(String(record.startTime ?? '')) || !TIME_PATTERN.test(String(record.endTime ?? ''))) {
        throw new ApiValidationError('Session template startTime and endTime must be HH:MM.');
      }
      return;
    }

    case 'checklists': {
      if (!['daily', 'session'].includes(String(record.scope))) {
        throw new ApiValidationError('Checklist scope must be daily or session.');
      }
      if (!Array.isArray(record.items) || record.items.length > 50) {
        throw new ApiValidationError('Checklist items must contain <= 50 strings.');
      }
      return;
    }

    case 'instruments': {
      const symbol = String(record.symbol ?? '').trim();
      if (!symbol || symbol.length > 32) {
        throw new ApiValidationError('Instrument symbol must be 1–32 characters.');
      }
      if (
        !['forex', 'metals', 'crypto', 'indices', 'equities', 'commodities', 'other'].includes(
          String(record.assetClass)
        )
      ) {
        throw new ApiValidationError('Invalid instrument assetClass.');
      }
      return;
    }

    case 'preferences': {
      const displayName = String(record.displayName ?? '').trim();
      if (!displayName || displayName.length > 100) {
        throw new ApiValidationError('Display name must be 1–100 characters.');
      }
      const currency = String(record.preferredCurrency ?? '');
      if (currency.length < 3 || currency.length > 10) {
        throw new ApiValidationError('Preferred currency must be 3–10 characters.');
      }
      if (!['light', 'dark', 'system'].includes(String(record.theme ?? 'light'))) {
        throw new ApiValidationError('Invalid theme mode.');
      }
      const pause = Number(record.antiBiasPauseSeconds ?? 5);
      if (!Number.isFinite(pause) || pause < 1 || pause > 60) {
        throw new ApiValidationError('Anti-bias pause seconds must be between 1 and 60.');
      }
      const maxSess = Number(record.maxSessionsPerDay ?? 4);
      if (!Number.isFinite(maxSess) || maxSess < 1 || maxSess > 20) {
        throw new ApiValidationError('Max sessions per day must be between 1 and 20.');
      }
      return;
    }

    case 'reviews': {
      if (!['daily', 'weekly', 'monthly', 'strategy'].includes(String(record.reviewType))) {
        throw new ApiValidationError('Invalid reviewType.');
      }
      if (!DATE_PATTERN.test(String(record.date ?? ''))) {
        throw new ApiValidationError('Review date must be YYYY-MM-DD.');
      }
      const rating = Number(record.rating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
        throw new ApiValidationError('Review rating must be between 1 and 10.');
      }
      return;
    }

    case 'attachments': {
      if (!['trade', 'session'].includes(String(record.relatedType))) {
        throw new ApiValidationError('Attachment relatedType must be trade or session.');
      }
      if (!isValidId(String(record.relatedId ?? ''))) {
        throw new ApiValidationError('Attachment relatedId is invalid.');
      }
      return;
    }

    case 'audit_logs': {
      return;
    }
  }
}

export function seedInitialWorkspaceIfEmpty(
  db: Database.Database,
  userId: string,
  displayName: string
): boolean {
  const existingPref = getRecordById(db, userId, 'preferences', 'default');
  if (existingPref) return false;

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    upsertRecordRow(db, userId, 'preferences', {
      id: 'default',
      userId,
      schemaVersion: SCHEMA_VERSION,
      displayName: (displayName || 'Trader').slice(0, 100),
      tradingDeskName: 'Personal Desk',
      timezone: DEFAULT_TIMEZONE,
      preferredCurrency: DEFAULT_CURRENCY,
      theme: 'light',
      antiBiasPauseEnabled: true,
      antiBiasPauseSeconds: 5,
      maxSessionsPerDay: 4,
      timeframes: DEFAULT_TIMEFRAMES,
      entryTypes: DEFAULT_ENTRY_TYPES,
      setupLabels: DEFAULT_SETUP_LABELS,
      quickSessionEvents: QUICK_SESSION_EVENT_TYPES,
      createdAt: now,
      updatedAt: now,
    });

    for (const tpl of DEFAULT_SESSION_TEMPLATES) {
      upsertRecordRow(db, userId, 'session_templates', {
        id: tpl.id,
        userId,
        schemaVersion: SCHEMA_VERSION,
        name: tpl.name,
        startTime: tpl.startTime,
        endTime: tpl.endTime,
        isActive: tpl.isActive,
        sortOrder: tpl.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
    }

    upsertRecordRow(db, userId, 'checklists', {
      id: 'daily',
      userId,
      schemaVersion: SCHEMA_VERSION,
      scope: 'daily',
      items: DEFAULT_DAILY_CHECKLIST,
      createdAt: now,
      updatedAt: now,
    });

    upsertRecordRow(db, userId, 'checklists', {
      id: 'session',
      userId,
      schemaVersion: SCHEMA_VERSION,
      scope: 'session',
      items: DEFAULT_SESSION_CHECKLIST,
      createdAt: now,
      updatedAt: now,
    });

    for (const inst of DEFAULT_INSTRUMENTS) {
      const id = `inst_${inst.symbol.toLowerCase()}`;
      upsertRecordRow(db, userId, 'instruments', {
        id,
        userId,
        schemaVersion: SCHEMA_VERSION,
        symbol: inst.symbol,
        assetClass: inst.assetClass,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const existingAccountsCount = (
      db.prepare('SELECT COUNT(*) AS cnt FROM accounts WHERE user_id = ?').get(userId) as {
        cnt: number;
      }
    ).cnt;

    if (existingAccountsCount === 0) {
      upsertRecordRow(db, userId, 'accounts', {
        id: 'acc_primary',
        userId,
        schemaVersion: SCHEMA_VERSION,
        name: 'Primary Personal Account',
        broker: 'Personal Broker',
        accountType: 'personal',
        capital: 10000,
        currency: DEFAULT_CURRENCY,
        defaultRiskPercent: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  tx();
  return true;
}
