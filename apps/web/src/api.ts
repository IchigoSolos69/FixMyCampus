import type { ApiError, AuthResponse } from '@fixmycampus/shared';

export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
let accessToken = '';
let csrfToken = '';
let onSessionLost = () => {};
let refreshPromise: Promise<AuthResponse> | null = null;
let lastActivity = Date.now();
export function configureSession(onLost: () => void) {
  onSessionLost = onLost;
}
export function setToken(token: string, csrf?: string) {
  accessToken = token;
  if (csrf) csrfToken = csrf;
}
export function recordActivity() {
  lastActivity = Date.now();
}
export function isActive() {
  return Date.now() - lastActivity < 60 * 60 * 1000;
}

async function withCookieLock<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request('fixmycampus-cookie-auth', action);
  return action();
}
async function readCsrf() {
  const response = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
  if (!response.ok)
    throw new RequestError('Could not connect to the campus service desk.', response.status);
  csrfToken = (await response.json()).csrfToken;
}
export async function endSession() {
  await withCookieLock(async () => {
    await readCsrf();
    await post('/auth/logout', {});
  });
}

export async function refreshSession(): Promise<AuthResponse> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = withCookieLock(async () => {
    await readCsrf();
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrfToken },
    });
    if (!response.ok)
      throw new RequestError('Your session has ended. Sign in again.', response.status);
    const data: AuthResponse = await response.json();
    setToken(data.accessToken, data.csrfToken);
    return data;
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'include' });
  if (response.status === 401 && accessToken && !path.startsWith('/auth/')) {
    if (!retried && refreshPromise && isActive()) {
      try {
        await refreshPromise;
        return request<T>(path, options, true);
      } catch {
        /* The next request requires a fresh sign-in. */
      }
    }
    setToken('');
    onSessionLost();
  }
  if (!response.ok) {
    const data: ApiError = await response
      .json()
      .catch(() => ({ error: { message: 'The server could not complete this request.' } }));
    throw new RequestError(
      data.error?.message || 'The request failed.',
      response.status,
      data.error?.fields,
    );
  }
  if (response.status === 204) return undefined as T;
  if (response.headers.get('Content-Type')?.includes('application/json')) return response.json();
  return (await response.blob()) as T;
}
export function post<T>(path: string, data: unknown) {
  return request<T>(path, { method: 'POST', body: JSON.stringify(data) });
}
export function patch<T>(path: string, data: unknown) {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
}
export async function download(path: string, name: string) {
  const blob = await request<Blob>(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function params(values: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  return search.toString();
}
export const pollOptions = {
  refetchInterval: 5000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const;
