interface Env {
  API_ORIGIN: string;
}

// Same-origin proxy: the SPA calls /api/* on the Pages origin, so the auth cookies are
// first-party (Safari/ITP drops the cross-site SameSite=None cookies otherwise).
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname.replace(/^\/api/, '') || '/', env.API_ORIGIN);
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.set('origin', incoming.origin);

  let body: ArrayBuffer | string | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    body = await request.arrayBuffer();
    // cloudflared re-sends every POST as chunked, and Fastify rejects an empty chunked
    // body (415/400), so body-less calls travel as an empty JSON object instead.
    if (body.byteLength === 0) {
      body = '{}';
      headers.set('content-type', 'application/json');
    }
  }

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('set-cookie');
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie.replace(/;\s*Path=\/auth/i, '; Path=/api/auth'));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
