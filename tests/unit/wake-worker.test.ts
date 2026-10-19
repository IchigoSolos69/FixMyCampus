import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../deploy/wake-worker/index.mjs';

const healthy = () => Response.json({ status: 'ok', database: 'connected' });
const login = () =>
  new Response('<title>FixMyCampus</title><div id="root"></div>', {
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  });

function mockTargets(api = healthy(), proxy = healthy(), page = login()) {
  return vi
    .fn()
    .mockResolvedValueOnce(api)
    .mockResolvedValueOnce(proxy)
    .mockResolvedValueOnce(page);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Cloudflare scheduled service health', () => {
  it('checks the fixed API, DB proxy and login targets concurrently without credentials', async () => {
    let finish: (response: Response) => void;
    const pendingApi = new Promise<Response>((resolve) => (finish = resolve));
    const fetch = mockTargets();
    fetch
      .mockReset()
      .mockReturnValueOnce(pendingApi)
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(login());
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    const run = worker.scheduled();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://fixmycampus-api-7e74.onrender.com/api/v1/health',
      'https://fixmycampus.pages.dev/api/v1/health',
      'https://fixmycampus.pages.dev/login',
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options).toMatchObject({ method: 'GET', redirect: 'manual', cache: 'no-store' });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(Object.keys(options.headers).sort()).toEqual(['Accept', 'Cache-Control']);
    }
    expect(timeout.mock.calls).toEqual([[90_000], [90_000], [90_000]]);
    finish!(healthy());
    await run;

    const result = JSON.parse(log.mock.calls[0][0]);
    expect(result.event).toBe('service_health');
    expect(result.checks).toHaveLength(3);
    expect(result.checks.every((check: { ok: boolean }) => check.ok)).toBe(true);
  });

  it.each([
    ['HTTP failure', () => new Response('private error body', { status: 503 })],
    [
      'redirect',
      () => new Response(null, { status: 302, headers: { Location: 'https://other.test' } }),
    ],
    ['HTML instead of API JSON', () => login()],
    ['disconnected database', () => Response.json({ status: 'ok', database: 'disconnected' })],
    [
      'malformed JSON',
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    ],
    ['null JSON', () => Response.json(null)],
  ])(
    'marks %s as a failed cron run without logging response contents',
    async (_, failedResponse) => {
      const fetch = mockTargets(failedResponse());
      vi.stubGlobal('fetch', fetch);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(worker.scheduled()).rejects.toThrow(
        'Service health failed: render-api-database',
      );
      expect(fetch).toHaveBeenCalledTimes(3);
      const result = JSON.parse(log.mock.calls[0][0]);
      expect(result.checks[0].ok).toBe(false);
      expect(result.checks[1].ok).toBe(true);
      expect(result.checks[2].ok).toBe(true);
      expect(log.mock.calls[0][0]).not.toContain('private error body');
      expect(log.mock.calls[0][0]).not.toContain('other.test');
    },
  );

  it('detects an unavailable Pages proxy and a broken login HTML page', async () => {
    vi.stubGlobal(
      'fetch',
      mockTargets(healthy(), new Response(null, { status: 502 }), new Response('wrong page')),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(worker.scheduled()).rejects.toThrow('pages-api-proxy, pages-login');
    const result = JSON.parse(log.mock.calls[0][0]);
    expect(result.checks[0].ok).toBe(true);
    expect(result.checks[1].failure).toBe('http_error');
    expect(result.checks[2].failure).toBe('invalid_html');
  });

  it('contains network and timeout errors while checking the remaining services', async () => {
    const fetch = mockTargets();
    fetch
      .mockReset()
      .mockRejectedValueOnce(new DOMException('private network details', 'TimeoutError'))
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(login());
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(worker.scheduled()).rejects.toThrow('render-api-database');
    expect(fetch).toHaveBeenCalledTimes(3);
    const result = JSON.parse(log.mock.calls[0][0]);
    expect(result.checks[0]).toMatchObject({
      ok: false,
      status: null,
      failure: 'network_or_invalid_response',
    });
    expect(log.mock.calls[0][0]).not.toContain('private network details');
  });

  it('does not expose a caller-controlled wake or proxy endpoint', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = worker.fetch();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(fetch).not.toHaveBeenCalled();
  });
});
