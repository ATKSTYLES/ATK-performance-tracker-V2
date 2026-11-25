import { resolveNetPnl } from '../domain/calculations';
import { SCHEMA_VERSION } from '../domain/enums';
import { buildErrorDiagnostic } from '../domain/errors';
import {
  AttachmentMeta,
  AuditLogEntry,
  ChecklistConfig,
  DailyJournal,
  InstrumentConfig,
  PendingOperation,
  SessionEvent,
  SessionTemplate,
  Trade,
  TradeEvent,
  TradeGroup,
  TradingAccount,
  TradingReview,
  TradingSession,
  UserProfilePreferences,
} from '../domain/types';
import {
  generateRecordId,
  sanitizeFirestorePayload,
  sanitizeQueuePayload,
  stripUndefinedFields,
  validateTradeClosure,
  validateTradeCreation,
} from '../domain/validation';
import {
  apiRequest,
  emitLocalWorkspaceSync,
  onLocalWorkspaceSync,
} from './apiClient';
import {
  appendErrorDiagnostic,
  markOperationSynced,
  recordPendingAttempt,
} from './syncQueue';

export const FIRESTORE_BATCH_WRITE_LIMIT = 500;
export const MAX_LINKED_EXECUTIONS_PER_BATCH = 25;

export function buildClosureEventId(operationId: string, index?: number): string {
  const base = operationId.startsWith('close_') ? `te_${operationId}` : `te_close_${operationId}`;
  return index === undefined ? base : `${base}_${index}`;
}

