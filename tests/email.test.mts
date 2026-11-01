import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendEstimateEmail,estimateEmailContent} from '../src/email.ts';
const env={WHOP_ENVIRONMENT:'sandbox',RESEND_API_KEY:'test-email-key',ESTIMATE_EMAIL_FROM:'Ridge & Ready <estimates@roofing.test>',ESTIMATE_EMAIL_TEST_RECIPIENTS:'home@example.com'};
const input={name:'Alex Demo',email:'home@example.com',service:'replacement',requestId:'69b4439a-9950-4ec5-bc42-bd24a8ae6eca',leadId:'lead_real'};
test('missing sender credentials and unlisted sandbox recipients cannot send mail',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Mail must not be attempted');};
 try{
  assert.deepEqual(await sendEstimateEmail({...env,RESEND_API_KEY:''},input),{status:'not_configured'});
  assert.deepEqual(await sendEstimateEmail(env,{...input,email:'other@example.com'}),{status:'restricted'});
  assert.deepEqual(await sendEstimateEmail({...env,ESTIMATE_EMAIL_TEST_RECIPIENTS:''},input),{status:'restricted'});
 }finally{globalThis.fetch=original;}
});
test('receipt uses the real recipient, branded content and a stable request idempotency key',async()=>{
 const original=globalThis.fetch;const keys:string[]=[];
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'https://api.resend.com/emails');const h=new Headers(init?.headers);keys.push(h.get('Idempotency-Key')!);
  assert.equal(h.get('Authorization'),'Bearer test-email-key');const body=JSON.parse(String(init?.body));assert.deepEqual(body.to,['home@example.com']);assert.match(body.subject,/Alex/);assert.match(body.html,/Ridge &amp; Ready/);assert.match(body.text,/lead_real/);assert.equal(body.bcc,undefined);
  return Response.json({id:'mail_reference_1234'});
 };
 try{for(let i=0;i<2;i++)assert.deepEqual(await sendEstimateEmail(env,input),{status:'accepted',id:'mail_reference_1234'});assert.deepEqual(keys,[`roofing-estimate/${input.requestId}`,`roofing-estimate/${input.requestId}`]);}
 finally{globalThis.fetch=original;}
});
test('provider refusals and transport failures never fabricate an email success',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({message:'private-provider-detail'},{status:403});assert.deepEqual(await sendEstimateEmail(env,input),{status:'failed'});
  globalThis.fetch=async()=>{throw Error('unavailable')};assert.deepEqual(await sendEstimateEmail(env,input),{status:'failed'});
  globalThis.fetch=async()=>Response.json({});assert.deepEqual(await sendEstimateEmail(env,input),{status:'failed'});
 }finally{globalThis.fetch=original;}
});
test('customer content is escaped in HTML and cannot inject subject headers',()=>{
 const c=estimateEmailContent({...input,name:'<script>\nBcc: injected@example.com'});assert.equal(c.subject.includes('\n'),false);assert.equal(c.html.includes('<script>'),false);assert.match(c.html,/&lt;script&gt;/);
});
