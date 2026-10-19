const targets = [
  {
    service: 'render-api-database',
    url: 'https://fixmycampus-api-7e74.onrender.com/api/v1/health',
    kind: 'api',
  },
  {
    service: 'pages-api-proxy',
    url: 'https://fixmycampus.pages.dev/api/v1/health',
    kind: 'api',
  },
  {
    service: 'pages-login',
    url: 'https://fixmycampus.pages.dev/login',
    kind: 'html',
  },
];

async function check(target) {
  const started = Date.now();
  let status = null;
  let failure = null;
  try {
    const response = await fetch(target.url, {
      method: 'GET',
      headers: {
        Accept: target.kind === 'api' ? 'application/json' : 'text/html',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
      redirect: 'manual',
      // A cold Render instance can take about a minute to boot.
      signal: AbortSignal.timeout(90_000),
    });
    status = response.status;
    const contentType = response.headers.get('Content-Type') ?? '';
    if (status !== 200) {
      await response.body?.cancel();
      failure = 'http_error';
    } else if (target.kind === 'api') {
      if (!contentType.includes('application/json')) {
        await response.body?.cancel();
        failure = 'invalid_health';
      } else {
        const body = await response.json();
        if (body?.status !== 'ok' || body?.database !== 'connected') failure = 'invalid_health';
      }
    } else {
      const html = await response.text();
      if (
        !contentType.includes('text/html') ||
        !html.includes('FixMyCampus') ||
        !html.includes('<div id="root"></div>')
      ) {
        failure = 'invalid_html';
      }
    }
  } catch {
    failure = 'network_or_invalid_response';
  }
  return {
    service: target.service,
    ok: failure === null,
    status,
    elapsedMs: Date.now() - started,
    ...(failure ? { failure } : {}),
  };
}

export default {
  async scheduled() {
    const checks = await Promise.all(targets.map(check));
    console.log(JSON.stringify({ event: 'service_health', checks }));
    const failed = checks.filter((result) => !result.ok);
    if (failed.length) {
      throw new Error(
        `Service health failed: ${failed.map((result) => result.service).join(', ')}`,
      );
    }
  },
  fetch() {
    return new Response('Not found', { status: 404 });
  },
};