async function logAuditDiagnostic(
  uid: string,
  diag: ReturnType<typeof buildErrorDiagnostic>
): Promise<void> {
  appendErrorDiagnostic(uid, diag);
  if (
    diag.errorCategory === 'permission' ||
    diag.errorCategory === 'authentication' ||
    diag.errorCategory === 'network' ||
    diag.documentPath.includes('audit_logs')
  ) {
    return;
  }
  try {
    const id = generateRecordId('aud');
    await apiRequest(`/api/records/audit_logs/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: {
        data: {
          operationId: diag.operationId,
          module: diag.module,
          operationType: diag.operationType,
          recordId: diag.recordId.slice(0, 128),
          documentPath: diag.documentPath.slice(0, 256),
          errorCategory: diag.errorCategory,
          errorCode: diag.firebaseErrorCode.slice(0, 128),
          message: diag.userMessage.slice(0, 1000),
        },
      },
    });
  } catch {
    // Best-effort server audit log; local diagnostic is already saved.
  }
}

function sanitizeJsonPayload(payload: unknown): unknown {
  return sanitizeQueuePayload(payload);
}

function shouldQueueFailedOperation(
  diag: ReturnType<typeof buildErrorDiagnostic>,
  failedStage?: string
): boolean {
  if (diag.errorCategory === 'validation' || diag.errorCategory === 'conflict') {
    return false;
  }
  if (
    failedStage === 'verify_owner_and_idempotency' ||
    failedStage === 'validate_closure_contract' ||
    failedStage === 'validate_linked_batch_contract'
  ) {
    return false;
  }
  return true;
}

function recordPendingFailure(
  uid: string,
  operationId: string,
  recordId: string,
  operationType: string,
  payload: unknown,
  diag: ReturnType<typeof buildErrorDiagnostic>
): void {
  if (!shouldQueueFailedOperation(diag, diag.failedStage)) {
    return;
  }
  let safePayload: unknown;
  try {
    safePayload = sanitizeJsonPayload(payload);
  } catch {
    return;
  }
  recordPendingAttempt({
    operationId,
    userId: uid,
    recordId,
    operationType,
    payloadVersion: SCHEMA_VERSION,
    payload: safePayload,
    attempt: {
      timestamp: diag.timestamp,
      errorCode: diag.firebaseErrorCode,
      errorMessage: diag.userMessage,
    },
    lastError: diag,
    status:
      diag.errorCategory === 'permission' || diag.errorCategory === 'validation'
        ? 'Requires Attention'
        : 'Failed',
  });
}

export function subscribeUserCollection<T extends { createdAt: string; updatedAt: string }>(
  uid: string,
  subcollection: string,
  onData: (items: T[]) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const load = async () => {
    try {
      const items = await listUserCollection<T>(uid, subcollection);
      if (active) onData(items);
    } catch (error) {
      if (active && onError && error instanceof Error) {
        onError(error);
      }
    }
  };

  void load();
  const unsub = onLocalWorkspaceSync((collections) => {
    if (collections.includes('*') || collections.includes(subcollection)) {
      void load();
    }
  });

  return () => {
    active = false;
    unsub();
  };
}

export async function listUserCollection<T extends { createdAt: string; updatedAt: string }>(
  _uid: string,
  subcollection: string
): Promise<T[]> {
  const res = await apiRequest<{ items: T[] }>(
    `/api/records/${encodeURIComponent(subcollection)}`
  );
  return res.items ?? [];
}

export async function seedInitialWorkspaceIfEmpty(
  _uid: string,
  _displayName: string
): Promise<void> {
  // Initial workspace seeding happens automatically on the server during owner setup & bootstrap
  await apiRequest('/api/workspace/bootstrap');
}

export async function createRecord<T extends Record<string, unknown>>(
  uid: string,
  subcollection: string,
  id: string,
  data: Omit<T, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>,
  moduleName: string,
  operationId: string = generateRecordId('op')
): Promise<void> {
  const path = `users/${uid}/${subcollection}/${id}`;
  const clean = stripUndefinedFields(data);

  try {
    await apiRequest(`/api/records/${encodeURIComponent(subcollection)}/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: { data: clean },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync([subcollection]);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: moduleName,
      operationType: 'create',
      recordId: id,
      documentPath: path,
      error,
      failedStage: 'api_create',
    });
    recordPendingFailure(uid, operationId, id, `create_${subcollection}`, clean, diag);
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function updateRecord(
  uid: string,
  subcollection: string,
  id: string,
  patch: Record<string, unknown>,
  moduleName: string,
  operationId: string = generateRecordId('op')
): Promise<void> {
  const path = `users/${uid}/${subcollection}/${id}`;
  const clean = stripUndefinedFields(patch);

  try {
    await apiRequest(`/api/records/${encodeURIComponent(subcollection)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { patch: clean },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync([subcollection]);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: moduleName,
      operationType: 'update',
      recordId: id,
      documentPath: path,
      error,
      failedStage: 'api_update',
    });
    recordPendingFailure(uid, operationId, id, `update_${subcollection}`, clean, diag);
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function deleteRecord(
  uid: string,
  subcollection: string,
  id: string,
  moduleName: string
): Promise<void> {
  const path = `users/${uid}/${subcollection}/${id}`;
  const operationId = generateRecordId('op');
  try {
    await apiRequest(`/api/records/${encodeURIComponent(subcollection)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    emitLocalWorkspaceSync([subcollection]);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: moduleName,
      operationType: 'delete',
      recordId: id,
      documentPath: path,
      error,
      failedStage: 'api_delete',
    });
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function deleteSessionCascade(
  uid: string,
  session: TradingSession,
  _allSessionEvents: SessionEvent[],
  _allAttachments: AttachmentMeta[]
): Promise<void> {
  const path = `users/${uid}/sessions/${session.id}`;
  const operationId = generateRecordId('ses_del');

  try {
    await apiRequest(`/api/sessions/${encodeURIComponent(session.id)}/cascade`, {
      method: 'DELETE',
    });
    emitLocalWorkspaceSync(['sessions', 'session_events', 'attachments']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'SessionRecords',
      operationType: 'delete_session_cascade',
      recordId: session.id,
      documentPath: path,
      error,
      failedStage: 'session_cascade_delete',
    });
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function updateTradeDetails(
  uid: string,
  tradeId: string,
  patch: Record<string, unknown>,
  clearFields: string[] = [],
  operationId: string = generateRecordId('tr_edit')
): Promise<void> {
  const path = `users/${uid}/trades/${tradeId}`;
  const cleanPatch = sanitizeFirestorePayload(patch, { rejectNonFinite: true, stripNulls: true });

  try {
    await apiRequest(`/api/trades/${encodeURIComponent(tradeId)}/details`, {
      method: 'PATCH',
      body: { patch: cleanPatch, clearFields },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['trades']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'TradeInspector',
      operationType: 'update_trade_details',
      recordId: tradeId,
      documentPath: path,
      error,
      failedStage: 'trade_full_update',
    });
    recordPendingFailure(
      uid,
      operationId,
      tradeId,
      'update_trade_details',
      { patch: cleanPatch, clearFields },
      diag
    );
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function softDeleteTrade(
  uid: string,
  trade: Trade,
  operationId: string = generateRecordId('tr_soft_del')
): Promise<void> {
  const path = `users/${uid}/trades/${trade.id}`;
  try {
    await apiRequest(`/api/trades/${encodeURIComponent(trade.id)}/soft-delete`, {
      method: 'POST',
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['trades']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'TradeLedger',
      operationType: 'soft_delete_trade',
      recordId: trade.id,
      documentPath: path,
      error,
      failedStage: 'trade_soft_delete',
    });
    recordPendingFailure(uid, operationId, trade.id, 'soft_delete_trade', { trade }, diag);
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function softDeleteTradeGroup(
  uid: string,
  tradesInGroup: Trade[],
  operationId: string = generateRecordId('tg_soft_del')
): Promise<void> {
  if (tradesInGroup.length === 0) return;
  const firstId = tradesInGroup[0].id;
  const path = `users/${uid}/trades/${firstId}`;

  try {
    await apiRequest('/api/trade-groups/soft-delete', {
      method: 'POST',
      body: { tradeIds: tradesInGroup.map((t) => t.id) },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['trades']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'TradeLedger',
      operationType: 'soft_delete_trade_group',
      recordId: firstId,
      documentPath: path,
      error,
      failedStage: 'trade_group_soft_delete',
    });
    recordPendingFailure(
      uid,
      operationId,
      firstId,
      'soft_delete_trade_group',
      { tradesInGroup },
      diag
    );
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function restoreTrade(
  uid: string,
  trade: Trade,
  operationId: string = generateRecordId('tr_restore')
): Promise<void> {
  const path = `users/${uid}/trades/${trade.id}`;
  try {
    await apiRequest(`/api/trades/${encodeURIComponent(trade.id)}/restore`, {
      method: 'POST',
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['trades']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'TradeLedger',
      operationType: 'restore_trade',
      recordId: trade.id,
      documentPath: path,
      error,
      failedStage: 'trade_restore',
    });
    recordPendingFailure(uid, operationId, trade.id, 'restore_trade', { trade }, diag);
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function restoreTradeGroup(
  uid: string,
  tradesInGroup: Trade[],
  operationId: string = generateRecordId('tg_restore')
): Promise<void> {
  if (tradesInGroup.length === 0) return;
  const firstId = tradesInGroup[0].id;
  const path = `users/${uid}/trades/${firstId}`;

  try {
    await apiRequest('/api/trade-groups/restore', {
      method: 'POST',
      body: { tradeIds: tradesInGroup.map((t) => t.id) },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['trades']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'TradeLedger',
      operationType: 'restore_trade_group',
      recordId: firstId,
      documentPath: path,
      error,
      failedStage: 'trade_group_restore',
    });
    recordPendingFailure(
      uid,
      operationId,
      firstId,
      'restore_trade_group',
      { tradesInGroup },
      diag
    );
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function deleteTradeCascade(
  uid: string,
  trade: Trade,
  _tradeEvents: TradeEvent[],
  _tradeGroups: TradeGroup[],
  _allAttachments: AttachmentMeta[]
): Promise<void> {
  const path = `users/${uid}/trades/${trade.id}`;
  const operationId = generateRecordId('tr_del');

  try {
    await apiRequest(`/api/trades/${encodeURIComponent(trade.id)}/cascade`, {
      method: 'DELETE',
    });
    emitLocalWorkspaceSync(['trades', 'trade_events', 'trade_groups', 'attachments']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'TradeInspector',
      operationType: 'delete_trade_cascade',
      recordId: trade.id,
      documentPath: path,
      error,
      failedStage: 'trade_delete_cascade',
    });
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function upsertDailyJournal(
  uid: string,
  date: string,
  data: Omit<DailyJournal, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>,
  operationId: string = generateRecordId('dj')
): Promise<void> {
  const path = `users/${uid}/daily_journals/${date}`;
  try {
    await apiRequest(`/api/daily-journals/${encodeURIComponent(date)}`, {
      method: 'PUT',
      body: { data: stripUndefinedFields(data) },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['daily_journals']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'DailyJournal',
      operationType: 'upsert',
      recordId: date,
      documentPath: path,
      error,
      failedStage: 'daily_journal_upsert',
    });
    recordPendingFailure(uid, operationId, date, 'upsert_daily_journal', data, diag);
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function startSessionAtomically(
  uid: string,
  sessionInput: Omit<TradingSession, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>,
  sessionId: string,
  operationId: string = generateRecordId('ses_start')
): Promise<void> {
  const path = `users/${uid}/sessions/${sessionId}`;
  const eventId = `se_${sessionId}_start`;

  try {
    await apiRequest('/api/sessions/start', {
      method: 'POST',
      body: {
        sessionId,
        sessionInput: stripUndefinedFields(sessionInput),
      },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['sessions', 'session_events']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'SessionLogger',
      operationType: 'start_session',
      recordId: sessionId,
      documentPath: path,
      error,
      failedStage: 'session_start_batch',
      failedEventPath: `users/${uid}/session_events/${eventId}`,
    });
    recordPendingFailure(
      uid,
      operationId,
      sessionId,
      'start_session',
      { sessionInput: stripUndefinedFields(sessionInput) },
      diag
    );
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function endSessionAtomically(
  uid: string,
  sessionId: string,
  date: string,
  closing: {
    actualEndTime: string;
    setupAvailability: TradingSession['setupAvailability'];
    planAdherence: TradingSession['planAdherence'];
    postSessionEmotion: string;
    closingReflection: string;
  },
  operationId: string = generateRecordId('ses_end')
): Promise<void> {
  const path = `users/${uid}/sessions/${sessionId}`;
  const eventId = `se_${sessionId}_end`;

  try {
    await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
      body: { date, closing },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['sessions', 'session_events']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'SessionLogger',
      operationType: 'end_session',
      recordId: sessionId,
      documentPath: path,
      error,
      failedStage: 'session_end_batch',
      failedEventPath: `users/${uid}/session_events/${eventId}`,
    });
    recordPendingFailure(uid, operationId, sessionId, 'end_session', { date, closing }, diag);
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function createTradesForAccountsAtomically(
  uid: string,
  tradeInputs: Array<{
    tradeId: string;
    data: Omit<Trade, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>;
  }>,
  tradeGroup?: Omit<TradeGroup, 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>,
  operationId: string = generateRecordId('tr_open')
): Promise<void> {
  try {
    if (tradeInputs.length === 0) return;

    const uniqueIds = new Set(tradeInputs.map((i) => i.tradeId));
    if (uniqueIds.size !== tradeInputs.length) {
      throw new Error('Duplicate trade IDs found in trade creation batch.');
    }

    const sanitizedInputs = tradeInputs.map((item) => {
      const cleanData = sanitizeFirestorePayload(
        item.data as unknown as Record<string, unknown>,
        {
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
        }
      ) as Omit<Trade, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>;

      const creationCheck = validateTradeCreation({
        accountId: cleanData.accountId,
        instrument: cleanData.instrument,
        direction: cleanData.direction,
        riskPercent: cleanData.riskPercent,
        expectedProfitPercent: cleanData.expectedProfitPercent,
        preTradeEmotion: cleanData.preTradeEmotion,
        confidence: cleanData.confidence,
        isOutOfSession: cleanData.isOutOfSession,
        sessionId: cleanData.sessionId,
      });
      if (!creationCheck.valid) {
        throw new Error(
          `Trade creation validation failed (${item.tradeId}): ${creationCheck.errors.join(' ')}`
        );
      }

      return { tradeId: item.tradeId, data: cleanData };
    });

    await apiRequest('/api/trades/open-batch', {
      method: 'POST',
      body: {
        tradeInputs: sanitizedInputs,
        tradeGroup: tradeGroup ? stripUndefinedFields(tradeGroup as Record<string, unknown>) : undefined,
      },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['trades', 'trade_events', ...(tradeGroup ? ['trade_groups'] : [])]);
  } catch (error) {
    const firstId = tradeInputs[0]?.tradeId ?? 'unknown';
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'LiveTradeLogger',
      operationType: 'create_trade',
      recordId: firstId,
      documentPath: `users/${uid}/trades/${firstId}`,
      error,
      failedStage: 'trade_create_batch',
    });
    recordPendingFailure(
      uid,
      operationId,
      firstId,
      'create_trade',
      { tradeInputs, tradeGroup },
      diag
    );
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export interface CloseTradePayload {
  exitOutcome: Trade['exitOutcome'];
  exitReason: Trade['exitReason'];
  tpStatus: Trade['tpStatus'];
  slStatus: Trade['slStatus'];
  actualProfitPercent: number;
  actualOutcomeNotes?: string;
  entryPrice?: number;
  exitPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  positionSize?: number;
  grossPnl?: number;
  commission?: number;
  otherCharges?: number;
  netPnl?: number;
  realisedR?: number;
  followedPlan: Trade['followedPlan'];
  followedRiskRules: Trade['followedRiskRules'];
  impulsiveEntry: Trade['impulsiveEntry'];
  exitedPerPlan: Trade['exitedPerPlan'];
  postTradeEmotion: string;
  mistakes: string[];
  lessonsLearned?: string;
}

function validateAndCleanClosePayload(closing: CloseTradePayload): CloseTradePayload {
  const check = validateTradeClosure({
    exitOutcome: closing.exitOutcome,
    exitReason: closing.exitReason,
    tpStatus: closing.tpStatus,
    slStatus: closing.slStatus,
    actualProfitPercent: closing.actualProfitPercent,
    actualOutcomeNotes: closing.actualOutcomeNotes,
    followedPlan: closing.followedPlan,
    followedRiskRules: closing.followedRiskRules,
    impulsiveEntry: closing.impulsiveEntry,
    exitedPerPlan: closing.exitedPerPlan,
    postTradeEmotion: closing.postTradeEmotion,
    lessonsLearned: closing.lessonsLearned,
    mistakes: closing.mistakes,
  });
  if (!check.valid) {
    throw new Error(`Closure validation failed: ${check.errors.join(' ')}`);
  }

  const reconciledNetPnl =
    closing.netPnl !== undefined
      ? closing.netPnl
      : resolveNetPnl(closing.grossPnl, closing.commission, closing.otherCharges, undefined);

  return sanitizeFirestorePayload(
    {
      ...closing,
      netPnl: reconciledNetPnl,
      postTradeEmotion: closing.postTradeEmotion.trim(),
      actualOutcomeNotes: closing.actualOutcomeNotes?.trim(),
      lessonsLearned: closing.lessonsLearned?.trim(),
    },
    {
      rejectNonFinite: true,
      stripNulls: true,
      stripEmptyStringKeys: ['actualOutcomeNotes', 'lessonsLearned'],
    }
  ) as unknown as CloseTradePayload;
}

export async function closeTradeAtomically(
  uid: string,
  tradeId: string,
  closing: CloseTradePayload,
  operationId: string
): Promise<void> {
  const tradePath = `users/${uid}/trades/${tradeId}`;
  const eventId = buildClosureEventId(operationId);
  const eventPath = `users/${uid}/trade_events/${eventId}`;
  let currentStage = 'validate_closure_contract';

  try {
    const cleanClosing = validateAndCleanClosePayload(closing);
    currentStage = 'atomic_batch_commit';

    await apiRequest('/api/trades/close-batch', {
      method: 'POST',
      body: {
        operationId,
        entries: [{ tradeId, closing: cleanClosing }],
      },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['trades', 'trade_events']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'TradeClosure',
      operationType: 'close_trade_atomic',
      recordId: tradeId,
      documentPath: tradePath,
      error,
      failedStage: currentStage,
      failedEventPath: eventPath,
      localSaveStatus: 'preserved_in_form',
      cloudSaveStatus: 'failed',
    });
    recordPendingFailure(uid, operationId, tradeId, 'close_trade_atomic', closing, diag);
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function closeLinkedTradesAtomically(
  uid: string,
  entries: Array<{ tradeId: string; closing: CloseTradePayload }>,
  operationId: string
): Promise<void> {
  if (entries.length === 0) return;
  if (entries.length === 1) {
    await closeTradeAtomically(uid, entries[0].tradeId, entries[0].closing, operationId);
    return;
  }

  const firstTradeId = entries[0].tradeId;
  const firstTradePath = `users/${uid}/trades/${firstTradeId}`;
  const eventPaths = entries
    .map((_, i) => `users/${uid}/trade_events/${buildClosureEventId(operationId, i)}`)
    .join(', ');
  let currentStage = 'validate_linked_batch_contract';

  try {
    const uniqueTradeIds = new Set(entries.map((e) => e.tradeId));
    if (uniqueTradeIds.size !== entries.length) {
      throw new Error('Duplicate trade IDs found in linked trade closure batch.');
    }

    const cleanedEntries = entries.map((e) => ({
      tradeId: e.tradeId,
      closing: validateAndCleanClosePayload(e.closing),
    }));

    currentStage = 'atomic_linked_batch_commit';
    await apiRequest('/api/trades/close-batch', {
      method: 'POST',
      body: {
        operationId,
        entries: cleanedEntries,
      },
    });
    markOperationSynced(uid, operationId);
    emitLocalWorkspaceSync(['trades', 'trade_events']);
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'TradeClosure',
      operationType: 'close_trade_group_atomic',
      recordId: firstTradeId,
      documentPath: firstTradePath,
      error,
      failedStage: currentStage,
      failedEventPath: eventPaths,
      localSaveStatus: 'preserved_in_form',
      cloudSaveStatus: 'failed',
    });
    recordPendingFailure(
      uid,
      operationId,
      firstTradeId,
      'close_trade_group_atomic',
      { entries },
      diag
    );
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

export async function uploadAttachment(
  uid: string,
  relatedType: 'trade' | 'session',
  relatedId: string,
  category: AttachmentMeta['category'],
  file: File
): Promise<AttachmentMeta> {
  const operationId = generateRecordId('att_up');
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('relatedType', relatedType);
    form.append('relatedId', relatedId);
    form.append('category', category);

    const res = await apiRequest<{ attachment: AttachmentMeta }>('/api/attachments/upload', {
      method: 'POST',
      rawBody: form,
    });
    emitLocalWorkspaceSync(['attachments']);
    return res.attachment;
  } catch (error) {
    const diag = buildErrorDiagnostic({
      operationId,
      module: 'Attachments',
      operationType: 'upload_attachment',
      recordId: relatedId,
      documentPath: `users/${uid}/attachments/${relatedId}`,
      error,
      failedStage: 'storage_upload',
    });
    await logAuditDiagnostic(uid, diag);
    throw diag;
  }
}

export async function getAttachmentDownloadUrl(storagePath: string): Promise<string> {
  return `/api/attachments/by-path?path=${encodeURIComponent(storagePath)}`;
}

export async function downloadAttachmentBytes(storagePath: string): Promise<Uint8Array> {
  const res = await fetch(`/api/attachments/by-path?path=${encodeURIComponent(storagePath)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed downloading attachment (${res.status}).`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function uploadRawAttachmentBytes(
  storagePath: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await apiRequest('/api/attachments/raw', {
    method: 'POST',
    headers: {
      'Content-Type': contentType || 'image/png',
      'X-Storage-Path': storagePath,
    },
    rawBody: new Blob([copy.buffer], { type: contentType || 'image/png' }),
  });
}

export async function deleteAttachmentIfUnreferenced(
  _uid: string,
  attachment: AttachmentMeta,
  _allAttachments: AttachmentMeta[]
): Promise<void> {
  await apiRequest(`/api/attachments/${encodeURIComponent(attachment.id)}`, {
    method: 'DELETE',
  });
  emitLocalWorkspaceSync(['attachments']);
}

export async function retryPendingOperation(
  uid: string,
  op: PendingOperation
): Promise<void> {
  if (!uid || op.userId !== uid) {
    throw new Error('User identity mismatch on pending operation retry.');
  }
  const cleanPayload = sanitizeJsonPayload(op.payload) as Record<string, unknown>;

  if (op.operationType === 'close_trade_atomic') {
    await closeTradeAtomically(
      uid,
      op.recordId,
      cleanPayload as unknown as CloseTradePayload,
      op.operationId
    );
    return;
  }

  if (op.operationType === 'close_trade_group_atomic') {
    const { entries } = cleanPayload as {
      entries: Array<{ tradeId: string; closing: CloseTradePayload }>;
    };
    await closeLinkedTradesAtomically(uid, entries, op.operationId);
    return;
  }

  if (op.operationType === 'upsert_daily_journal') {
    await upsertDailyJournal(
      uid,
      op.recordId,
      cleanPayload as Omit<DailyJournal, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>,
      op.operationId
    );
    return;
  }

  if (op.operationType === 'start_session') {
    const { sessionInput } = cleanPayload as {
      sessionInput: Omit<TradingSession, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>;
    };
    await startSessionAtomically(uid, sessionInput, op.recordId, op.operationId);
    return;
  }

  if (op.operationType === 'end_session') {
    const { date, closing } = cleanPayload as {
      date: string;
      closing: {
        actualEndTime: string;
        setupAvailability: TradingSession['setupAvailability'];
        planAdherence: TradingSession['planAdherence'];
        postSessionEmotion: string;
        closingReflection: string;
      };
    };
    await endSessionAtomically(uid, op.recordId, date, closing, op.operationId);
    return;
  }

  if (op.operationType === 'create_trade') {
    const { tradeInputs, tradeGroup } = cleanPayload as {
      tradeInputs: Array<{
        tradeId: string;
        data: Omit<Trade, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>;
      }>;
      tradeGroup?: Omit<TradeGroup, 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>;
    };
    await createTradesForAccountsAtomically(uid, tradeInputs, tradeGroup, op.operationId);
    return;
  }

  if (op.operationType.startsWith('create_')) {
    const subcollection = op.operationType.slice('create_'.length);
    const body = { ...cleanPayload };
    delete body.id;
    delete body.userId;
    delete body.schemaVersion;
    await createRecord(uid, subcollection, op.recordId, body, 'SyncRetry', op.operationId);
    return;
  }

  if (op.operationType === 'soft_delete_trade') {
    const { trade } = cleanPayload as { trade: Trade };
    await softDeleteTrade(uid, trade ?? ({ id: op.recordId } as Trade), op.operationId);
    return;
  }

  if (op.operationType === 'soft_delete_trade_group') {
    const { tradesInGroup } = cleanPayload as { tradesInGroup: Trade[] };
    await softDeleteTradeGroup(uid, tradesInGroup ?? [], op.operationId);
    return;
  }

  if (op.operationType === 'restore_trade') {
    const { trade } = cleanPayload as { trade: Trade };
    await restoreTrade(uid, trade ?? ({ id: op.recordId } as Trade), op.operationId);
    return;
  }

  if (op.operationType === 'restore_trade_group') {
    const { tradesInGroup } = cleanPayload as { tradesInGroup: Trade[] };
    await restoreTradeGroup(uid, tradesInGroup ?? [], op.operationId);
    return;
  }

  if (op.operationType === 'update_trade_details') {
    const { patch, clearFields } = cleanPayload as {
      patch: Record<string, unknown>;
      clearFields?: string[];
    };
    await updateTradeDetails(uid, op.recordId, patch ?? {}, clearFields ?? [], op.operationId);
    return;
  }

  if (op.operationType.startsWith('update_')) {
    const subcollection = op.operationType.slice('update_'.length);
    await updateRecord(uid, subcollection, op.recordId, cleanPayload, 'SyncRetry', op.operationId);
    return;
  }

  throw new Error(`Unsupported pending operation type: ${op.operationType}`);
}

export type CollectionEntityMap = {
  accounts: TradingAccount;
  daily_journals: DailyJournal;
  sessions: TradingSession;
  session_events: SessionEvent;
  trades: Trade;
  trade_events: TradeEvent;
  trade_groups: TradeGroup;
  attachments: AttachmentMeta;
  session_templates: SessionTemplate;
  checklists: ChecklistConfig;
  instruments: InstrumentConfig;
  preferences: UserProfilePreferences;
  reviews: TradingReview;
  audit_logs: AuditLogEntry;
};
