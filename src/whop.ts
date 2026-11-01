import { company } from './config.ts';
export type Bindings = Record<string, unknown>;
export const API_VERSION = '2026-10-29-8';
export const TEMPLATE_ID = 'ridgeway-roofing-v1';
export type Service = 'inspection' | 'deposit' | 'repair';
export const services: Service[] = ['inspection', 'deposit', 'repair'];
export function setting(env: Bindings, key: string): string {
  const value = env[key] ?? process.env[key];
  return typeof value === 'string' ? value : '';
}
export function configuration(env: Bindings) {
  const environment = setting(env, 'WHOP_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';
  const isolated = setting(env, 'ROOFING_SANDBOX_ROUTE') === 'true';
  const plans = Object.fromEntries(services.map(s => [s, environment === 'sandbox' ? setting(env, `WHOP_SANDBOX_${s.toUpperCase()}_PLAN_ID`) || (isolated ? '' : setting(env, `WHOP_${s.toUpperCase()}_PLAN_ID`)) : setting(env, `WHOP_${s.toUpperCase()}_PLAN_ID`)])) as Record<Service, string>;
  const prices = Object.fromEntries(services.map(s => [s, Number(setting(env, `WHOP_${s.toUpperCase()}_PRICE`) || company.services.find(item => item.id === s)!.price)])) as Record<Service, number>;
  const accountId = environment === 'sandbox' ? setting(env, 'WHOP_SANDBOX_ACCOUNT_ID') || (isolated ? '' : setting(env, 'WHOP_ACCOUNT_ID')) : setting(env, 'WHOP_ACCOUNT_ID');
  const missing: string[] = [];
  if (!/^biz_[a-zA-Z0-9]+$/.test(accountId)) missing.push('WHOP_ACCOUNT_ID');
  for (const s of services) {
    if (!/^plan_[a-zA-Z0-9]+$/.test(plans[s])) missing.push(`WHOP_${s.toUpperCase()}_PLAN_ID`);
    if (!Number.isFinite(prices[s]) || prices[s] < 1) missing.push(`WHOP_${s.toUpperCase()}_PRICE`);
  }
  const token = environment === 'sandbox' ? setting(env, 'WHOP_SANDBOX_API_KEY') || (isolated ? '' : setting(env, 'WHOP_API_KEY')) : setting(env, 'WHOP_API_KEY');
  if (!token && (environment === 'sandbox' || !setting(env, 'WHOP_API_ORIGIN'))) missing.push(isolated ? 'WHOP_SANDBOX_API_KEY' : 'WHOP_API_KEY');
  if (setting(env, 'APP_SESSION_SECRET').length < 32) missing.push('APP_SESSION_SECRET');
  if (environment === 'production' && setting(env, 'WHOP_ENABLE_LIVE_PAYMENTS') !== 'true') missing.push('WHOP_ENABLE_LIVE_PAYMENTS');
  return { ready: missing.length === 0, environment, accountId, plans, prices, missing };
}
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}
function safeLeadError(message: unknown): string | undefined {
  if (typeof message !== 'string') return undefined;
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:ctok_|payt_|apik_|sk_|whop_)[A-Za-z0-9_:-]+/g, '[credential]')
    .replace(/\b[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]+)*\b/g, '[token]')
    .replace(/\b\d{10,19}\b/g, '[number]').slice(0, 400);
}
/** Call the Whop platform proxy (production API, keyless). Falls back to production API key. */
export async function whopPlatform<T = any>(env: Bindings, method: string, path: string, body?: unknown, key?: string): Promise<T> {
  return whop(env, method, path, body, key, true);
}
export async function whop<T = any>(env: Bindings, method: string, path: string, body?: unknown, key?: string, forceProduction = false): Promise<T> {
  if (!/^\/[a-z_]+(?:[/?][a-zA-Z0-9_?=&%.,:-]*)*$/.test(path)) throw new ApiError(500, 'Invalid API route.');
  const sandbox = !forceProduction && configuration(env).environment === 'sandbox';
  const token = forceProduction
    ? setting(env, 'WHOP_API_KEY')  // production key if available; empty → keyless proxy
    : sandbox ? setting(env, 'WHOP_SANDBOX_API_KEY') || (setting(env, 'ROOFING_SANDBOX_ROUTE') === 'true' ? '' : setting(env, 'WHOP_API_KEY')) : setting(env, 'WHOP_API_KEY');
  // Explicit credentials are sent only to fixed Whop hosts. The reserved hosted
  // binding is trusted only for the keyless platform proxy, never browser input.
  const origin = sandbox ? 'https://sandbox-api.whop.com' : token ? 'https://api.whop.com' : setting(env, 'WHOP_API_ORIGIN') || 'https://api.whop.com';
  const url = new URL(origin);
  if (url.protocol !== 'https:' || (token && !['api.whop.com', 'sandbox-api.whop.com'].includes(url.hostname)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new ApiError(503, 'Whop API origin is not an approved Whop origin.');
  if (!token && (sandbox || !setting(env, 'WHOP_API_ORIGIN'))) throw new ApiError(503, 'Connect the Whop account before using this feature.', 'whop_not_configured');
  const response = await fetch(`${url.origin}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'Api-Version-Date': API_VERSION,
      ...(token ? { Authorization: `Bearer ${token}`, 'x-whop-inject-key': 'none' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json() as any;
  if (!response.ok) {
    const code = typeof result.error?.code === 'string' ? result.error.code : `whop_${response.status}`;
    console.error('Whop request refused', method, path.split('?')[0], response.status, code);
    if (path === '/leads') console.error('Whop lead validation', safeLeadError(result.error?.message ?? result.message) || 'No validation message returned.');
    if (response.status === 401 || response.status === 403) throw new ApiError(503, 'Whop account access or API permissions need attention.', code);
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'Whop could not complete this request. Check account configuration and try again.', code);
  }
  return result as T;
}
export function safePayment(p: any) {
  return { id: p.id, status: p.status, client_secret: p.client_secret, amount: p.total?.amount, currency: p.currency, recovery_url: p.recovery_url };
}
