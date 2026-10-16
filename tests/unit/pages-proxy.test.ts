import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/[[path]]';

const origin = 'https://fixmycampus.pages.dev';
const backend = 'https://campus-api.example';

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare Pages API proxy', () => {
  it.each([
    undefined,
    '',
    'not a URL',
    'http://campus-api.example',
    'https://user:password@campus-api.example',
    'https://campus-api.example/api',
    'https://campus-api.example?token=secret',
    'https://campus-api.example?',
    'https://campus-api.example#fragment',
    'https://campus-api.example#',
    origin,
    `${origin}:443/`,
  ])('rejects unsafe or missing API_ORIGIN %s without contacting it', async (API_ORIGIN) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const response = await onRequest({
      request: new Request(`${origin}/api/v1/health`),
      env: { API_ORIGIN },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { message: 'API hosting is not configured. Contact the campus administrator.' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves auth headers, query parameters, and a streaming multipart upload', async () => {
    const form = new FormData();
    form.set('description', 'Broken classroom projector');
    form.append('files', new File(['private proof'], 'proof.pdf', { type: 'application/pdf' }));
    const request = new Request(`${origin}/api/v1/complaints?status=Assigned&search=a%2Fb`, {
      method: 'POST',
      headers: {
        Host: 'fixmycampus.pages.dev',
        Origin: origin,
        Cookie: 'fmc_refresh=refresh; fmc_csrf=csrf',
        Authorization: 'Bearer access',
        'X-CSRF-Token': 'csrf',
      },
      body: form,
    });
    const fetch = vi.fn(async (forwarded: Request, options: RequestInit) => {
      expect(forwarded.url).toBe(`${backend}/api/v1/complaints?status=Assigned&search=a%2Fb`);
      expect(forwarded.method).toBe('POST');
      expect(forwarded.headers.get('Host')).toBeNull();
      expect(forwarded.headers.get('Origin')).toBe(origin);
      expect(forwarded.headers.get('Cookie')).toBe('fmc_refresh=refresh; fmc_csrf=csrf');
      expect(forwarded.headers.get('Authorization')).toBe('Bearer access');
      expect(forwarded.headers.get('X-CSRF-Token')).toBe('csrf');
      expect(options).toEqual({ redirect: 'manual', cache: 'no-store' });
      const forwardedForm = await forwarded.formData();
      expect(forwardedForm.get('description')).toBe('Broken classroom projector');
      const proof = forwardedForm.get('files') as File;
      expect(proof.name).toBe('proof.pdf');
      expect(await proof.text()).toBe('private proof');
      return Response.json({ id: 42 }, { status: 201 });
    });
    vi.stubGlobal('fetch', fetch);

    const response = await onRequest({ request, env: { API_ORIGIN: `${backend}/` } });

    expect(fetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ id: 42 });
  });

  it('preserves separate HttpOnly cookies, expiry commas, and private response headers', async () => {
    const cookies = [
      'fmc_refresh=refresh; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
      'fmc_csrf=csrf; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict',
    ];
    const headers = new Headers({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="report.pdf"',
      'Cache-Control': 'public, max-age=3600',
      'CDN-Cache-Control': 'public, max-age=3600',
      'Cloudflare-CDN-Cache-Control': 'public, max-age=3600',
    });
    cookies.forEach((cookie) => headers.append('Set-Cookie', cookie));
    const upstream = new Response(new Blob(['private report']).stream(), { headers });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));

    const response = await onRequest({
      request: new Request(`${origin}/api/v1/reports/export`),
      env: { API_ORIGIN: backend },
    });

    expect(response.headers.getSetCookie()).toEqual(cookies);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="report.pdf"');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('private report');
  });

  it.each([301, 302, 303, 307, 308])(
    'blocks upstream %s redirects and browser resubmission of private bodies',
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(null, {
          status,
          headers: { Location: 'https://untrusted.example/collect' },
        }),
      );
      vi.stubGlobal('fetch', fetch);

      const response = await onRequest({
        request: new Request(`${origin}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { Cookie: 'fmc_refresh=private', Authorization: 'Bearer private' },
        }),
        env: { API_ORIGIN: backend },
      });

      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][1]).toEqual({ redirect: 'manual', cache: 'no-store' });
      expect(response.status).toBe(502);
      expect(response.headers.get('Location')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    },
  );

  it('preserves upstream API errors without caching them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { message: 'Denied' } }, { status: 403 })),
    );
    const response = await onRequest({
      request: new Request(`${origin}/api/v1/complaints/other-user`),
      env: { API_ORIGIN: backend },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: { message: 'Denied' } });
  });

  it('returns a controlled uncached gateway error without leaking backend failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private backend configuration')));
    const response = await onRequest({
      request: new Request(`${origin}/api/v1/health`),
      env: { API_ORIGIN: backend },
    });
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toContain('private backend configuration');
  });
});
