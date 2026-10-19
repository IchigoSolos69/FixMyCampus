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
const sessionTimeout = 10000;
const requestTimeout = 60000;
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

async function withCookieLock<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request('fixmycampus-cookie-auth', { signal }, action);
  return action();
}
async function withDeadline<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeout: number,
  failureMessage: string,
  signal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await action(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal);
  } catch (error) {
    if (controller.signal.aborted || error instanceof TypeError)
      throw new RequestError(failureMessage, 0);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function connectionError(status: number) {
  return new RequestError(
    'The campus service desk is temporarily unavailable. Please try again shortly.',
    status,
  );
}
async function readCsrf(signal: AbortSignal) {
  const response = await fetch('/api/v1/auth/csrf', { credentials: 'include', signal });
  if (!response.ok) throw connectionError(response.status);
  csrfToken = (await response.json()).csrfToken;
}
export async function endSession() {
  await withCookieLock(async () => {
    await withDeadline(readCsrf, sessionTimeout, 'The connection timed out. Please try again.');
    await post('/auth/logout', {});
  });
}

export async function refreshSession(): Promise<AuthResponse> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = withDeadline(
    (signal) =>
      withCookieLock(async () => {
        await readCsrf(signal);
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': csrfToken },
          signal,
        });
        if (response.status >= 500) throw connectionError(response.status);
        if (!response.ok)
          throw new RequestError('Your session has ended. Sign in again.', response.status);
        const data: AuthResponse = await response.json();
        setToken(data.accessToken, data.csrfToken);
        return data;
      }, signal),
    sessionTimeout,
    'The connection timed out. You can sign in again.',
  ).finally(() => {
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
  const readOnly = !options.method || ['GET', 'HEAD'].includes(options.method.toUpperCase());
  const timeoutMessage = readOnly
    ? 'The campus service desk could not respond. Check your connection and try again shortly.'
    : path === '/auth/register'
      ? 'We could not confirm your account request. Check your inbox for a verification email before trying again.'
      : 'We could not confirm this request. Check whether your change was saved before trying again.';
  return withDeadline(
    async (signal) => {
      const response = await fetch(`/api/v1${path}`, {
        ...options,
        headers,
        credentials: 'include',
        signal,
      });
      if (response.status === 401 && accessToken && !path.startsWith('/auth/')) {
        if (!retried && refreshPromise && isActive()) {
          let renewed = false;
          try {
            await refreshPromise;
            renewed = true;
          } catch {
            /* The next request requires a fresh sign-in. */
          }
          if (renewed) {
            if (readOnly) return request<T>(path, options, true);
            throw new RequestError(
              'Your sign-in was refreshed. Please submit this request again.',
              401,
            );
          }
        }
        setToken('');
        onSessionLost();
      }
      if (!response.ok) {
        if ([502, 503, 504].includes(response.status)) throw connectionError(response.status);
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
      if (response.headers.get('Content-Type')?.includes('application/json'))
        return await response.json();
      return (await response.blob()) as T;
    },
    options.body instanceof FormData ? 120000 : requestTimeout,
    timeoutMessage,
    options.signal,
  );
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
