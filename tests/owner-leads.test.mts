import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/api.ts';

const env = { WHOP_ENVIRONMENT: 'sandbox', WHOP_API_KEY: 'test-only-key', WHOP_ACCOUNT_ID: 'biz_test', APP_SESSION_SECRET: 'a-test-session-secret-at-least-32-characters', ADMIN_PASSWORD: 'test-owner-password-long-enough' };
function request(path: string, body?: object, cookie = '') {
  return api.request(`https://roof.test/api${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: 'https://roof.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
}
test('lead read-back rejects missing or forged owner sessions before requesting private data', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Private data must not be requested'); };
  try {
    assert.equal((await request('/admin/leads')).status, 401);
    assert.equal((await request('/admin/leads', undefined, 'roof_admin=forged.session')).status, 401);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
test('owner reads only template leads from a bounded, account-scoped Whop list', async () => {
  const login = await request('/admin/login', { password: env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://sandbox-api.whop.com'); assert.equal(url.pathname, '/api/v1/leads');
    assert.equal(url.searchParams.get('account_id'), 'biz_test'); assert.equal(url.searchParams.get('first'), '50');
    assert.equal(init?.method, 'GET');
    return new Response(JSON.stringify({ data: [
      { id: 'lead_template', created_at: '2026-11-01T00:00:00Z', metadata: { template: 'ridgeway-roofing-v1', name: 'Homeowner', email: 'home@example.com', service: 'inspection', contact_consent: true, internal_note: 'omit-me' } },
      { id: 'lead_unrelated', metadata: { template: 'another-template', email: 'unrelated@example.com' } },
    ], page_info: { has_next_page: true } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await request('/admin/leads', undefined, cookie);
    assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'no-store');
    const body = await result.json() as any;
    assert.equal(body.hasMore, true); assert.equal(body.leads.length, 1); assert.equal(body.leads[0].id, 'lead_template');
    assert.equal(body.leads[0].email, 'home@example.com'); assert.equal(body.leads[0].contactConsent, true);
    assert.equal(JSON.stringify(body).includes('unrelated@example.com'), false); assert.equal(JSON.stringify(body).includes('omit-me'), false);
  } finally { globalThis.fetch = original; }
});
