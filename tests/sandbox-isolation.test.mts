import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/server.ts';
import { whop } from '../src/whop.ts';

const productionKey = 'test-production-key-never-serialize';
const sandboxKey = 'test-sandbox-key-never-serialize';
const env = {
  WHOP_ENVIRONMENT: 'production', WHOP_ACCOUNT_ID: 'biz_production', WHOP_API_KEY: productionKey,
  WHOP_INSPECTION_PLAN_ID: 'plan_productionInspection', WHOP_DEPOSIT_PLAN_ID: 'plan_productionDeposit', WHOP_REPAIR_PLAN_ID: 'plan_productionRepair',
  WHOP_SANDBOX_ACCOUNT_ID: 'biz_sandbox', WHOP_SANDBOX_API_KEY: sandboxKey,
  WHOP_SANDBOX_INSPECTION_PLAN_ID: 'plan_sandboxInspection', WHOP_SANDBOX_DEPOSIT_PLAN_ID: 'plan_sandboxDeposit', WHOP_SANDBOX_REPAIR_PLAN_ID: 'plan_sandboxRepair',
  WHOP_ENABLE_LIVE_PAYMENTS: 'true', APP_SESSION_SECRET: 'test-session-secret-never-serialize-at-least-32', ADMIN_PASSWORD: 'test-owner-password-never-serialize',
  ASSETS: { fetch: async () => new Response('static website') },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
function request(path: string, body?: object, overrides = {}, origin = 'https://roof.test') {
  return worker.fetch(new Request(`https://roof.test${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), { ...env, ...overrides } as any, ctx as any);
}
test('sandbox config selects its own public catalog without serializing any credential', async () => {
  const production = await (await request('/api/config')).json() as any;
  const response = await request('/api/sandbox/config');
  const text = await response.text(); const sandbox = JSON.parse(text);
  assert.equal(production.environment, 'production'); assert.equal(production.accountId, 'biz_production');
  assert.equal(production.plans.deposit, 'plan_productionDeposit');
  assert.equal(sandbox.environment, 'sandbox'); assert.equal(sandbox.accountId, 'biz_sandbox'); assert.equal(sandbox.plans.deposit, 'plan_sandboxDeposit');
  assert.equal(sandbox.ready, true);
  for (const secret of [productionKey, sandboxKey, env.APP_SESSION_SECRET, env.ADMIN_PASSWORD]) assert.equal(text.includes(secret), false);
  assert.equal(text.includes('biz_production'), false); assert.equal(text.includes('plan_production'), false);
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});
test('sandbox route fails closed when dedicated credentials or catalog are absent; production is never a fallback', async () => {
  const original = globalThis.fetch; let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls++; throw new Error('Missing sandbox configuration must stop before Whop'); };
  try {
    const absent = { WHOP_SANDBOX_ACCOUNT_ID: '', WHOP_SANDBOX_API_KEY: '', WHOP_SANDBOX_INSPECTION_PLAN_ID: '', WHOP_SANDBOX_DEPOSIT_PLAN_ID: '', WHOP_SANDBOX_REPAIR_PLAN_ID: '' };
    const response = await request('/api/sandbox/config', undefined, absent); const config = await response.json() as any;
    assert.equal(config.ready, false); assert.notEqual(config.accountId, 'biz_production');
    assert.notEqual(config.plans.inspection, 'plan_productionInspection');
    assert.equal((await request('/api/sandbox/checkout/start', { service: 'inspection' }, absent)).status, 503);
    const keyOnlyMissing = { ...env, ROOFING_SANDBOX_ROUTE: 'true', WHOP_ENVIRONMENT: 'sandbox', WHOP_SANDBOX_API_KEY: '' };
    await assert.rejects(whop(keyOnlyMissing, 'GET', '/variants/plan_sandboxInspection'));
    assert.equal(upstreamCalls, 0);
  } finally { globalThis.fetch = original; }
});
test('sandbox rewriting preserves POST body and same-origin CSRF checks while selecting only sandbox Whop', async () => {
  const original = globalThis.fetch; let upstreamCalls = 0;
  globalThis.fetch = async (input, init) => {
    upstreamCalls++; assert.equal(String(input), 'https://sandbox-api.whop.com/api/v1/variants/plan_sandboxInspection');
    assert.equal(init?.method, 'GET'); assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${sandboxKey}`);
    return new Response(JSON.stringify({ billing_type: 'one_time', currency: 'usd', initial_price: { amount: '149' } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.equal((await request('/api/sandbox/checkout/start', { service: 'inspection' }, {}, 'https://evil.test')).status, 403);
    assert.equal(upstreamCalls, 0);
    const response = await request('/api/sandbox/checkout/start', { service: 'inspection' }); const job = await response.json() as any;
    assert.equal(response.status, 200); assert.equal(job.service, 'inspection'); assert.equal(job.planId, 'plan_sandboxInspection');
    assert.equal(job.amount, 149); assert.equal(upstreamCalls, 1);
    const jobCookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(jobCookie.startsWith('roof_sandbox_job=')); assert.equal(jobCookie.includes('roof_job='), false);
    const productionStatus = await worker.fetch(new Request('https://roof.test/api/checkout/status', { headers: { Cookie: jobCookie } }), env as any, ctx as any);
    assert.equal(productionStatus.status, 401); assert.equal(upstreamCalls, 1);
  } finally { globalThis.fetch = original; }
});
test('production Whop requests ignore sandbox overrides and sandbox cannot be redirected to an arbitrary host', async () => {
  const original = globalThis.fetch; const calls: Array<{url:string;authorization:string|null}> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('Authorization') });
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await whop(env, 'GET', '/variants/plan_productionInspection');
    await whop({ ...env, WHOP_ENVIRONMENT: 'sandbox', ROOFING_SANDBOX_ROUTE: 'true', WHOP_API_ORIGIN: 'https://untrusted.example' }, 'GET', '/variants/plan_sandboxInspection');
    assert.deepEqual(calls, [
      { url: 'https://api.whop.com/api/v1/variants/plan_productionInspection', authorization: `Bearer ${productionKey}` },
      { url: 'https://sandbox-api.whop.com/api/v1/variants/plan_sandboxInspection', authorization: `Bearer ${sandboxKey}` },
    ]);
  } finally { globalThis.fetch = original; }
});
test('browser routing isolates checkout and owner payments while visitor identity and leads remain production', async () => {
  const g = globalThis as any; const previous = { window: g.window, location: g.location, sessionStorage: g.sessionStorage, fetch: g.fetch };
  const paths: string[] = [];
  g.window = {}; g.sessionStorage = { getItem: () => null }; g.location = { pathname: '/sandbox' };
  g.fetch = async (input: unknown) => { paths.push(String(input)); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); };
  try {
    const { api } = await import('../src/lib.ts');
    for (const path of ['config', 'checkout/start', 'admin/jobs', 'admin/invoices', 'admin/leads', 'admin/events', 'auth/whop', 'leads', 'admin/login']) await api(path);
    assert.deepEqual(paths, ['/api/sandbox/config', '/api/sandbox/checkout/start', '/api/sandbox/admin/jobs', '/api/sandbox/admin/invoices', '/api/admin/leads', '/api/admin/events', '/api/auth/whop', '/api/leads', '/api/admin/login']);
    paths.length = 0; g.location.pathname = '/sandbox/checkout/return'; await api('checkout/status'); assert.deepEqual(paths, ['/api/sandbox/checkout/status']);
    paths.length = 0; g.location.pathname = '/sandboxish'; await api('config'); assert.deepEqual(paths, ['/api/config']);
  } finally { Object.assign(g, previous); }
});
