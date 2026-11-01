import api from './api.ts';

type RuntimeBindings = Record<string, unknown> & { ASSETS: Fetcher };

export default {
  async fetch(request: Request, env: RuntimeBindings, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      const sandbox = path.startsWith('/api/sandbox/');
      const target = new URL(request.url);
      if (sandbox) target.pathname = path.replace('/api/sandbox/', '/api/');
      const response = await api.fetch(sandbox ? new Request(target, request) : request, (sandbox ? { ...env, WHOP_ENVIRONMENT: 'sandbox', ROOFING_SANDBOX_ROUTE: 'true', WHOP_WEBHOOK_SECRET: env.WHOP_SANDBOX_WEBHOOK_SECRET || '' } : env) as never, ctx);
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
    return env.ASSETS.fetch(request);
  },
};
