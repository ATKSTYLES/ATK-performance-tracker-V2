import type { Trade, TradingSession } from './types.ts';

export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^\d{2}:\d{2}$/;

export function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_PATTERN.test(id);
}

export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'id';
}

export function generateRecordId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now()}_${rand}`;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePreSessionCheckIn(input: {
  sessionName: string;
  sittingLocation: string;
  sittingLocationCustom?: string;
  preSessionEmotion: string;
  sessionBias: string;
  sessionBiasCustom?: string;
}): ValidationResult {
  const errors: string[] = [];
  if (!input.sessionName.trim()) {
    errors.push('Session name is required.');
  } else if (input.sessionName.trim().length > 120) {
    errors.push('Session name must be 120 characters or fewer.');
  }
  if (!input.sittingLocation) {
    errors.push('Sitting location is required.');
  }
  if (input.sittingLocation === 'other' && !input.sittingLocationCustom?.trim()) {
    errors.push('Please describe your sitting location when Other is selected.');
  }
  if (!input.preSessionEmotion) {
    errors.push('Pre-session emotion is required.');
  }
  if (!input.sessionBias) {
    errors.push('Session bias is required.');
  }
  if (input.sessionBias === 'custom' && !input.sessionBiasCustom?.trim()) {
    errors.push('Please provide a custom bias description.');
  }
  return { valid: errors.length === 0, errors };
}

export function validateTradeCreation(input: {
  accountId: string;
  instrument: string;
  direction: string;
  riskPercent: number;
  expectedProfitPercent: number;
  preTradeEmotion: string;
  confidence: number;
  isOutOfSession: boolean;
  sessionId?: string;
}): ValidationResult {
  const errors: string[] = [];
  if (!input.accountId || !isValidId(input.accountId)) {
    errors.push('A valid trading account is required.');
  }
  if (!input.instrument.trim() || input.instrument.trim().length > 32) {
    errors.push('Instrument is required (max 32 characters).');
  }
  if (input.direction !== 'long' && input.direction !== 'short') {
    errors.push('Direction must be Long or Short.');
  }
  if (typeof input.riskPercent !== 'number' || !Number.isFinite(input.riskPercent) || input.riskPercent < 0) {
    errors.push('Risk % must be a valid non-negative number.');
  }
  if (typeof input.expectedProfitPercent !== 'number' || !Number.isFinite(input.expectedProfitPercent)) {
    errors.push('Expected Profit % must be a valid number.');
  }
  if (!input.preTradeEmotion.trim() || input.preTradeEmotion.trim().length > 64) {
    errors.push('Pre-trade emotion is required (max 64 characters).');
  }
  if (
    typeof input.confidence !== 'number' ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 1 ||
    input.confidence > 10
  ) {
    errors.push('Confidence must be between 1 and 10.');
  }
  if (!input.isOutOfSession && (!input.sessionId || !isValidId(input.sessionId))) {
    errors.push('In-session trade must reference an active session.');
  }
  return { valid: errors.length === 0, errors };
}

export function validateTradeClosure(input: {
  exitOutcome: string;
  exitReason: string;
  tpStatus: string;
  slStatus: string;
  actualProfitPercent?: number;
  actualOutcomeNotes?: string;
  followedPlan: string;
  followedRiskRules: string;
  impulsiveEntry: string;
  exitedPerPlan: string;
  postTradeEmotion?: string;
  lessonsLearned?: string;
  mistakes?: string[];
}): ValidationResult {
  const errors: string[] = [];
  if (!['win', 'loss', 'breakeven'].includes(input.exitOutcome)) {
    errors.push('Exit Outcome must be Win, Loss, or Breakeven.');
  }
  if (!['take_profit', 'stop_loss', 'manual_exit', 'breakeven_exit', 'other'].includes(input.exitReason)) {
    errors.push('Please select a valid Exit Reason.');
  }
  if (!['pending', 'hit_full', 'partial', 'missed', 'not_used'].includes(input.tpStatus)) {
    errors.push('Please select a valid Take Profit status.');
  }
  if (!['pending', 'hit', 'trailed_breakeven', 'moved', 'untouched'].includes(input.slStatus)) {
    errors.push('Please select a valid Stop Loss status.');
  }
  if (input.actualProfitPercent === undefined || !Number.isFinite(input.actualProfitPercent)) {
    errors.push('Actual Profit % is required when closing a trade.');
  }
  if (!['yes', 'no', 'na'].includes(input.followedPlan)) {
    errors.push('Followed Plan response is required.');
  }
  if (!['yes', 'no', 'na'].includes(input.followedRiskRules)) {
    errors.push('Followed Risk Rules response is required.');
  }
  if (!['yes', 'no', 'na'].includes(input.impulsiveEntry)) {
    errors.push('Impulsive Entry response is required.');
  }
  if (!['yes', 'no', 'na'].includes(input.exitedPerPlan)) {
    errors.push('Exited Per Plan response is required.');
  }
  if (!input.postTradeEmotion?.trim()) {
    errors.push('Post-trade emotion is required.');
  } else if (input.postTradeEmotion.length > 64) {
    errors.push('Post-trade emotion must be 64 characters or fewer.');
  }
  if (input.actualOutcomeNotes && input.actualOutcomeNotes.length > 4000) {
    errors.push('Actual Outcome Notes must be 4000 characters or fewer.');
  }
  if (input.lessonsLearned && input.lessonsLearned.length > 4000) {
    errors.push('Lessons Learned must be 4000 characters or fewer.');
  }
  if (input.mistakes && input.mistakes.length > 20) {
    errors.push('Mistakes list cannot exceed 20 entries.');
  }
  return { valid: errors.length === 0, errors };
}

export const NON_NULLABLE_TRADE_KEYS: readonly string[] = [
  'id',
  'userId',
  'schemaVersion',
  'date',
  'timezone',
  'tradeNumberOfDay',
  'accountId',
  'accountName',
  'isOutOfSession',
  'instrument',
  'direction',
  'status',
  'riskPercent',
  'expectedProfitPercent',
  'preTradeEmotion',
  'confidence',
  'openedAt',
  'exitOutcome',
  'exitReason',
  'tpStatus',
  'slStatus',
  'followedPlan',
  'followedRiskRules',
  'impulsiveEntry',
  'exitedPerPlan',
  'mistakes',
  'actualProfitPercent',
  'entryPrice',
  'exitPrice',
  'stopLossPrice',
  'takeProfitPrice',
  'positionSize',
  'grossPnl',
  'commission',
  'otherCharges',
  'netPnl',
  'realisedR',
  'sessionId',
  'sessionName',
  'tradeGroupId',
  'actualOutcomeNotes',
  'lessonsLearned',
  'postTradeEmotion',
  'closureOperationId',
];

export function isLiveFirestoreSentinel(val: unknown): boolean {
  if (typeof val !== 'object' || val === null) return false;
  // Plain serialized objects from JSON.parse have Object.prototype and are stale sentinels, not live FieldValues
  const proto = Object.getPrototypeOf(val);
  if (proto === Object.prototype) {
    return false;
  }
  const rec = val as Record<string, unknown>;
  return '_methodName' in rec || typeof (val as { isEqual?: unknown }).isEqual === 'function';
}

export function isStaleSerializedSentinel(val: unknown): boolean {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  if (Object.getPrototypeOf(val) !== Object.prototype) return false;
  const rec = val as Record<string, unknown>;
  if (rec.__serverTimestamp === true || rec.__deleteField === true) return true;
  if (
    typeof rec._methodName === 'string' &&
    (rec._methodName === 'serverTimestamp' ||
      rec._methodName === 'deleteField' ||
      rec._methodName.startsWith('FieldValue'))
  ) {
    return true;
  }
  return false;
}

export interface SanitizePayloadOptions {
  /** Reject NaN, Infinity, and -Infinity by throwing a descriptive validation Error (default: true). */
  rejectNonFinite?: boolean;
  /** Keys for which an explicit `null` must throw rather than be omitted. */
  rejectNullKeys?: readonly string[];
  /** Strip `null` values on optional fields (default: true). */
  stripNulls?: boolean;
  /** Keys where empty strings `""` represent an omitted optional field and should be removed. */
  stripEmptyStringKeys?: readonly string[];
  /** Strip plain JSON-serialized FieldValue/timestamp sentinel remnants (default: true). */
  stripStaleSentinels?: boolean;
}

export function sanitizeFirestorePayload<T extends Record<string, unknown>>(
  obj: T,
  options: SanitizePayloadOptions = {}
): Partial<T> {
  const {
    rejectNonFinite = true,
    rejectNullKeys = [],
    stripNulls = true,
    stripEmptyStringKeys = [],
    stripStaleSentinels = true,
  } = options;

  const rejectNullSet = new Set(rejectNullKeys);
  const stripEmptySet = new Set(stripEmptyStringKeys);
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;

    if (v === null) {
      if (rejectNullSet.has(k)) {
        throw new Error(`Invalid null value for non-nullable field "${k}".`);
      }
      if (!stripNulls) {
        out[k] = null;
      }
      continue;
    }

    if (typeof v === 'number') {
      if (!Number.isFinite(v)) {
        if (rejectNonFinite) {
          throw new Error(`Field "${k}" must be a finite number (received ${String(v)}).`);
        }
        continue;
      }
      out[k] = v; // Preserves legitimate 0 and negative numbers
      continue;
    }

    if (typeof v === 'boolean') {
      out[k] = v; // Preserves legitimate false
      continue;
    }

    if (typeof v === 'string') {
      if (stripEmptySet.has(k) && v.trim() === '') {
        continue;
      }
      out[k] = v;
      continue;
    }

    if (isLiveFirestoreSentinel(v) || v instanceof Date) {
      out[k] = v;
      continue;
    }

    if (stripStaleSentinels && isStaleSerializedSentinel(v)) {
      continue;
    }

    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'number' && !Number.isFinite(item) && rejectNonFinite) {
          throw new Error(`Array field "${k}" contains a non-finite number.`);
        }
      }
      out[k] = v;
      continue;
    }

    out[k] = v;
  }

  return out as Partial<T>;
}

/**
 * Recursively removes createdAt/updatedAt and stale serialized FieldValue/timestamp sentinel objects
 * before storing or replaying offline sync queue payloads.
 */
export function sanitizeQueuePayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'number') {
    if (!Number.isFinite(payload)) {
      throw new Error(`Queued payload contains a non-finite number (${String(payload)}).`);
    }
    return payload;
  }
  if (typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeQueuePayload(item));
  }
  if (isLiveFirestoreSentinel(payload) || isStaleSerializedSentinel(payload)) {
    return undefined;
  }
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (k === 'createdAt' || k === 'updatedAt' || v === undefined) continue;
    if (isLiveFirestoreSentinel(v) || isStaleSerializedSentinel(v)) continue;
    const cleaned = sanitizeQueuePayload(v);
    if (cleaned !== undefined) {
      clone[k] = cleaned;
    }
  }
  return clone;
}

export function validateCompleteTradeDocument(trade: Trade): ValidationResult {
  const errors: string[] = [];
  if (!isValidId(trade.id)) errors.push('Invalid trade ID.');
  if (!isValidId(trade.userId)) errors.push('Invalid user ID.');
  if (!DATE_PATTERN.test(trade.date)) errors.push('Invalid trade date.');
  if (!trade.timezone || trade.timezone.length > 64) errors.push('Invalid timezone.');
  if (typeof trade.tradeNumberOfDay !== 'number' || !Number.isFinite(trade.tradeNumberOfDay) || trade.tradeNumberOfDay < 1) {
    errors.push('Trade # of day must be a finite number >= 1.');
  }
  if (!isValidId(trade.accountId)) errors.push('Invalid trading account ID.');
  if (!trade.accountName || trade.accountName.length > 120) errors.push('Invalid trading account name.');
  if (typeof trade.isOutOfSession !== 'boolean') errors.push('isOutOfSession must be a boolean.');
  if (!trade.isOutOfSession && (!trade.sessionId || !isValidId(trade.sessionId))) {
    errors.push('In-session trade must reference a valid sessionId.');
  }
  if (!trade.instrument || trade.instrument.length > 32) errors.push('Invalid instrument.');
  if (trade.direction !== 'long' && trade.direction !== 'short') errors.push('Direction must be long or short.');
  if (!['before_entry', 'during_trade', 'closed'].includes(trade.status)) errors.push('Invalid trade status.');
  if (typeof trade.riskPercent !== 'number' || !Number.isFinite(trade.riskPercent) || trade.riskPercent < 0) {
    errors.push('Risk % must be a valid non-negative finite number.');
  }
  if (typeof trade.expectedProfitPercent !== 'number' || !Number.isFinite(trade.expectedProfitPercent)) {
    errors.push('Expected Profit % must be a valid finite number.');
  }
  if (!trade.preTradeEmotion || trade.preTradeEmotion.length > 64) {
    errors.push('Pre-trade emotion is required (max 64 characters).');
  }
  if (typeof trade.confidence !== 'number' || !Number.isFinite(trade.confidence) || trade.confidence < 1 || trade.confidence > 10) {
    errors.push('Confidence must be between 1 and 10.');
  }
  if (!trade.openedAt || trade.openedAt.length > 64) {
    errors.push('Invalid openedAt timestamp.');
  }
  if (!['pending', 'win', 'loss', 'breakeven'].includes(trade.exitOutcome)) {
    errors.push('Invalid exit outcome.');
  }
  if (!['pending', 'take_profit', 'stop_loss', 'manual_exit', 'breakeven_exit', 'other'].includes(trade.exitReason)) {
    errors.push('Invalid exit reason.');
  }
  if (!['pending', 'hit_full', 'partial', 'missed', 'not_used'].includes(trade.tpStatus)) {
    errors.push('Invalid TP status.');
  }
  if (!['pending', 'hit', 'trailed_breakeven', 'moved', 'untouched'].includes(trade.slStatus)) {
    errors.push('Invalid SL status.');
  }
  if (!['yes', 'no', 'na'].includes(trade.followedPlan)) errors.push('Invalid followedPlan flag.');
  if (!['yes', 'no', 'na'].includes(trade.followedRiskRules)) errors.push('Invalid followedRiskRules flag.');
  if (!['yes', 'no', 'na'].includes(trade.impulsiveEntry)) errors.push('Invalid impulsiveEntry flag.');
  if (!['yes', 'no', 'na'].includes(trade.exitedPerPlan)) errors.push('Invalid exitedPerPlan flag.');
  if (trade.actualOutcomeNotes && trade.actualOutcomeNotes.length > 4000) {
    errors.push('Actual outcome notes must be 4000 characters or fewer.');
  }
  if (trade.lessonsLearned && trade.lessonsLearned.length > 4000) {
    errors.push('Lessons learned must be 4000 characters or fewer.');
  }
  if (trade.postTradeEmotion && trade.postTradeEmotion.length > 64) {
    errors.push('Post-trade emotion must be 64 characters or fewer.');
  }
  if (trade.closureOperationId && trade.closureOperationId.length > 128) {
    errors.push('Closure operation ID must be 128 characters or fewer.');
  }
  if (trade.currency && trade.currency.length > 10) {
    errors.push('Currency code must be 10 characters or fewer.');
  }
  if (!Array.isArray(trade.mistakes) || trade.mistakes.length > 20) {
    errors.push('Mistakes must be an array with at most 20 items.');
  } else if (trade.mistakes.some((m) => typeof m !== 'string' || m.length > 120)) {
    errors.push('Each mistake item must be a string of 120 characters or fewer.');
  }

  const optionalNumbers: Array<[string, number | undefined]> = [
    ['actualProfitPercent', trade.actualProfitPercent],
    ['entryPrice', trade.entryPrice],
    ['exitPrice', trade.exitPrice],
    ['stopLossPrice', trade.stopLossPrice],
    ['takeProfitPrice', trade.takeProfitPrice],
    ['positionSize', trade.positionSize],
    ['grossPnl', trade.grossPnl],
    ['commission', trade.commission],
    ['otherCharges', trade.otherCharges],
    ['netPnl', trade.netPnl],
    ['realisedR', trade.realisedR],
  ];
  for (const [field, val] of optionalNumbers) {
    if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val))) {
      errors.push(`${field} must be a finite number when provided.`);
    }
  }

  if (trade.status === 'closed') {
    if (!['win', 'loss', 'breakeven'].includes(trade.exitOutcome)) {
      errors.push('Closed trade must have a resolved exit outcome.');
    }
    if (!trade.closedAt || trade.closedAt.length > 64) {
      errors.push('Closed trade must have a valid closedAt timestamp.');
    }
    if (typeof trade.actualProfitPercent !== 'number' || !Number.isFinite(trade.actualProfitPercent)) {
      errors.push('Closed trade must have a finite actualProfitPercent.');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateSessionTransition(
  currentStatus: TradingSession['status'],
  nextStatus: TradingSession['status']
): boolean {
  if (currentStatus === 'completed' || currentStatus === 'cancelled' || currentStatus === 'missed') {
    return currentStatus === nextStatus;
  }
  return true;
}

export function stripUndefinedFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return sanitizeFirestorePayload(obj, {
    rejectNonFinite: false,
    stripNulls: true,
    stripStaleSentinels: false,
  });
}

export function computeDefaultExpectedProfit(riskPercent: number): number {
  if (typeof riskPercent !== 'number' || !Number.isFinite(riskPercent) || riskPercent < 0) {
    return 0;
  }
  return Number((riskPercent * 3).toFixed(4));
}

export interface TradeFilterOptions {
  searchQuery?: string;
  accountFilter?: string;
  instrumentFilter?: string;
  resultFilter?: string;
  statusFilter?: string;
  sessionFilter?: string;
  dateFilter?: string;
  monthFilter?: string;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
}

export function filterTrades(trades: Trade[], filters: TradeFilterOptions): Trade[] {
  const q = (filters.searchQuery ?? '').trim().toLowerCase();
  const accountFilter = filters.accountFilter ?? 'all';
  const instrumentFilter = filters.instrumentFilter ?? 'all';
  const resultFilter = filters.resultFilter ?? 'all';
  const statusFilter = filters.statusFilter ?? 'all';
  const sessionFilter = filters.sessionFilter ?? 'all';
  const dateFilter = (filters.dateFilter ?? '').trim();
  const monthFilter = (filters.monthFilter ?? '').trim();

  return [...trades]
    .filter((t) => {
      const deleted = Boolean((t as Trade & { isDeleted?: boolean }).isDeleted);
      if (filters.onlyDeleted) {
        if (!deleted) return false;
      } else if (!filters.includeDeleted && deleted) {
        return false;
      }
      if (accountFilter !== 'all' && t.accountId !== accountFilter) return false;
      if (instrumentFilter !== 'all' && t.instrument !== instrumentFilter) return false;
      if (dateFilter && t.date !== dateFilter) return false;
      if (monthFilter && !t.date.startsWith(monthFilter)) return false;
      if (resultFilter !== 'all' && t.exitOutcome !== resultFilter) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (sessionFilter === 'in_session' && t.isOutOfSession) return false;
      if (sessionFilter === 'out_of_session' && !t.isOutOfSession) return false;
      if (q) {
        const hay = `${t.date} ${t.instrument} ${t.direction} ${t.accountName} ${t.sessionName ?? ''} ${
          t.setupLabel ?? ''
        } ${t.entryReasoning ?? ''} ${t.actualOutcomeNotes ?? ''} ${t.lessonsLearned ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.tradeNumberOfDay - b.tradeNumberOfDay);
}

