export interface AuthUser {
  uid: string;
  username: string;
  email: string;
  displayName: string;
  role: 'owner' | 'user';
  emailVerified: boolean;
}

export interface AuthStatusResponse {
  initialized: boolean;
  registrationOpen: boolean;
  user: AuthUser | null;
  csrfToken?: string | null;
}

export class ApiRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

type SyncListener = (collections: string[]) => void;
const localSyncListeners = new Set<SyncListener>();

export function onLocalWorkspaceSync(listener: SyncListener): () => void {
  localSyncListeners.add(listener);
  return () => {
    localSyncListeners.delete(listener);
  };
}

export function emitLocalWorkspaceSync(collections: string[]): void {
  for (const listener of localSyncListeners) {
    try {
      listener(collections);
    } catch {
      // Isolate listener exceptions
    }
  }
}

// In-memory session-bound CSRF token (never persisted to localStorage)
let activeCsrfToken: string | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  activeCsrfToken = token && token.trim() ? token.trim() : null;
}

export function getCsrfToken(): string | null {
  return activeCsrfToken;
}

export async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/csrf', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { csrfToken?: string | null };
    setCsrfToken(data.csrfToken ?? null);
    return activeCsrfToken;
  } catch {
    return null;
  }
}

const PRE_AUTH_WRITE_URLS = new Set([
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
]);

export async function apiRequest<T = unknown>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: BodyInit;
  } = {}
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  if (method !== 'GET') {
    headers['X-ATK-Client'] = '1';
    if (!PRE_AUTH_WRITE_URLS.has(url)) {
      if (!activeCsrfToken) {
        await fetchCsrfToken();
      }
      if (activeCsrfToken) {
        headers['X-CSRF-Token'] = activeCsrfToken;
      }
    }
  }

  let body: BodyInit | undefined = options.rawBody;
  if (options.body !== undefined && options.rawBody === undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiRequestError(
      err instanceof Error ? err.message : 'Network error connecting to ATK Deck server.',
      0,
      'network/unavailable'
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    if (response.status === 401) {
      setCsrfToken(null);
    }

    let errMsg = `Server error (${response.status})`;
    let errCode =
      response.status === 401
        ? 'auth/unauthenticated'
        : response.status === 403
        ? 'permission/denied'
        : response.status === 409
        ? 'conflict/state-mismatch'
        : response.status === 400
        ? 'validation/invalid-argument'
        : 'database/server-error';

    if (contentType.includes('application/json')) {
      try {
        const parsed = (await response.json()) as { error?: string; code?: string };
        if (parsed.error) errMsg = parsed.error;
        if (parsed.code) errCode = parsed.code;
      } catch {
        // Fallback to HTTP status message
      }
    } else {
      try {
        const txt = await response.text();
        if (txt) errMsg = txt.slice(0, 300);
      } catch {
        // ignore
      }
    }

    throw new ApiRequestError(errMsg, response.status, errCode);
  }

  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return undefined as T;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const status = await apiRequest<AuthStatusResponse>('/api/auth/status');
  setCsrfToken(status.user ? status.csrfToken ?? null : null);
  return status;
}

export async function setupAccountApi(input: {
  username: string;
  email: string;
  displayName: string;
  password: string;
}): Promise<{ user: AuthUser; csrfToken?: string }> {
  const res = await apiRequest<{ user: AuthUser; csrfToken?: string }>('/api/auth/setup', {
    method: 'POST',
    body: input,
  });
  setCsrfToken(res.csrfToken ?? null);
  return res;
}

export async function loginWithPasswordApi(input: {
  identifier: string;
  password: string;
}): Promise<{ user: AuthUser; csrfToken?: string }> {
  const res = await apiRequest<{ user: AuthUser; csrfToken?: string }>('/api/auth/login', {
    method: 'POST',
    body: input,
  });
  setCsrfToken(res.csrfToken ?? null);
  return res;
}

export async function logoutApi(): Promise<void> {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } finally {
    setCsrfToken(null);
  }
}

export async function changePasswordApi(input: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}): Promise<void> {
  await apiRequest('/api/auth/change-password', {
    method: 'POST',
    body: input,
  });
}

export async function logoutAllOtherSessionsApi(): Promise<void> {
  await apiRequest('/api/auth/logout-all', { method: 'POST' });
}

export async function fetchWorkspaceBootstrap(): Promise<{
  user: AuthUser;
  collections: Record<string, unknown[]>;
}> {
  return apiRequest('/api/workspace/bootstrap');
}

export async function downloadServerSnapshotZip(): Promise<Blob> {
  const res = await fetch('/api/backup/server-snapshot', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new ApiRequestError(
      `Failed downloading server snapshot (${res.status}).`,
      res.status,
      'database/snapshot-failed'
    );
  }
  return res.blob();
}
