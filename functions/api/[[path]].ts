export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env: { API_ORIGIN?: string };
}): Promise<Response> {
  const incoming = new URL(request.url);
  let target: URL;
  try {
    target = new URL(env.API_ORIGIN ?? '');
    if (
      target.protocol !== 'https:' ||
      target.href !== `${target.origin}/` ||
      target.origin === incoming.origin
    )
      throw new Error('Invalid API origin');
  } catch {
    return Response.json(
      { error: { message: 'API hosting is not configured. Contact the campus administrator.' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  target.pathname = incoming.pathname;
  target.search = incoming.search;
  try {
    const upstreamRequest = new Request(target, request);
    upstreamRequest.headers.delete('Host');
    const upstream = await fetch(upstreamRequest, { redirect: 'manual', cache: 'no-store' });
    // The API has no redirects; do not let a browser resend a private upload elsewhere.
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      throw new Error('Unexpected API redirect');
    }
    // Copy Headers directly so separate Set-Cookie values and streaming files survive.
    const response = new Response(upstream.body, upstream);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('CDN-Cache-Control', 'no-store');
    response.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    return response;
  } catch {
    return Response.json(
      { error: { message: 'The campus service is temporarily unavailable. Try again shortly.' } },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