export interface TradeRowLinkMeta {
  isLinked: boolean;
  pairIndex: number;
  prevSameGroup: boolean;
  nextSameGroup: boolean;
  siblingAccounts: string[];
}

export function buildTradeGroupVisualMap(
  displayedTrades: Trade[],
  allTrades: Trade[],
  options?: { includeDeleted?: boolean; onlyDeleted?: boolean }
): Map<string, TradeRowLinkMeta> {
  const groupAccounts = new Map<string, string[]>();
  for (const t of allTrades) {
    if (!t.tradeGroupId) continue;
    const deleted = Boolean((t as Trade & { isDeleted?: boolean }).isDeleted);
    if (options?.onlyDeleted) {
      if (!deleted) continue;
    } else if (!options?.includeDeleted && deleted) {
      continue;
    }
    const list = groupAccounts.get(t.tradeGroupId) ?? [];
    list.push(t.accountName);
    groupAccounts.set(t.tradeGroupId, list);
  }

  const groupPairIndex = new Map<string, number>();
  let nextPairNum = 1;
  for (const t of displayedTrades) {
    if (!t.tradeGroupId) continue;
    const accounts = groupAccounts.get(t.tradeGroupId);
    if (accounts && accounts.length > 1 && !groupPairIndex.has(t.tradeGroupId)) {
      groupPairIndex.set(t.tradeGroupId, nextPairNum++);
    }
  }

  const result = new Map<string, TradeRowLinkMeta>();
  for (let i = 0; i < displayedTrades.length; i += 1) {
    const row = displayedTrades[i];
    const gid = row.tradeGroupId;
    const accounts = gid ? groupAccounts.get(gid) ?? [] : [];
    const isLinked = Boolean(gid && accounts.length > 1);
    const prevSameGroup = Boolean(isLinked && i > 0 && displayedTrades[i - 1].tradeGroupId === gid);
    const nextSameGroup = Boolean(
      isLinked && i < displayedTrades.length - 1 && displayedTrades[i + 1].tradeGroupId === gid
    );

    result.set(row.id, {
      isLinked,
      pairIndex: gid ? groupPairIndex.get(gid) ?? 0 : 0,
      prevSameGroup,
      nextSameGroup,
      siblingAccounts: accounts,
    });
  }
  return result;
}
