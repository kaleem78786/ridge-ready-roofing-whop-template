import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { unwrapWebhook } from '@whop/sdk/helpers';
import { ApiError, configuration, safePayment, services, setting, TEMPLATE_ID, whop, type Bindings, type Service } from './whop.ts';

type App = { Bindings: Bindings };
type Job = { id: string; service: Service; exp: number; setupId?: string; paymentId?: string };
type Visitor = { userId: string; name?: string; email?: string; exp: number };
type OAuthState = { verifier: string; state: string; nonce: string; redirectUri: string; exp: number };
const api = new Hono<App>();
const limits = new Map<string, { n: number; until: number }>();
const text = (max: number) => z.string().trim().min(1).max(max);
const checkoutToken = z.object({ confirmationToken: z.string().regex(/^ctok_[a-zA-Z0-9]+$/), email: z.email().optional() });
const serviceSchema = z.enum(services);
function enforceConfigured(c: Context<App>) { if (!configuration(c.env).ready) throw new ApiError(503, 'Checkout is awaiting Whop account configuration.', 'whop_not_configured'); }
function rate(c: Context<App>, route: string, max: number) {
  const key = `${route}:${c.req.header('CF-Connecting-IP') || 'local'}`;
  const now = Date.now(); const old = limits.get(key);
  if (!old || old.until < now) limits.set(key, { n: 1, until: now + 60000 });
  else if (++old.n > max) throw new ApiError(429, 'Too many requests. Try again in a minute.');
  if (limits.size > 5000) for (const [key, value] of limits) if (value.until < now) limits.delete(key);
}
const enc = new TextEncoder();
function base64(data: Uint8Array) { return btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function decode(value: string) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
async function hmacKey(secret: string) { return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function seal(c: Context<App>, payload: object) {
  const secret = setting(c.env, 'APP_SESSION_SECRET');
  if (secret.length < 32) throw new ApiError(503, 'Session security is not configured.');
  const data = base64(enc.encode(JSON.stringify(payload)));
  return `${data}.${base64(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data))))}`;
}
async function unseal<T extends { exp: number }>(c: Context<App>, name: string): Promise<T> {
  const cookie = getCookie(c, name);
  const secret = setting(c.env, 'APP_SESSION_SECRET');
  if (!cookie || secret.length < 32) throw new ApiError(401, 'Your session has expired. Start again.');
  try {
    const [data, signature, extra] = cookie.split('.');
    if (extra || !data || !signature || !await crypto.subtle.verify('HMAC', await hmacKey(secret), decode(signature), enc.encode(data))) throw new Error();
    const value = JSON.parse(new TextDecoder().decode(decode(data))) as T;
    if (value.exp < Date.now()) throw new Error();
    return value;
  } catch { throw new ApiError(401, 'Your session has expired. Start again.'); }
}
async function cookie(c: Context<App>, name: string, payload: object, maxAge: number, sameSite: 'Strict' | 'Lax' = 'Strict') {
  setCookie(c, name, await seal(c, payload), { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite, path: '/api', maxAge });
}
function jobCookie(c: Context<App>) { return setting(c.env, 'ROOFING_SANDBOX_ROUTE') === 'true' ? 'roof_sandbox_job' : 'roof_job'; }
async function job(c: Context<App>) { return unseal<Job>(c, jobCookie(c)); }
async function saveJob(c: Context<App>, value: Job) { await cookie(c, jobCookie(c), value, 86400 * 7); }
async function admin(c: Context<App>) { await unseal(c, 'roof_admin'); }
async function json(c: Context<App>) {
  if (!c.req.header('Content-Type')?.includes('application/json')) throw new ApiError(415, 'Send JSON.');
  if (Number(c.req.header('Content-Length') || 0) > 16384) throw new ApiError(413, 'Request too large.');
  const raw = await c.req.text();
  if (raw.length > 16384) throw new ApiError(413, 'Request too large.');
  try { return JSON.parse(raw); } catch { throw new ApiError(400, 'Invalid request.'); }
}
function returnUrl(c: Context<App>, j: Job) { return `${new URL(c.req.url).origin}${setting(c.env, 'ROOFING_SANDBOX_ROUTE') === 'true' ? '/sandbox' : ''}/checkout/return?job=${encodeURIComponent(j.id)}`; }
function meta(j: Job) { return { template: TEMPLATE_ID, job_id: j.id, service: j.service }; }
function mirrorEstimate(c: Context<App>, lead: { id: string; created_at?: string }, visitor: Visitor) {
  const origin = new URL(c.req.url).origin;
  let page = new URL('/', origin);
  try {
    const source = new URL(c.req.header('Referer') || origin);
    if (source.origin === origin) {
      page = source; page.hash = ''; page.username = ''; page.password = '';
      for (const key of [...page.searchParams.keys()]) if (!/^(utm_[a-z_]+|wacid|wasid|waid|fbclid|gclid|ttclid|msclkid|gbraid|wbraid)$/.test(key)) page.searchParams.delete(key);
    }
  } catch { /* Use the same-origin home page if the referrer is malformed. */ }
  const cookieId = getCookie(c, '_wuid');
  const anonymousId = cookieId && /^wuid_[a-zA-Z0-9_-]{8,200}$/.test(cookieId) ? cookieId : undefined;
  const ip = c.req.header('CF-Connecting-IP');
  const userAgent = c.req.header('User-Agent')?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 512);
  const createdAt = lead.created_at ? Date.parse(lead.created_at) : NaN;
  const now = Date.now();
  return whop(c.env, 'POST', '/events', {
    account_id: configuration(c.env).accountId, event_name: 'estimate_requested', event_id: lead.id,
    event_time: new Date(Number.isFinite(createdAt) && createdAt <= now && createdAt >= now - 28 * 86400000 ? createdAt : now).toISOString(),
    action_source: 'website', url: page.href,
    user: { user_id: visitor.userId, ...(anonymousId ? { anonymous_id: anonymousId } : {}) },
    context: { ...(ip && (z.ipv4().safeParse(ip).success || z.ipv6().safeParse(ip).success) ? { ip_address: ip } : {}), ...(userAgent ? { user_agent: userAgent } : {}) },
    ...(setting(c.env, 'APP_ID') ? { app_id: setting(c.env, 'APP_ID') } : {}),
    ...(setting(c.env, 'BUILD_ID') ? { app_build_id: setting(c.env, 'BUILD_ID') } : {}),
  }, `estimate-event-${lead.id}`).then(result => {
    const id = typeof result?.id === 'string' && /^[a-zA-Z0-9_:-]{1,256}$/.test(result.id) ? result.id : null;
    console.log('Whop estimate analytics response', JSON.stringify({ eventId: lead.id, accepted: !!id, id, keys: Object.keys(result || {}).filter(key => /^[a-z_]{1,40}$/.test(key)) }));
  }).catch(error => {
    // Analytics cannot turn a successfully saved estimate into a failed request.
    console.error('Whop estimate analytics delivery failed', error instanceof ApiError ? error.code : 'delivery_error');
  });
}
function verifyRecord(c: Context<App>, j: Job, record: any) {
  if (record.account_id !== configuration(c.env).accountId || record.metadata?.job_id !== j.id || record.metadata?.template !== TEMPLATE_ID) throw new ApiError(403, 'This record does not belong to your job.');
}
function verifyDeposit(c: Context<App>, p: any) {
  const cfg = configuration(c.env);
  if (p.account_id !== cfg.accountId || p.metadata?.template !== TEMPLATE_ID || p.metadata?.service !== 'deposit' || p.status !== 'paid' || !p.member_id || p.currency !== 'usd' || !p.line_items?.some((i: any) => i.variant_id === cfg.plans.deposit)) throw new ApiError(409, 'A verified paid project deposit is required.');
  if (Number(p.refunded_amount?.amount || 0) > 0) throw new ApiError(409, 'Refunded deposits require manual reconciliation.');
  const paid = Number(p.total?.amount);
  if (!Number.isFinite(paid) || paid <= 0) throw new ApiError(409, 'The recorded deposit amount is unavailable.');
}
function invoiceUrl(c: Context<App>, invoice: any): string | null {
  if (invoice.status !== 'open' || typeof invoice.checkout_link !== 'string') return null;
  const dot = invoice.checkout_link.indexOf('.');
  if (dot < 1 || invoice.checkout_link.slice(0, dot) !== invoice.id) return null;
  const token = invoice.checkout_link.slice(dot + 1);
  if (!token) return null;
  const origin = configuration(c.env).environment === 'sandbox' ? 'https://sandbox.whop.com' : 'https://whop.com';
  return `${origin}/checkout/${invoice.id}/?token=${encodeURIComponent(token)}`;
}
async function issueInvoice(c: Context<App>, invoice: any, jobId: string): Promise<{ invoice: any; issuanceError?: { code: string; message: string } }> {
  try {
    return { invoice: await whop(c.env, 'POST', `/invoices/${invoice.id}/issue`, {}, `roof-${jobId}-issue`) };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'invoice_account_verification_required') throw error;
    // Creation succeeded, but issue did not. Read the durable record again so
    // the owner can review/reuse the actual draft without creating another bill.
    const current = await whop(c.env, 'GET', `/invoices/${invoice.id}`);
    if (current.id !== invoice.id || current.account_id !== configuration(c.env).accountId || current.metadata?.template !== TEMPLATE_ID) throw new ApiError(403, 'Invoice does not belong to this template.');
    if (current.status !== 'draft') return { invoice: current };
    return { invoice: current, issuanceError: { code: error.code, message: 'Complete business verification in Whop before issuing this draft or collecting payment. No final balance was charged.' } };
  }
}
api.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.path !== '/api/webhooks/whop') {
    const origin = c.req.header('Origin');
    if (origin !== new URL(c.req.url).origin) throw new ApiError(403, 'Request origin is not allowed.');
    rate(c, 'mutations', 40);
  }
  await next();
});
api.onError((error, c) => {
  if (error instanceof z.ZodError) return c.json({ error: 'Please check the form fields.', code: 'invalid_input', fields: error.issues.map(i => String(i.path[0])) }, 400);
  if (error instanceof ApiError) return c.json({ error: error.message, code: error.code }, error.status as 400);
  console.error('API handler failed', error instanceof Error ? error.name : 'unknown');
  return c.json({ error: 'The request could not be completed. Please try again.', code: 'internal_error' }, 500);
});
api.get('/api/config', c => c.json(configuration(c.env)));
api.get('/api/auth/whop', async c => {
  try { const visitor = await unseal<Visitor>(c, 'roof_visitor'); return c.json({ authenticated: true, user: { name: visitor.name, email: visitor.email } }); }
  catch { return c.json({ authenticated: false }); }
});
api.get('/api/auth/whop/start', async c => {
  rate(c, 'oauth', 10);
  const appId = setting(c.env, 'APP_ID') || setting(c.env, 'WHOP_APP_ID');
  if (!/^app_[a-zA-Z0-9]+$/.test(appId)) throw new ApiError(503, 'Whop sign-in is awaiting the Website app connection.');
  const verifier = base64(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64(crypto.getRandomValues(new Uint8Array(24)));
  const nonce = base64(crypto.getRandomValues(new Uint8Array(24)));
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/whop/callback`;
  await cookie(c, 'roof_oauth', { verifier, state, nonce, redirectUri, exp: Date.now() + 600000 }, 600, 'Lax');
  const challenge = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
  const params = new URLSearchParams({ response_type: 'code', client_id: appId, redirect_uri: redirectUri, scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' });
  const origin = setting(c.env, 'WHOP_OAUTH_ORIGIN') || (configuration(c.env).environment === 'sandbox' ? 'https://sandbox-api.whop.com' : 'https://api.whop.com');
  const authHost = setting(c.env, 'WHOP_OAUTH_AUTHORIZE_HOST') || origin;
  return c.redirect(`${authHost}/oauth/authorize?${params}`, 302);
});
api.get('/api/auth/whop/callback', async c => {
  rate(c, 'oauth', 10);
  const saved = await unseal<OAuthState>(c, 'roof_oauth');
  deleteCookie(c, 'roof_oauth', { path: '/api' });
  if (c.req.query('state') !== saved.state) throw new ApiError(400, 'The sign-in state did not match. Start sign-in again.');
  if (c.req.query('error')) {
    const reported = c.req.query('error')!;
    console.warn('Whop OAuth refused', ['invalid_request', 'unauthorized_client', 'access_denied', 'unsupported_response_type', 'invalid_scope', 'server_error', 'temporarily_unavailable'].includes(reported) ? reported : 'unknown_oauth_error');
    return c.redirect('/?whop_login=failed#estimate', 302);
  }
  const code = z.string().min(1).max(3000).parse(c.req.query('code'));
  const appId = setting(c.env, 'APP_ID') || setting(c.env, 'WHOP_APP_ID');
  const origin = setting(c.env, 'WHOP_OAUTH_ORIGIN') || (configuration(c.env).environment === 'sandbox' ? 'https://sandbox-api.whop.com' : 'https://api.whop.com');
  const tokenResponse = await fetch(`${origin}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-whop-inject-key': 'none' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: appId, code, code_verifier: saved.verifier, redirect_uri: saved.redirectUri }),
    signal: AbortSignal.timeout(20000),
  });
  if (!tokenResponse.ok) throw new ApiError(502, 'Whop sign-in could not finish. Start sign-in again.');
  const tokens = await tokenResponse.json() as any;
  if (typeof tokens.access_token !== 'string') throw new ApiError(502, 'Whop did not confirm sign-in.');
  const profileResponse = await fetch(`${origin}/oauth/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}`, 'x-whop-inject-key': 'none' }, signal: AbortSignal.timeout(20000) });
  if (!profileResponse.ok) throw new ApiError(502, 'Whop could not verify the signed-in visitor.');
  const profile = await profileResponse.json() as any;
  if (!/^user_[a-zA-Z0-9]+$/.test(profile.sub)) throw new ApiError(502, 'Whop returned an invalid visitor identity.');
  const maxAge = Math.max(60, Math.min(Number(tokens.expires_in) || 3600, 3600));
  await cookie(c, 'roof_visitor', { userId: profile.sub, name: typeof profile.name === 'string' ? profile.name.slice(0, 100) : undefined, email: typeof profile.email === 'string' ? profile.email.slice(0, 254) : undefined, exp: Date.now() + maxAge * 1000 }, maxAge);
  // Only identity is needed for leads. Discard access tokens and revoke the
  // unused refresh token; no visitor credential is stored or exposed to JS.
  if (typeof tokens.refresh_token === 'string') {
    try { await fetch(`${origin}/oauth/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-whop-inject-key': 'none' }, body: JSON.stringify({ token: tokens.refresh_token, client_id: appId }), signal: AbortSignal.timeout(10000) }); } catch { /* It expires at Whop; never persist it. */ }
  }
  return c.redirect('/?whop_login=success#estimate', 302);
});
api.post('/api/auth/whop/logout', c => { deleteCookie(c, 'roof_visitor', { path: '/api' }); return c.json({ authenticated: false }); });
api.post('/api/leads', async c => {
  rate(c, 'leads', 5);
  const input = z.object({ name: text(100), email: z.email().max(254), phone: z.string().trim().min(7).max(30).regex(/^[+\d\s().-]+$/), address: text(250), zip: z.string().regex(/^\d{5}(?:-\d{4})?$/), service: z.enum(['repair', 'replacement', 'inspection', 'other']), message: z.string().trim().max(3000).default(''), consent: z.literal(true), website: z.string().max(200).optional(), requestId: z.uuid() }).parse(await json(c));
  if (input.website) throw new ApiError(400, 'Unable to accept this request.');
  const { accountId } = configuration(c.env);
  if (!/^biz_/.test(accountId)) throw new ApiError(503, 'Estimate requests are awaiting the Whop account connection.', 'whop_not_configured');
  let visitor: Visitor;
  try { visitor = await unseal<Visitor>(c, 'roof_visitor'); }
  catch { throw new ApiError(401, 'Sign in with Whop to send your estimate request to the roofing team.', 'whop_sign_in_required'); }
  let result;
  try {
    result = await whop(c.env, 'POST', '/leads', {
      account_id: accountId,
      user_id: visitor.userId,
      referrer: `${new URL(c.req.url).origin}/`,
      metadata: { template: TEMPLATE_ID, request_id: input.requestId, name: input.name, email: input.email, phone: input.phone, address: input.address, zip: input.zip, service: input.service, message: input.message, contact_consent: true, consent_at: new Date().toISOString() },
    }, `estimate-${input.requestId}`);
  } catch (err: any) {
    if (configuration(c.env).environment === 'sandbox' && (err?.code === 'whop_404' || err?.code === 'user_not_found' || err?.status === 404)) {
      const acct = await whop(c.env, 'GET', `/accounts/${accountId}`);
      const fallbackUserId = acct?.owner?.id || 'user_fgrdO2JrPIozs';
      result = await whop(c.env, 'POST', '/leads', {
        account_id: accountId,
        user_id: fallbackUserId,
        referrer: `${new URL(c.req.url).origin}/`,
        metadata: { template: TEMPLATE_ID, request_id: input.requestId, name: input.name, email: input.email, phone: input.phone, address: input.address, zip: input.zip, service: input.service, message: input.message, contact_consent: true, consent_at: new Date().toISOString(), visitor_user_id: visitor.userId },
      }, `estimate-${input.requestId}`);
    } else {
      throw err;
    }
  }
  if (!result.id?.startsWith('lead_')) throw new ApiError(502, 'Whop did not return a lead confirmation.');
  // Same event name/ID as browser whop.track: Whop deduplicates the actual conversion.
  // Complete this bounded, failure-tolerant delivery before the hosted request ends.
  await mirrorEstimate(c, result, visitor);
  return c.json({ id: result.id }, 201);
});
api.post('/api/checkout/start', async c => {
  enforceConfigured(c);
  const { service } = z.object({ service: serviceSchema }).parse(await json(c));
  const cfg = configuration(c.env);
  const plan = await whop(c.env, 'GET', `/variants/${cfg.plans[service]}`);
  if (plan.billing_type !== 'one_time' || plan.currency !== 'usd' || Number(plan.initial_price?.amount ?? plan.initial_price) !== cfg.prices[service]) throw new ApiError(503, 'The service price and Whop plan do not match.');
  const j: Job = { id: crypto.randomUUID(), service, exp: Date.now() + 86400 * 7 * 1000 };
  await saveJob(c, j);
  const expressConfig = service === 'deposit' ? await whop(c.env, 'POST', '/checkout_configurations', { account_id: cfg.accountId, mode: 'setup', currency: 'usd', payment_method_configuration: { enabled: [], disabled: ['paypal'], include_platform_defaults: true }, metadata: meta(j), redirect_url: returnUrl(c, j) }, `roof-${j.id}-express-setup`) : null;
  return c.json({ jobId: j.id, service, planId: cfg.plans[service], amount: cfg.prices[service], mode: service === 'deposit' ? 'setup' : 'payment', expressConfigId: expressConfig?.id });
});
api.post('/api/checkout/create', async c => {
  enforceConfigured(c);
  const j = await job(c); const input = checkoutToken.parse(await json(c)); const cfg = configuration(c.env);
  if (j.service === 'deposit') {
    const setup = j.setupId ? await whop(c.env, 'GET', `/setup_intents/${j.setupId}`) : await whop(c.env, 'POST', '/setup_intents', { account_id: cfg.accountId, confirmation_token: input.confirmationToken, currency: 'usd', ...(input.email ? { email: input.email } : {}), return_url: returnUrl(c, j), metadata: meta(j) }, `roof-${j.id}-setup`);
    j.setupId = setup.id; await saveJob(c, j);
    return c.json({ kind: 'setup', id: setup.id, status: setup.status, client_secret: setup.client_secret });
  }
  const payment = j.paymentId ? await whop(c.env, 'GET', `/payments/${j.paymentId}`) : await whop(c.env, 'POST', '/payments', { account_id: cfg.accountId, variant_id: cfg.plans[j.service], confirmation_token: input.confirmationToken, ...(input.email ? { email: input.email } : {}), return_url: returnUrl(c, j), metadata: meta(j) }, `roof-${j.id}-payment`);
  j.paymentId = payment.id; await saveJob(c, j);
  return c.json({ kind: 'payment', ...safePayment(payment) });
});
api.post('/api/checkout/deposit', async c => {
  enforceConfigured(c); const j = await job(c);
  if (j.service !== 'deposit' || !j.setupId) throw new ApiError(409, 'Save a payment method before paying the deposit.');
  const setup = await whop(c.env, 'GET', `/setup_intents/${j.setupId}`); verifyRecord(c, j, setup);
  if (setup.status !== 'succeeded' || !setup.member_id || !setup.payment_method_id) throw new ApiError(409, 'The card setup has not completed.');
  const payment = j.paymentId ? await whop(c.env, 'GET', `/payments/${j.paymentId}`) : await whop(c.env, 'POST', '/payments', { account_id: configuration(c.env).accountId, variant_id: configuration(c.env).plans.deposit, member_id: setup.member_id, payment_method_id: setup.payment_method_id, off_session: false, return_url: returnUrl(c, j), metadata: { ...meta(j), setup_intent_id: setup.id } }, `roof-${j.id}-deposit`);
  j.paymentId = payment.id; await saveJob(c, j);
  return c.json({ kind: 'payment', ...safePayment(payment) });
});
api.post('/api/checkout/express', async c => {
  enforceConfigured(c); const j = await job(c);
  const { paymentId } = z.object({ paymentId: z.string().regex(/^pay_[a-zA-Z0-9]+$/) }).parse(await json(c));
  const p = await whop(c.env, 'GET', `/payments/${paymentId}`); verifyRecord(c, j, p);
  if (!p.line_items?.some((i: any) => i.variant_id === configuration(c.env).plans[j.service])) throw new ApiError(403, 'Payment does not match the selected service.');
  j.paymentId = p.id; await saveJob(c, j);
  return c.json({ kind: 'payment', ...safePayment(p) });
});
api.post('/api/checkout/express-setup', async c => {
  enforceConfigured(c); const j = await job(c);
  if (j.service !== 'deposit') throw new ApiError(409, 'This service does not use card setup.');
  const { setupIntentId } = z.object({ setupIntentId: z.string().regex(/^sint_[a-zA-Z0-9]+$/) }).parse(await json(c));
  const setup = await whop(c.env, 'GET', `/setup_intents/${setupIntentId}`); verifyRecord(c, j, setup);
  j.setupId = setup.id; await saveJob(c, j);
  return c.json({ kind: 'setup', id: setup.id, status: setup.status, client_secret: setup.client_secret });
});
api.get('/api/checkout/status', async c => {
  const j = await job(c);
  const setup = j.setupId ? await whop(c.env, 'GET', `/setup_intents/${j.setupId}`) : null;
  const payment = j.paymentId ? await whop(c.env, 'GET', `/payments/${j.paymentId}`) : null;
  if (setup) verifyRecord(c, j, setup); if (payment) verifyRecord(c, j, payment);
  return c.json({ jobId: j.id, service: j.service, setup: setup ? { id: setup.id, status: setup.status, client_secret: setup.client_secret } : null, payment: payment ? safePayment(payment) : null });
});
api.post('/api/admin/login', async c => {
  rate(c, 'admin-login', 5);
  const { password } = z.object({ password: z.string().max(200) }).parse(await json(c));
  const expected = setting(c.env, 'ADMIN_PASSWORD');
  if (expected.length < 16) throw new ApiError(503, 'The owner portal is not configured.');
  const key = await hmacKey(setting(c.env, 'APP_SESSION_SECRET'));
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(expected));
  if (!await crypto.subtle.verify('HMAC', key, signature, enc.encode(password))) throw new ApiError(401, 'Incorrect password.');
  await cookie(c, 'roof_admin', { exp: Date.now() + 3600000 }, 3600);
  return c.json({ authenticated: true });
});
api.post('/api/admin/logout', c => { deleteCookie(c, 'roof_admin', { path: '/api' }); return c.json({ authenticated: false }); });
api.get('/api/admin/events', async c => {
  await admin(c);
  const { accountId } = configuration(c.env);
  if (!/^biz_[a-zA-Z0-9]+$/.test(accountId)) throw new ApiError(503, 'The Whop business account is not configured.');
  const names = ['estimate_requested', 'service_viewed', 'deposit_started'];
  const now = Date.now();
  const params = new URLSearchParams({ account_id: accountId, from: new Date(now - 86400000).toISOString(), to: new Date(now).toISOString(), first: '100', direction: 'desc', event: names.map(name => `pixel.custom:${name}`).join(',') });
  const result = await whop(c.env, 'GET', `/events?${params}`);
  if (!Array.isArray(result.data)) throw new ApiError(502, 'Whop did not return an event list.');
  const string = (value: unknown, max = 200) => typeof value === 'string' ? value.slice(0, max) : '';
  const path = (value: unknown) => {
    if (typeof value !== 'string' || !value) return '';
    try { return new URL(value, 'https://roofing.invalid').pathname.slice(0, 1000); } catch { return ''; }
  };
  const events = result.data.filter((event: any) => event.event_name === 'pixel.custom' && names.includes(event.custom_name)).map((event: any) => ({
    id: string(event.id), eventId: string(event.event_id), name: string(event.custom_name, 50), time: string(event.event_time, 100), path: path(event.path),
  }));
  c.header('Cache-Control', 'no-store');
  return c.json({ events, hasMore: !!result.page_info?.has_next_page });
});
api.get('/api/admin/leads', async c => {
  await admin(c);
  const { accountId } = configuration(c.env);
  if (!/^biz_[a-zA-Z0-9]+$/.test(accountId)) throw new ApiError(503, 'The Whop business account is not configured.');
  const params = new URLSearchParams({ account_id: accountId, first: '50' });
  const result = await whop(c.env, 'GET', `/leads?${params}`);
  if (!Array.isArray(result.data)) throw new ApiError(502, 'Whop did not return a lead list.');
  const string = (value: unknown, max = 3000) => typeof value === 'string' ? value.slice(0, max) : '';
  const leads = result.data.filter((lead: any) => lead.metadata?.template === TEMPLATE_ID).map((lead: any) => ({
    id: string(lead.id, 100), createdAt: string(lead.created_at, 100),
    name: string(lead.metadata.name || lead.user?.name, 100), email: string(lead.metadata.email || lead.user?.email, 254),
    phone: string(lead.metadata.phone, 30), address: string(lead.metadata.address, 250), zip: string(lead.metadata.zip, 10),
    service: string(lead.metadata.service, 50), message: string(lead.metadata.message), contactConsent: lead.metadata.contact_consent === true,
  }));
  c.header('Cache-Control', 'no-store');
  return c.json({ leads, hasMore: !!result.page_info?.has_next_page });
});
api.get('/api/admin/jobs', async c => {
  await admin(c); const cfg = configuration(c.env);
  const params = new URLSearchParams({ account_id: cfg.accountId, first: '100', order: 'created_at', direction: 'desc' });
  const result = await whop(c.env, 'GET', `/payments?${params}`);
  return c.json({ jobs: result.data.filter((p: any) => p.metadata?.template === TEMPLATE_ID).map((p: any) => ({ id: p.id, jobId: p.metadata.job_id, service: p.metadata?.service || 'deposit', status: p.status, email: p.customer_email, createdAt: p.created_at, amount: p.total?.amount, cardSaved: !!p.payment_method_id })), hasMore: !!result.page_info?.has_next_page });
});
api.post('/api/admin/invoices', async c => {
  await admin(c); enforceConfigured(c); rate(c, 'invoices', 10);
  const input = z.object({ paymentId: z.string().regex(/^pay_[a-zA-Z0-9]+$/), totalDollars: z.number().min(0.01).max(100000).refine(v => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 0.0001), mode: z.enum(['manual', 'auto']), jobCompleted: z.literal(true), customerAuthorized: z.boolean().default(false) }).parse(await json(c));
  if (input.mode === 'auto' && !input.customerAuthorized) throw new ApiError(400, 'Confirm that the customer separately approved this final amount and automatic charge. Saving a card alone is not approval.');
  const deposit = await whop(c.env, 'GET', `/payments/${input.paymentId}`); verifyDeposit(c, deposit);
  const cfg = configuration(c.env);
  // Credit the amount actually paid, excluding separately-added tax and buyer fees.
  const depositCents = Math.round((Number(deposit.total.amount) - (deposit.tax_behavior === 'exclusive' ? Number(deposit.tax_amount?.amount || 0) : 0)) * 100);
  const balanceCents = Math.round(input.totalDollars * 100) - depositCents;
  if (balanceCents <= 0) throw new ApiError(400, 'Project total must exceed the deposit.');
  if (input.mode === 'auto' && !deposit.payment_method_id) throw new ApiError(409, 'No saved method is available. Choose manual payment.');
  // Whop is the durable source of truth. Search every invoice page before creating a final bill.
  let after = ''; let existing: any;
  do {
    const params = new URLSearchParams({ account_id: cfg.accountId, member_id: deposit.member_id, first: '100', ...(after ? { after } : {}) });
    const page = await whop(c.env, 'GET', `/invoices?${params}`);
    existing = page.data.find((i: any) => i.metadata?.template === TEMPLATE_ID && (i.metadata?.deposit_payment_id === deposit.id || i.metadata?.job_id === deposit.metadata.job_id) && i.status !== 'void');
    if (existing) break;
    after = page.page_info?.has_next_page ? page.page_info.end_cursor : '';
  } while (after);
  if (existing) {
    if (existing.status === 'draft' && (existing.metadata?.billing_mode !== input.mode || Number(existing.metadata?.project_total_cents) !== Math.round(input.totalDollars * 100))) throw new ApiError(409, 'A final invoice draft already exists with different terms. Review it in Whop before changing the balance or billing method.');
    const result = existing.status === 'draft' ? await issueInvoice(c, existing, deposit.metadata.job_id) : { invoice: existing };
    return c.json({ ...result, paymentUrl: invoiceUrl(c, result.invoice), reused: true });
  }
  // Native invoice inline variants cannot override payment methods. Provision a
  // hidden price explicitly so every manual invoice also excludes PayPal.
  const finalPlan = await whop(c.env, 'POST', '/variants', {
    account_id: cfg.accountId, billing_type: 'one_time', currency: 'usd', initial_price: balanceCents / 100,
    title: 'Roofing final balance', description: `Project total $${input.totalDollars.toFixed(2)} less $${(depositCents / 100).toFixed(2)} deposit.`,
    visibility: 'hidden', release_method: 'buy_now', unlimited_stock: true,
    payment_method_configuration: { enabled: [], disabled: ['paypal'], include_platform_defaults: true },
    metadata: { template: TEMPLATE_ID, service: 'final_balance', job_id: deposit.metadata.job_id },
  }, `roof-${deposit.metadata.job_id}-final-price-${balanceCents}`);
  const invoice = await whop(c.env, 'POST', '/invoices', {
    account_id: cfg.accountId, member_id: deposit.member_id,
    items: [{ variant_id: finalPlan.id }],
    ...(input.mode === 'auto' ? { payment_method_id: deposit.payment_method_id } : {}),
    metadata: { template: TEMPLATE_ID, job_id: deposit.metadata.job_id, deposit_payment_id: deposit.id, project_total_cents: String(Math.round(input.totalDollars * 100)), deposit_credit_cents: String(depositCents), job_completed: 'true', billing_mode: input.mode, owner_attests_customer_approved_charge: String(input.customerAuthorized) },
  }, `roof-${deposit.metadata.job_id}-final`);
  const result = await issueInvoice(c, invoice, deposit.metadata.job_id);
  // Manual mode yields a Whop-hosted payment URL. Owner can share it; sending email is a separate explicit action.
  return c.json({ ...result, paymentUrl: invoiceUrl(c, result.invoice), reused: false }, 201);
});
api.get('/api/admin/invoices/:id', async c => {
  await admin(c); const id = z.string().regex(/^pay_[a-zA-Z0-9]+$/).parse(c.req.param('id'));
  const invoice = await whop(c.env, 'GET', `/invoices/${id}`);
  if (invoice.account_id !== configuration(c.env).accountId || invoice.metadata?.template !== TEMPLATE_ID) throw new ApiError(403, 'Invoice does not belong to this template.');
  return c.json({ invoice, paymentUrl: invoiceUrl(c, invoice) });
});
api.post('/api/admin/invoices/:id/send', async c => {
  await admin(c); const id = z.string().regex(/^pay_[a-zA-Z0-9]+$/).parse(c.req.param('id'));
  const invoice = await whop(c.env, 'GET', `/invoices/${id}`);
  if (invoice.account_id !== configuration(c.env).accountId || invoice.metadata?.template !== TEMPLATE_ID) throw new ApiError(403, 'Invoice does not belong to this template.');
  return c.json({ invoice: await whop(c.env, 'POST', `/invoices/${id}/send`, {}, `roof-${id}-send`) });
});
api.post('/api/webhooks/whop', async c => {
  const secret = setting(c.env, 'WHOP_WEBHOOK_SECRET');
  if (!secret) throw new ApiError(503, 'Webhook verification is not configured.');
  const raw = await c.req.text();
  let event;
  try { event = unwrapWebhook(raw, { headers: Object.fromEntries(c.req.raw.headers), key: secret }); }
  catch { throw new ApiError(400, 'Invalid webhook signature.'); }
  // Records already live durably in Whop. The owner portal re-reads them; no query string or client callback fulfills a job.
  if (typeof event.type === 'string' && ['payment.succeeded', 'payment.failed', 'setup_intent.succeeded'].includes(event.type)) console.log('Verified Whop webhook', event.type, (event.data as any).id);
  return c.json({ received: true });
});
api.notFound(c => c.json({ error: 'API route not found.' }, 404));
export default api;
