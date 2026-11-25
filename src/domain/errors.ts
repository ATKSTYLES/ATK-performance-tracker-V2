import { ErrorCategory } from './enums';
import { AppErrorDiagnostic } from './types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface AuthContextSnapshot {
  uid?: string | null;
  email?: string | null;
  emailVerified?: boolean | null;
  isAnonymous?: boolean | null;
  tenantId?: string | null;
  providerData?: Array<{ providerId?: string | null; email?: string | null }>;
}

export function extractFirebaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybe = error as { code?: unknown; message?: unknown };
    if (typeof maybe.code === 'string' && maybe.code.length > 0) {
      return maybe.code;
    }
    if (typeof maybe.message === 'string') {
      const match = maybe.message.match(
        /\((auth|firestore|storage|database|validation|permission|conflict|network)\/[a-z0-9-]+\)/i
      );
      if (match) return match[0].slice(1, -1);
    }
  }
  return 'unknown';
}

export function classifyErrorCategory(
  error: unknown,
  explicitCategory?: ErrorCategory
): ErrorCategory {
  if (explicitCategory) return explicitCategory;
  const code = extractFirebaseErrorCode(error).toLowerCase();
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (
    code.startsWith('permission/') ||
    code.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions') ||
    msg.includes('owner identity mismatch')
  ) {
    return 'permission';
  }
  if (
    code.startsWith('auth/') ||
    code.includes('unauthenticated') ||
    msg.includes('authentication required') ||
    msg.includes('email_verified')
  ) {
    return 'authentication';
  }
  if (
    code.startsWith('network/') ||
    code.includes('unavailable') ||
    code.includes('network') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('failed to fetch')
  ) {
    return 'network';
  }
  if (
    code.startsWith('conflict/') ||
    code.includes('aborted') ||
    code.includes('already-exists') ||
    code.includes('failed-precondition') ||
    msg.includes('already closed') ||
    msg.includes('inconsistent linked closure state') ||
    msg.includes('in trash')
  ) {
    return 'conflict';
  }
  if (
    code.startsWith('validation/') ||
    code.includes('invalid-argument') ||
    msg.includes('validation') ||
    msg.includes('finite number') ||
    msg.includes('non-finite') ||
    msg.includes('duplicate trade ids') ||
    msg.includes('different trade groups') ||
    msg.includes('exceeds safe atomic batch limit') ||
    msg.includes('invalid null')
  ) {
    return 'validation';
  }
  if (
    code.startsWith('database/') ||
    code.startsWith('firestore/') ||
    code.startsWith('storage/')
  ) {
    return 'database';
  }
  return 'application';
}

export function getRecommendedAction(category: ErrorCategory, code: string): string {
  switch (category) {
    case 'authentication':
      return 'Sign in again to refresh your ATK Deck session, then retry.';
    case 'permission':
      return `Server rejected this write (${code}). Inspect the failed record path and required fields in Diagnostics before retrying.`;
    case 'validation':
      return 'Review highlighted form fields and fix missing or out-of-range values before saving.';
    case 'network':
      return 'Check connectivity to your ATK Deck server. Your draft remains preserved locally and can be retried safely.';
    case 'conflict':
      return 'Reload the latest record state from the database and retry the operation.';
    case 'synchronisation':
      return 'Open Settings & Export -> Error History & Diagnostics to retry pending sync operations.';
    case 'database':
      return 'Confirm the local SQLite database is writable and healthy, then retry.';
    default:
      return 'Inspect the error details in Diagnostics and retry the action safely.';
  }
}

export function buildErrorDiagnostic(params: {
  operationId: string;
  module: string;
  operationType: string;
  recordId: string;
  documentPath: string;
  error: unknown;
  explicitCategory?: ErrorCategory;
  localSaveStatus?: AppErrorDiagnostic['localSaveStatus'];
  cloudSaveStatus?: AppErrorDiagnostic['cloudSaveStatus'];
  failedStage?: string;
  failedEventPath?: string;
}): AppErrorDiagnostic {
  const firebaseErrorCode = extractFirebaseErrorCode(params.error);
  const errorCategory = classifyErrorCategory(params.error, params.explicitCategory);
  const rawMessage = params.error instanceof Error ? params.error.message : String(params.error);

  return {
    operationId: params.operationId,
    module: params.module,
    operationType: params.operationType,
    recordId: params.recordId,
    documentPath: params.documentPath,
    timestamp: new Date().toISOString(),
    errorCategory,
    firebaseErrorCode,
    userMessage: rawMessage,
    localSaveStatus: params.localSaveStatus ?? 'preserved_in_form',
    cloudSaveStatus: params.cloudSaveStatus ?? 'failed',
    retrySafe:
      errorCategory !== 'permission' &&
      errorCategory !== 'validation' &&
      errorCategory !== 'conflict',
    recommendedAction: getRecommendedAction(errorCategory, firebaseErrorCode),
    failedStage: params.failedStage,
    failedEventPath: params.failedEventPath,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  currentUser?: AuthContextSnapshot | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId ?? null,
          email: provider.email ?? null,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Database Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
