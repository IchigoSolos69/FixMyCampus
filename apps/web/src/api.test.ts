import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureSession, endSession, params, refreshSession, request, setToken } from './api';

afterEach(() => {
  setToken('');
  configureSession(() => {});
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('browser API boundaries', () => {
  it('never renews an idle session from a background API poll', async () => {
    const lost = vi.fn();
    configureSession(lost);
    setToken('expired-access');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(request('/notifications')).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/notifications');
    expect(lost).toHaveBeenCalledOnce();
  });
  it('fetches the current CSRF token before each explicit session refresh', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async (path: string) =>
          new Response(
            JSON.stringify(
              path.endsWith('/csrf')
                ? { csrfToken: 'fresh-csrf' }
                : { user: { id: 1 }, accessToken: 'active-token', csrfToken: 'rotated-csrf' },
            ),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      );
    vi.stubGlobal('fetch', fetch);
    await refreshSession();
    await refreshSession();
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
    ]);
    expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('fresh-csrf');
  });
  it('fetches a new CSRF token before logout and passes the cookie credentials', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async (path: string) =>
          new Response(
            JSON.stringify(
              path.endsWith('/csrf') ? { csrfToken: 'logout-csrf' } : { message: 'Signed out' },
            ),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      );
    vi.stubGlobal('fetch', fetch);
    await endSession();
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/auth/logout');
    const options = fetch.mock.calls[1][1];
    expect(options.credentials).toBe('include');
    expect(options.headers.get('X-CSRF-Token')).toBe('logout-csrf');
  });
  it('preserves field validation errors from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: 'Check your fields.', fields: { location: ['Required'] } },
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await expect(request('/complaints')).rejects.toMatchObject({
      message: 'Check your fields.',
      status: 422,
      fields: { location: ['Required'] },
    });
  });
  it('encodes combined filters and omits empty values', () => {
    expect(
      params({ q: 'room & lab', status: 'In Progress', departmentId: 3, from: '', to: undefined }),
    ).toBe('q=room+%26+lab&status=In+Progress&departmentId=3');
  });
  it('ends a stalled startup refresh after ten seconds', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_path: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = expect(refreshSession()).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('timed out'),
    });
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].signal!.aborted).toBe(true);
  });
  it('bounds an account request and warns about a possibly completed registration without replaying it', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_path: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = expect(
      request('/auth/register', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining(
        'Check your inbox for a verification email before trying again',
      ),
    });
    await vi.advanceTimersByTimeAsync(60000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('also bounds startup when another tab holds the cookie lock', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          (_name: string, options: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(options.signal.reason));
            }),
        ),
      },
    });
    const result = expect(refreshSession()).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(fetch).not.toHaveBeenCalled();
  });
  it('gives a useful unavailable message for a provider HTML error page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Unavailable</html>', {
          status: 503,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    await expect(request('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('temporarily unavailable'),
    });
  });
  it('preserves caller cancellation rather than reporting an outage', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, options: RequestInit) => Promise.reject(options.signal!.reason)),
    );
    await expect(request('/complaints', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('does not replay a mutation after an active refresh finishes', async () => {
    let finishRefresh!: (response: Response) => void;
    const lost = vi.fn();
    configureSession(lost);
    setToken('expired-access');
    const fetch = vi.fn((path: string) => {
      if (path.endsWith('/csrf'))
        return Promise.resolve(new Response(JSON.stringify({ csrfToken: 'fresh' })));
      if (path.endsWith('/refresh'))
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        });
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Expired' } }), { status: 401 }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const refresh = refreshSession();
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'));
    const result = expect(
      request('/complaints', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('submit this request again'),
    });
    finishRefresh(
      new Response(
        JSON.stringify({ accessToken: 'renewed', csrfToken: 'rotated', user: { id: 1 } }),
      ),
    );
    await refresh;
    await result;
    expect(fetch.mock.calls.filter(([path]) => path === '/api/v1/complaints')).toHaveLength(1);
    expect(lost).not.toHaveBeenCalled();
  });
});
