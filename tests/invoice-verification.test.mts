import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/api.ts';

const env = { WHOP_ENVIRONMENT: 'sandbox', WHOP_API_KEY: 'test-only-key', WHOP_ACCOUNT_ID: 'biz_test', WHOP_INSPECTION_PLAN_ID: 'plan_inspection', WHOP_DEPOSIT_PLAN_ID: 'plan_deposit', WHOP_REPAIR_PLAN_ID: 'plan_repair', APP_SESSION_SECRET: 'a-test-session-secret-at-least-32-characters', ADMIN_PASSWORD: 'test-owner-password-long-enough' };
let sequence = 0;
function request(path: string, body: object, cookie = '') {
  return api.request(`https://roof.test/api${path}`, { method: 'POST', headers: { Origin: 'https://roof.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': `verification-${sequence++}`, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }, env);
}
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }

test('verification-blocked final invoices return and reuse the verified draft without a charge', async () => {
  const login = await request('/admin/login', { password: env.ADMIN_PASSWORD });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const original = globalThis.fetch;
  try {
    for (const mode of ['manual', 'auto']) {
      let draft: any; let creates = 0; let priceCreates = 0; let issueAttempts = 0; let readBacks = 0;
      globalThis.fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === 'GET' && path === '/api/v1/payments/pay_deposit') return response({ id: 'pay_deposit', account_id: 'biz_test', metadata: { template: 'ridgeway-roofing-v1', service: 'deposit', job_id: `job-${mode}` }, status: 'paid', member_id: 'mber_customer', payment_method_id: 'payt_saved', currency: 'usd', line_items: [{ variant_id: 'plan_deposit' }], total: { amount: '500' } });
        if (init?.method === 'GET' && path === '/api/v1/invoices') return response({ data: draft ? [draft] : [], page_info: {} });
        if (init?.method === 'GET' && path === '/api/v1/invoices/pay_draft') { readBacks++; return response(draft); }
        if (init?.method === 'POST' && path === '/api/v1/variants') { priceCreates++; return response({ id: 'plan_final' }, 201); }
        if (init?.method === 'POST' && path === '/api/v1/invoices') {
          creates++; const body = JSON.parse(String(init.body));
          assert.equal(body.payment_method_id, mode === 'auto' ? 'payt_saved' : undefined);
          draft = { id: 'pay_draft', status: 'draft', account_id: 'biz_test', metadata: body.metadata, amount_due: { amount: '8000.00' } };
          return response(draft, 201);
        }
        if (init?.method === 'POST' && path === '/api/v1/invoices/pay_draft/issue') {
          issueAttempts++;
          return response({ error: { code: 'invoice_account_verification_required', message: 'Business verification required' } }, 400);
        }
        throw new Error(`Unexpected request, including any charge or send: ${init?.method} ${path}`);
      };
      const input = { paymentId: 'pay_deposit', totalDollars: 8500, mode, jobCompleted: true, customerAuthorized: mode === 'auto' };
      const created = await request('/admin/invoices', input, cookie); const first = await created.json() as any;
      assert.equal(created.status, 201); assert.equal(first.invoice.id, 'pay_draft'); assert.equal(first.invoice.status, 'draft');
      assert.equal(first.paymentUrl, null); assert.equal(first.reused, false); assert.equal(first.issuanceError.code, 'invoice_account_verification_required');
      assert.match(first.issuanceError.message, /No final balance was charged/);
      const retried = await request('/admin/invoices', input, cookie); const second = await retried.json() as any;
      assert.equal(retried.status, 200); assert.equal(second.invoice.id, first.invoice.id); assert.equal(second.invoice.status, 'draft');
      assert.equal(second.reused, true); assert.equal(second.paymentUrl, null); assert.equal(second.issuanceError.code, 'invoice_account_verification_required');
      assert.equal(creates, 1); assert.equal(priceCreates, 1); assert.equal(issueAttempts, 2); assert.equal(readBacks, 2);
    }
  } finally { globalThis.fetch = original; }
});
test('invoice issue failures other than business verification remain failures', async () => {
  const login = await request('/admin/login', { password: env.ADMIN_PASSWORD });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/v1/payments/pay_deposit') return response({ id: 'pay_deposit', account_id: 'biz_test', metadata: { template: 'ridgeway-roofing-v1', service: 'deposit', job_id: 'job-other-error' }, status: 'paid', member_id: 'mber_customer', currency: 'usd', line_items: [{ variant_id: 'plan_deposit' }], total: { amount: '500' } });
    if (init?.method === 'GET') return response({ data: [], page_info: {} });
    if (path === '/api/v1/variants') return response({ id: 'plan_final' });
    if (path.endsWith('/issue')) return response({ error: { code: 'different_issue_error' } }, 409);
    return response({ id: 'pay_draft', status: 'draft' }, 201);
  };
  try {
    const result = await request('/admin/invoices', { paymentId: 'pay_deposit', totalDollars: 8500, mode: 'manual', jobCompleted: true }, cookie);
    const body = await result.json() as any;
    assert.equal(result.status, 409); assert.equal(body.code, 'different_issue_error'); assert.equal(body.invoice, undefined); assert.equal(body.issuanceError, undefined);
  } finally { globalThis.fetch = original; }
});
