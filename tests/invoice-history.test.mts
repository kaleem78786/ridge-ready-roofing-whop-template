import {test} from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/api.ts';
const env={WHOP_ENVIRONMENT:'sandbox',WHOP_API_KEY:'test-key',WHOP_ACCOUNT_ID:'biz_test',APP_SESSION_SECRET:'test-session-secret-at-least-32-characters',ADMIN_PASSWORD:'test-owner-password-long-enough'};
const request=(path:string, cookie='')=>api.request(`https://roof.test/api${path}`,{headers:{Cookie:cookie}},env);
test('invoice history is owner-only, account-scoped and excludes payment secrets',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async input=>{calls++;const url=new URL(String(input));assert.equal(url.searchParams.get('account_id'),'biz_test');assert.equal(url.searchParams.get('first'),'50');return Response.json({data:[{id:'pay_final',account_id:'biz_test',number:'#00000002',status:'open',total:{amount:'8000.00'},amount_due:{amount:'8000.00'},checkout_link:'pay_final.signature',client_secret:'private',payment_method_id:'payt_private',metadata:{template:'ridgeway-roofing-v1',job_id:'job1',project_total_cents:'850000',deposit_credit_cents:'50000'}},{id:'pay_other',account_id:'biz_other',metadata:{template:'ridgeway-roofing-v1'}},{id:'pay_unrelated',account_id:'biz_test',metadata:{template:'another-app'}}],page_info:{}});};
 try{
  assert.equal((await request('/admin/invoices')).status,401);assert.equal(calls,0);
  const login=await api.request('https://roof.test/api/admin/login',{method:'POST',headers:{Origin:'https://roof.test','Content-Type':'application/json'},body:JSON.stringify({password:env.ADMIN_PASSWORD})},env);
  const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const r=await request('/admin/invoices',cookie);const raw=await r.text();const d=JSON.parse(raw);assert.equal(r.status,200);assert.equal(d.invoices.length,1);assert.equal(d.invoices[0].projectTotal,8500);assert.equal(d.invoices[0].depositCredit,500);assert.equal(d.invoices[0].amount,'8000.00');assert.equal(d.invoices[0].paymentUrl,'https://sandbox.whop.com/checkout/pay_final/?token=signature');assert.equal(raw.includes('private'),false);
 }finally{globalThis.fetch=original;}
});
