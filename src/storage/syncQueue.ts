import { AppErrorDiagnostic, PendingOperation } from '../domain/types';

const QUEUE_KEY_PREFIX = 'atk_deck_v2_sync_queue_';
const ERROR_KEY_PREFIX = 'atk_deck_v2_error_history_';
const MAX_ERROR_HISTORY = 100;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function getPendingOperations(userId: string): PendingOperation[] {
  if (!userId) return [];
  return readJson<PendingOperation[]>(`${QUEUE_KEY_PREFIX}${userId}`, []);
}

export function upsertPendingOperation(op: PendingOperation): PendingOperation[] {
  const list = getPendingOperations(op.userId);
  const idx = list.findIndex((item) => item.operationId === op.operationId);
  const next = [...list];
  if (idx >= 0) {
    next[idx] = op;
  } else {
    next.unshift(op);
  }
  const trimmed = next.slice(0, 100);
  writeJson(`${QUEUE_KEY_PREFIX}${op.userId}`, trimmed);
  return trimmed;
}

export function recordPendingAttempt(
  input: Omit<PendingOperation, 'retryCount' | 'attemptHistory' | 'createdAt' | 'updatedAt'> & {
    attempt: { timestamp: string; errorCode: string; errorMessage: string };
  }
): PendingOperation[] {
  const list = getPendingOperations(input.userId);
  const existing = list.find((item) => item.operationId === input.operationId);
  const { attempt, ...rest } = input;
  const op: PendingOperation = existing
    ? {
        ...existing,
        ...rest,
        retryCount: existing.retryCount + 1,
        attemptHistory: [...existing.attemptHistory, attempt].slice(-20),
        createdAt: existing.createdAt,
        updatedAt: attempt.timestamp,
      }
    : {
        ...rest,
        retryCount: 1,
        attemptHistory: [attempt],
        createdAt: attempt.timestamp,
        updatedAt: attempt.timestamp,
      };
  return upsertPendingOperation(op);
}

export function markOperationSynced(userId: string, operationId: string): PendingOperation[] {
  const list = getPendingOperations(userId);
  const next = list.map((item) =>
    item.operationId === operationId
      ? { ...item, status: 'Synced' as const, updatedAt: new Date().toISOString() }
      : item
  );
  writeJson(`${QUEUE_KEY_PREFIX}${userId}`, next);
  return next;
}

export function removePendingOperation(userId: string, operationId: string): PendingOperation[] {
  const list = getPendingOperations(userId).filter((op) => op.operationId !== operationId);
  writeJson(`${QUEUE_KEY_PREFIX}${userId}`, list);
  return list;
}

export function getErrorHistory(userId: string): AppErrorDiagnostic[] {
  if (!userId) return [];
  return readJson<AppErrorDiagnostic[]>(`${ERROR_KEY_PREFIX}${userId}`, []);
}

export function appendErrorDiagnostic(userId: string, diag: AppErrorDiagnostic): AppErrorDiagnostic[] {
  const list = getErrorHistory(userId);
  const next = [diag, ...list].slice(0, MAX_ERROR_HISTORY);
  writeJson(`${ERROR_KEY_PREFIX}${userId}`, next);
  return next;
}

export function clearErrorHistory(userId: string): void {
  writeJson(`${ERROR_KEY_PREFIX}${userId}`, []);
}
