import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/api.ts';
const env = { APP_ID: 'app_test', WHOP_ENVIRONMENT: 'sandbox', WHOP_API_KEY: 'test-not-a-real-key', WHOP_ACCOUNT_ID: 'biz_test', WHOP_INSPECTION_PLAN_ID: 'plan_inspection', WHOP_DEPOSIT_PLAN_ID: 'plan_deposit', WHOP_REPAIR_PLAN_ID: 'plan_repair', APP_SESSION_SECRET: 'a-secure-test-session-secret-at-least-32-characters', ADMIN_PASSWORD: 'a-secure-owner-password-test-only' };
let count = 0;
async function req(path: string, body?: any, cookie = '', overrides: Record<string, any> = {}) {
  return api.request(`https://roof.test/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://roof.test', 'CF-Connecting-IP': `test-${count++}`, ...(cookie ? { Cookie: cookie } : {}), ...overrides.headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { ...env, ...overrides.env });
}
function response(data: any, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function cookies(r: Response) { return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); }
async function visitorCookie() {
  const start = await req('/auth/whop/start');
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('Location')!).searchParams.get('state');
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).endsWith('/token') ? response({ access_token: 'visitor_access_test', refresh_token: 'visitor_refresh_test', expires_in: 3600 }) : String(url).endsWith('/userinfo') ? response({ sub: 'user_homeowner', name: 'Homeowner', email: 'home@example.com' }) : response({});
  try {
    const callback = await req(`/auth/whop/callback?code=valid_code&state=${state}`, undefined, cookies(start));
    assert.equal(callback.status, 302);
    assert.ok(callback.headers.get('Location')?.includes('whop_login=success'));
    return cookies(callback);
  } finally { globalThis.fetch = original; }
}


test('missing credentials are visible and checkout cannot pretend to start', async () => {
  const r = await req('/config', undefined, '', { env: { WHOP_API_KEY: '' } });
  const cfg = await r.json() as any;
  assert.equal(cfg.ready, false); assert.ok(cfg.missing.includes('WHOP_API_KEY'));
  const start = await req('/checkout/start', { service: 'deposit' }, '', { env: { WHOP_API_KEY: '' } });
  assert.equal(start.status, 503);
});
test('cross-origin mutations and forged webhook signatures fail closed', async () => {
  assert.equal((await req('/leads', {}, '', { headers: { Origin: 'https://evil.test' } })).status, 403);
  const r = await req('/webhooks/whop', {}, '', { env: { WHOP_WEBHOOK_SECRET: 'ws_invalid' } });
  assert.equal(r.status, 400);
});
test('estimate validation and honeypot stop input before any Whop call', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected upstream call'); };
  try {
    assert.equal((await req('/leads', { email: 'bad' })).status, 400);
    const valid = { name: 'Homeowner', email: 'home@example.com', phone: '+1 512 555 0100', address: '10 Test Street', zip: '78701', service: 'repair', consent: true, requestId: crypto.randomUUID(), website: 'spam' };
    assert.equal((await req('/leads', valid)).status, 400);
  } finally { globalThis.fetch = original; }
});
test('a lead is acknowledged only after a real-shaped upstream lead result', async () => {
  const visitor = await visitorCookie();
  const original = globalThis.fetch; let called = 0;
  globalThis.fetch = async (url, init) => {
    called++;
    if (String(url).endsWith('/events')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.event_name, 'estimate_requested'); assert.equal(body.event_id, 'lead_realshape');
      assert.equal(body.account_id, 'biz_test'); assert.equal(body.user.user_id, 'user_homeowner');
      return response({ id: 'biz_test:lead_realshape' }, 201);
    }
    assert.equal(String(url), 'https://sandbox-api.whop.com/api/v1/leads');
    const headers = new Headers(init?.headers); assert.equal(headers.get('Api-Version-Date'), '2026-10-29-8');
    const body = JSON.parse(String(init?.body)); assert.equal(body.metadata.email, 'home@example.com'); assert.equal(body.account_id, 'biz_test'); assert.equal(body.user_id, 'user_homeowner');
    return response({ id: 'lead_realshape' }, 201);
  };
  try {
    const r = await req('/leads', { name: 'Homeowner', email: 'home@example.com', phone: '+1 512 555 0100', address: '10 Test Street', zip: '78701', service: 'inspection', consent: true, requestId: crypto.randomUUID() }, visitor);
    assert.equal(r.status, 201); assert.equal((await r.json() as any).id, 'lead_realshape'); assert.equal(called, 2);
  } finally { globalThis.fetch = original; }
});
test('upstream lead refusal returns a failure, never a generated lead id', async () => {
  const visitor = await visitorCookie();
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => { calls++; assert.equal(String(url).endsWith('/leads'), true); return response({ error: { code: 'user_required' } }, 400); };
  try {
    const r = await req('/leads', { name: 'Homeowner', email: 'home@example.com', phone: '+1 512 555 0100', address: '10 Test Street', zip: '78701', service: 'inspection', consent: true, requestId: crypto.randomUUID() }, visitor);
    assert.equal(r.status, 400); assert.equal((await r.json() as any).code, 'user_required');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
test('successful estimates mirror the same real lead ID and sanitized visitor context without contact data', async () => {
  const visitor = await visitorCookie();
  const original = globalThis.fetch; const events: any[] = [];
  const createdAt = new Date(Date.now() - 2000).toISOString();
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/leads')) return response({ id: 'lead_actual', created_at: createdAt }, 201);
    assert.equal(String(url), 'https://sandbox-api.whop.com/api/v1/events');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'estimate-event-lead_actual');
    events.push(JSON.parse(String(init?.body)));
    return response({ id: 'biz_test:lead_actual' }, 201);
  };
  const input = { name: 'Homeowner', email: 'home@example.com', phone: '+1 512 555 0100', address: '10 Test Street', zip: '78701', service: 'inspection', consent: true, requestId: crypto.randomUUID() };
  try {
    for (const trackingCookie of ['_wuid=wuid_visitor123', '_wuid=malformed%40email.test']) {
      const r = await req('/leads', input, `${visitor}; ${trackingCookie}`, { headers: { Referer: 'https://roof.test/?utm_source=demo&email=private%40example.com&token=private#estimate', 'CF-Connecting-IP': '203.0.113.10', 'User-Agent': 'Roofing test browser' } });
      assert.equal(r.status, 201); assert.equal((await r.json() as any).id, 'lead_actual');
    }
    assert.equal(events.length, 2);
    assert.equal(events[0].account_id, 'biz_test'); assert.equal(events[0].event_id, 'lead_actual');
    assert.equal(events[0].event_name, 'estimate_requested'); assert.equal(events[0].event_time, createdAt);
    assert.deepEqual(events[0].user, { user_id: 'user_homeowner', anonymous_id: 'wuid_visitor123' });
    assert.deepEqual(events[1].user, { user_id: 'user_homeowner' });
    assert.equal(events[0].context.ip_address, '203.0.113.10'); assert.equal(events[0].context.user_agent, 'Roofing test browser');
    assert.equal(events[0].url, 'https://roof.test/?utm_source=demo');
    assert.equal(JSON.stringify(events).includes('home@example.com'), false); assert.equal(JSON.stringify(events).includes('10 Test Street'), false);
  } finally { globalThis.fetch = original; }
});
test('analytics refusal never changes a successful saved-lead response', async () => {
  const visitor = await visitorCookie();
  const original = globalThis.fetch; let analyticsCalls = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/leads')) return response({ id: 'lead_saved' }, 201);
    analyticsCalls++; return response({ error: { code: 'event_scope_missing' } }, 403);
  };
  try {
    const r = await req('/leads', { name: 'Homeowner', email: 'home@example.com', phone: '+1 512 555 0100', address: '10 Test Street', zip: '78701', service: 'inspection', consent: true, requestId: crypto.randomUUID() }, visitor);
    assert.equal(r.status, 201); assert.deepEqual(await r.json(), { id: 'lead_saved' }); assert.equal(analyticsCalls, 1);
  } finally { globalThis.fetch = original; }
});
test('a hosted execution context still waits for the actual analytics acknowledgement', { timeout: 2000 }, async () => {
  const visitor = await visitorCookie(); const original = globalThis.fetch;
  let start!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const acknowledgement = new Promise<Response>(resolve => { release = () => resolve(response({ id: 'biz_test:lead_waited' }, 201)); });
  globalThis.fetch = async url => {
    if (String(url).endsWith('/leads')) return response({ id: 'lead_waited' }, 201);
    start(); return acknowledgement;
  };
  try {
    const request = new Request('https://roof.test/api/leads', { method: 'POST', headers: { Origin: 'https://roof.test', 'Content-Type': 'application/json', Cookie: visitor, 'CF-Connecting-IP': 'hosted-ack-test' }, body: JSON.stringify({ name: 'Homeowner', email: 'home@example.com', phone: '+1 512 555 0100', address: '10 Test Street', zip: '78701', service: 'inspection', consent: true, requestId: crypto.randomUUID() }) });
    let responded = false;
    const pending = Promise.resolve(api.fetch(request, env, { waitUntil() {}, passThroughOnException() {}, props: {} } as any)).then(result => { responded = true; return result; });
    await started; await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(responded, false);
    release(); const result = await pending;
    assert.equal(result.status, 201); assert.deepEqual(await result.json(), { id: 'lead_waited' });
  } finally { release(); globalThis.fetch = original; }
});
test('setup session is signed; changing the job cannot charge a stored method', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('/variants/') ? response({ billing_type: 'one_time', currency: 'usd', initial_price: { amount: '500.00' } }) : response({ id: 'ch_setup' });
  try {
    const start = await req('/checkout/start', { service: 'deposit' }); assert.equal(start.status, 200);
    const signed = cookies(start); assert.ok(signed.includes('roof_job='));
    const parts = signed.split('='); const [data, sig] = parts[1].split('.');
    const job = JSON.parse(Buffer.from(data, 'base64url').toString()); job.id = 'victim-job';
    const forged = `roof_job=${Buffer.from(JSON.stringify(job)).toString('base64url')}.${sig}`;
    assert.equal((await req('/checkout/deposit', {}, forged)).status, 401);
  } finally { globalThis.fetch = original; }
});
test('final invoice subtracts deposit once, requires owner + completion, and reuses durable invoice', async () => {
  const login = await req('/admin/login', { password: env.ADMIN_PASSWORD }); assert.equal(login.status, 200);
  const auth = cookies(login); const original = globalThis.fetch; const writes: any[] = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/payments/pay_deposit')) return response({ id: 'pay_deposit', account_id: 'biz_test', metadata: { template: 'ridgeway-roofing-v1', service: 'deposit', job_id: 'job1' }, status: 'paid', member_id: 'mber_homeowner', payment_method_id: 'payt_saved', currency: 'usd', line_items: [{ variant_id: 'plan_deposit' }], refunded_amount: { amount: '0' }, total: { amount: '500.00' } });
    if (init?.method === 'GET') return response({ data: [], page_info: { has_next_page: false } });
    const body = JSON.parse(String(init?.body)); writes.push({ path, body, headers: new Headers(init?.headers) });
    if (path.endsWith('/variants')) return response({ id: 'plan_balance' }, 201);
    if (path.endsWith('/issue')) return response({ id: 'pay_final', status: 'open', checkout_link: 'pay_final.signedtoken' });
    return response({ id: 'pay_final', status: 'draft' }, 201);
  };
  try {
    const input = { paymentId: 'pay_deposit', totalDollars: 8500, mode: 'manual', jobCompleted: true };
    assert.equal((await req('/admin/invoices', input)).status, 401);
    assert.equal((await req('/admin/invoices', { ...input, jobCompleted: false }, auth)).status, 400);
    assert.equal((await req('/admin/invoices', { ...input, mode: 'auto', customerAuthorized: false }, auth)).status, 400);
    const r = await req('/admin/invoices', input, auth); assert.equal(r.status, 201);
    assert.equal(writes.length, 3); assert.equal(writes[0].body.initial_price, 8000);
    assert.deepEqual(writes[0].body.payment_method_configuration, { enabled: [], disabled: ['paypal'], include_platform_defaults: true });
    assert.equal(writes[1].body.items[0].variant_id, 'plan_balance'); assert.equal(writes[1].body.payment_method_id, undefined); assert.equal(writes[1].body.metadata.deposit_credit_cents, '50000');
    assert.deepEqual(writes.map(w => w.headers.get('Idempotency-Key')), ['roof-job1-final-price-800000', 'roof-job1-final', 'roof-job1-issue']);
    assert.ok(writes.every(w => w.headers.get('Api-Version-Date') === '2026-10-29-8'));
    assert.equal((await r.json() as any).paymentUrl, 'https://sandbox.whop.com/checkout/pay_final/?token=signedtoken');
    globalThis.fetch = async url => String(url).includes('/payments/') ? response({ id: 'pay_deposit', account_id: 'biz_test', metadata: { template: 'ridgeway-roofing-v1', service: 'deposit', job_id: 'job1' }, status: 'paid', member_id: 'mber_homeowner', currency: 'usd', line_items: [{ variant_id: 'plan_deposit' }], total: { amount: '500.00' } }) : response({ data: [{ id: 'pay_final', metadata: { template: 'ridgeway-roofing-v1', deposit_payment_id: 'pay_deposit' }, status: 'open' }], page_info: {} });
    const repeated = await req('/admin/invoices', input, auth); assert.equal((await repeated.json() as any).reused, true);
  } finally { globalThis.fetch = original; }
});
test('deposit charge uses only the succeeded setup method bound to the signed job', async () => {
  const original = globalThis.fetch; let jobId = ''; let setupState = 'processing'; let charged = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.includes('/variants/')) return response({ billing_type: 'one_time', currency: 'usd', initial_price: { amount: '500.00' } });
    if (path.endsWith('/checkout_configurations')) return response({ id: 'ch_expresssetup' });
    if (path.endsWith('/setup_intents')) { jobId = JSON.parse(String(init?.body)).metadata.job_id; return response({ id: 'sint_customer', status: 'processing', client_secret: 'test_secret' }); }
    if (path.includes('/setup_intents/')) return response({ id: 'sint_customer', status: setupState, account_id: 'biz_test', member_id: 'mber_verified', payment_method_id: 'payt_verified', metadata: { template: 'ridgeway-roofing-v1', job_id: jobId } });
    if (path.endsWith('/payments')) {
      charged++; const body = JSON.parse(String(init?.body)); assert.equal(body.member_id, 'mber_verified'); assert.equal(body.payment_method_id, 'payt_verified'); assert.equal(body.off_session, false); assert.equal(body.variant_id, 'plan_deposit');
      return response({ id: 'pay_deposit', status: 'paid', total: { amount: '500.00' }, currency: 'usd' });
    }
    throw new Error(`Unexpected API ${path}`);
  };
  try {
    const start = await req('/checkout/start', { service: 'deposit' });
    const setup = await req('/checkout/create', { confirmationToken: 'ctok_card' }, cookies(start));
    const signed = cookies(setup); assert.equal((await setup.json() as any).kind, 'setup');
    assert.equal((await req('/checkout/deposit', {}, signed)).status, 409); assert.equal(charged, 0);
    setupState = 'succeeded';
    const paid = await req('/checkout/deposit', { member_id: 'mber_attacker', payment_method_id: 'payt_attacker' }, signed);
    assert.equal(paid.status, 200); assert.equal((await paid.json() as any).status, 'paid'); assert.equal(charged, 1);
  } finally { globalThis.fetch = original; }
});
test('auto invoices require approval, use verified method and credit $500 principal excluding tax and buyer fees', async () => {
  const auth = cookies(await req('/admin/login', { password: env.ADMIN_PASSWORD }));
  const original = globalThis.fetch; const writes: any[] = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/payments/pay_taxed')) return response({ id: 'pay_taxed', account_id: 'biz_test', metadata: { template: 'ridgeway-roofing-v1', service: 'deposit', job_id: 'jobTax' }, status: 'paid', member_id: 'mber_customer', payment_method_id: 'payt_verified', currency: 'usd', line_items: [{ variant_id: 'plan_deposit', subtotal: { amount: '500.00' } }], subtotal: { amount: '500.00' }, total: { amount: '535.00' }, tax_behavior: 'exclusive', tax_amount: { amount: '35.00' }, buyer_fee_amount: { amount: '17.50' } });
    if (init?.method === 'GET') return response({ data: [], page_info: {} });
    const body = JSON.parse(String(init?.body)); writes.push({ path, body });
    if (path.endsWith('/variants')) return response({ id: 'plan_finaltax' });
    return response({ id: 'pay_finaltax', status: path.endsWith('/issue') ? 'open' : 'draft' });
  };
  try {
    const input = { paymentId: 'pay_taxed', totalDollars: 8500, mode: 'auto', jobCompleted: true, payment_method_id: 'payt_attacker' };
    assert.equal((await req('/admin/invoices', input, auth)).status, 400); assert.equal(writes.length, 0);
    const r = await req('/admin/invoices', { ...input, customerAuthorized: true }, auth);
    assert.equal(r.status, 201); assert.equal((await r.json() as any).invoice.status, 'open');
    assert.equal(writes[0].body.initial_price, 8000); assert.equal(writes[1].body.payment_method_id, 'payt_verified');
    assert.equal(writes[1].body.metadata.deposit_credit_cents, '50000'); assert.equal(writes[1].body.metadata.owner_attests_customer_approved_charge, 'true');
  } finally { globalThis.fetch = original; }
});
test('same job final draft is recovered without creating another bill; changed terms cannot trigger an old auto draft', async () => {
  const auth = cookies(await req('/admin/login', { password: env.ADMIN_PASSWORD }));
  const original = globalThis.fetch; let mode = 'manual'; let writes = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/payments/pay_seconddeposit')) return response({ id: 'pay_seconddeposit', account_id: 'biz_test', metadata: { template: 'ridgeway-roofing-v1', service: 'deposit', job_id: 'sameJob' }, status: 'paid', member_id: 'mber_customer', currency: 'usd', line_items: [{ variant_id: 'plan_deposit' }], total: { amount: '500.00' } });
    if (init?.method === 'GET') return response({ data: [{ id: 'pay_existing', status: 'draft', metadata: { template: 'ridgeway-roofing-v1', job_id: 'sameJob', deposit_payment_id: 'pay_firstdeposit', billing_mode: mode, project_total_cents: '850000' } }], page_info: {} });
    writes++; assert.equal(path, '/api/v1/invoices/pay_existing/issue');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'roof-sameJob-issue');
    return response({ id: 'pay_existing', status: 'open' });
  };
  try {
    const input = { paymentId: 'pay_seconddeposit', totalDollars: 8500, mode: 'manual', jobCompleted: true };
    const r = await req('/admin/invoices', input, auth); assert.equal((await r.json() as any).reused, true); assert.equal(writes, 1);
    mode = 'auto';
    assert.equal((await req('/admin/invoices', input, auth)).status, 409); assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});
test('concurrent final requests use identical idempotency keys, so upstream creates one bill and issues once', async () => {
  const auth = cookies(await req('/admin/login', { password: env.ADMIN_PASSWORD }));
  const original = globalThis.fetch; const uniqueWrites = new Map<string, any>();
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/payments/pay_race')) return response({ id: 'pay_race', account_id: 'biz_test', metadata: { template: 'ridgeway-roofing-v1', service: 'deposit', job_id: 'raceJob' }, status: 'paid', member_id: 'mber_customer', currency: 'usd', line_items: [{ variant_id: 'plan_deposit' }], total: { amount: '500.00' } });
    if (init?.method === 'GET') return response({ data: [], page_info: {} });
    const key = new Headers(init?.headers).get('Idempotency-Key')!; assert.ok(key);
    const value = path.endsWith('/variants') ? { id: 'plan_racebalance' } : { id: 'pay_racefinal', status: path.endsWith('/issue') ? 'open' : 'draft' };
    if (!uniqueWrites.has(key)) uniqueWrites.set(key, value);
    return response(uniqueWrites.get(key));
  };
  try {
    const input = { paymentId: 'pay_race', totalDollars: 8500, mode: 'manual', jobCompleted: true };
    const responses = await Promise.all([req('/admin/invoices', input, auth), req('/admin/invoices', input, auth)]);
    assert.ok(responses.every(r => r.status === 201)); assert.equal(uniqueWrites.size, 3);
    assert.deepEqual([...uniqueWrites.keys()], ['roof-raceJob-final-price-800000', 'roof-raceJob-final', 'roof-raceJob-issue']);
  } finally { globalThis.fetch = original; }
});
test('anonymous estimates request Whop sign-in and never fall back to the account owner', async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Must not call Whop without a visitor identity'); };
  try {
    const r = await req('/leads', { name: 'Homeowner', email: 'home@example.com', phone: '+1 512 555 0100', address: '10 Test Street', zip: '78701', service: 'inspection', consent: true, requestId: crypto.randomUUID(), user_id: 'user_owner', whopUsername: 'owner' });
    assert.equal(r.status, 401); assert.equal((await r.json() as any).code, 'whop_sign_in_required');
  } finally { globalThis.fetch = original; }
});
test('OAuth uses PKCE and rejects state mismatch before exchanging any code', async () => {
  const start = await req('/auth/whop/start'); assert.equal(start.status, 302);
  const location = new URL(start.headers.get('Location')!); const stateCookie = start.headers.getSetCookie()[0];
  assert.equal(location.origin, 'https://sandbox-api.whop.com'); assert.equal(location.searchParams.get('client_id'), 'app_test');
  assert.equal(location.searchParams.get('scope'), 'openid profile email'); assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(location.searchParams.get('nonce')!, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(location.searchParams.get('nonce'), location.searchParams.get('state'));
  assert.equal(location.searchParams.has('company_id'), false); assert.ok(stateCookie.includes('HttpOnly')); assert.ok(stateCookie.includes('SameSite=Lax'));
  const payload = JSON.parse(Buffer.from(cookies(start).split('=')[1].split('.')[0], 'base64url').toString());
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload.verifier))).toString('base64url');
  assert.equal(location.searchParams.get('code_challenge'), challenge);
  assert.equal(payload.nonce, location.searchParams.get('nonce'));
  const secondStart = await req('/auth/whop/start');
  assert.notEqual(new URL(secondStart.headers.get('Location')!).searchParams.get('nonce'), payload.nonce);
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('CSRF must fail before fetch'); };
  try { assert.equal((await req('/auth/whop/callback?code=stolen_code&state=wrong', undefined, cookies(start))).status, 400); }
  finally { globalThis.fetch = original; }
});
test('OAuth stores verified identity only; access and refresh credentials never enter the visitor cookie', async () => {
  const signed = await visitorCookie();
  const cookieValue = signed.split('; ').find(c => c.startsWith('roof_visitor='))!.split('=')[1];
  const value = JSON.parse(Buffer.from(cookieValue.split('.')[0], 'base64url').toString());
  assert.equal(value.userId, 'user_homeowner'); assert.equal(value.access_token, undefined); assert.equal(value.refresh_token, undefined);
  assert.equal(JSON.stringify(value).includes('visitor_access_test'), false);
  const session = await req('/auth/whop', undefined, signed); assert.deepEqual(await session.json(), { authenticated: true, user: { name: 'Homeowner', email: 'home@example.com' } });
});
test('a changed $100 deposit allows a $400 project and bills only the $300 remainder', async () => {
  const auth = cookies(await req('/admin/login', { password: env.ADMIN_PASSWORD }));
  const original = globalThis.fetch; let finalPrice = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/payments/pay_smallerdeposit')) return response({ id: 'pay_smallerdeposit', account_id: 'biz_test', metadata: { template: 'ridgeway-roofing-v1', service: 'deposit', job_id: 'smallerJob' }, status: 'paid', member_id: 'mber_customer', currency: 'usd', line_items: [{ variant_id: 'plan_deposit' }], total: { amount: '100.00' } });
    if (init?.method === 'GET') return response({ data: [], page_info: {} });
    if (path.endsWith('/variants')) { finalPrice = JSON.parse(String(init?.body)).initial_price; return response({ id: 'plan_smallerbalance' }); }
    return response({ id: 'pay_smallerfinal', status: path.endsWith('/issue') ? 'open' : 'draft' });
  };
  try {
    const input = { paymentId: 'pay_smallerdeposit', totalDollars: 400, mode: 'manual', jobCompleted: true };
    assert.equal((await req('/admin/invoices', { ...input, totalDollars: 99 }, auth, { env: { WHOP_DEPOSIT_PRICE: '100' } })).status, 400);
    const r = await req('/admin/invoices', input, auth, { env: { WHOP_DEPOSIT_PRICE: '100' } });
    assert.equal(r.status, 201); assert.equal(finalPrice, 300);
  } finally { globalThis.fetch = original; }
});
test('lead validation detail stays in redacted server logs and is not exposed publicly', async () => {
  const visitor = await visitorCookie(); const originalFetch = globalThis.fetch; const originalError = console.error; const logs: string[] = [];
  globalThis.fetch = async () => response({ error: { message: 'user_id is required for visitor home@example.com, Bearer sensitive_token_value', code: 'user_required' } }, 400);
  console.error = (...args) => { logs.push(args.join(' ')); };
  try {
    const r = await req('/leads', { name: 'Homeowner', email: 'home@example.com', phone: '+1 512 555 0100', address: '10 Test Street', zip: '78701', service: 'inspection', consent: true, requestId: crypto.randomUUID() }, visitor);
    const publicBody = await r.text(); assert.equal(r.status, 400);
    assert.ok(logs.some(line => line.includes('user_id is required'))); assert.ok(logs.some(line => line.includes('[email]')));
    assert.equal(logs.join(' ').includes('home@example.com'), false); assert.equal(logs.join(' ').includes('sensitive_token_value'), false);
    assert.equal(publicBody.includes('user_id is required'), false); assert.equal(publicBody.includes('home@example.com'), false);
  } finally { globalThis.fetch = originalFetch; console.error = originalError; }
});
