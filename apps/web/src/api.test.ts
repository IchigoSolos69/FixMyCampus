import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureSession, endSession, params, refreshSession, request, setToken } from './api';

afterEach(() => {
  setToken('');
  configureSession(() => {});
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
});
