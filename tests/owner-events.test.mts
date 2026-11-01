import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/api.ts';

const env = { WHOP_ENVIRONMENT: 'sandbox', WHOP_API_KEY: 'test-only-key', WHOP_ACCOUNT_ID: 'biz_test', APP_SESSION_SECRET: 'a-test-session-secret-at-least-32-characters', ADMIN_PASSWORD: 'test-owner-password-long-enough' };
function request(path: string, body?: object, cookie = '') {
  return api.request(`https://roof.test/api${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: 'https://roof.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
}
test('event ingestion read-back requires a verified owner session before requesting Whop', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No event data without owner authentication'); };
  try {
    assert.equal((await request('/admin/events')).status, 401);
    assert.equal((await request('/admin/events', undefined, 'roof_admin=forged.session')).status, 401);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
test('owner event query requests all three custom names for one account and projects no personal fields', async () => {
  const login = await request('/admin/login', { password: env.ADMIN_PASSWORD });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v1/events'); assert.equal(init?.method, 'GET');
    assert.equal(url.searchParams.get('account_id'), 'biz_test'); assert.equal(url.searchParams.get('first'), '100');
    assert.equal(url.searchParams.get('event'), 'pixel.custom:estimate_requested,pixel.custom:service_viewed,pixel.custom:deposit_started');
    const from = Date.parse(url.searchParams.get('from')!); const to = Date.parse(url.searchParams.get('to')!);
    assert.equal(to - from, 86400000); assert.ok(Math.abs(Date.now() - to) < 5000);
    return new Response(JSON.stringify({ data: [
      ...['estimate_requested', 'service_viewed', 'deposit_started'].map((name, i) => ({ id: `record${i}`, event_id: `event${i}`, event_name: 'pixel.custom', custom_name: name, event_time: '2026-11-01T00:00:00Z', path: '/?email=private@example.com#token', person_id: 'prsn_private', user: { email: 'private@example.com', phone: '+15551234567' }, context: { utm_content: 'private-campaign' }, url: 'https://roof.test/?private=secret' })),
      { id: 'unrelated', event_name: 'pixel.custom', custom_name: 'other_custom_event' },
      { id: 'not_custom', event_name: 'payment.completed', custom_name: 'service_viewed' },
    ], page_info: { has_next_page: true } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await request('/admin/events', undefined, cookie);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const text = await response.text(); const result = JSON.parse(text);
    assert.equal(result.hasMore, true); assert.equal(result.events.length, 3);
    assert.deepEqual(result.events.map((event: any) => event.name), ['estimate_requested', 'service_viewed', 'deposit_started']);
    assert.deepEqual(Object.keys(result.events[0]).sort(), ['eventId', 'id', 'name', 'path', 'time']);
    assert.equal(result.events[0].path, '/');
    for (const privateValue of ['private@example.com', '+15551234567', 'prsn_private', 'private-campaign', 'secret', 'other_custom_event']) assert.equal(text.includes(privateValue), false);
  } finally { globalThis.fetch = original; }
});
