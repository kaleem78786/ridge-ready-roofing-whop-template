import { company } from './config.ts';
import { configuration, setting, type Bindings } from './whop.ts';

export type EmailReceipt = { status: 'accepted' | 'not_configured' | 'restricted' | 'failed'; id?: string };
export type EstimateEmail = { name: string; email: string; service: string; requestId: string; leadId: string };
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const line = (value: string) => value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
export function emailConfiguration(env: Bindings) {
  const key = setting(env, 'RESEND_API_KEY');
  const from = setting(env, 'ESTIMATE_EMAIL_FROM');
  const sandbox = configuration(env).environment === 'sandbox';
  const recipients = setting(env, 'ESTIMATE_EMAIL_TEST_RECIPIENTS').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
  return { ready: !!key && !!from && !/[\r\n]/.test(from), sender: from, sandbox, recipients };
}
export function estimateEmailContent(input: EstimateEmail) {
  const firstName = line(input.name).split(/\s+/)[0] || 'there';
  const service = input.service === 'replacement' ? 'roof replacement' : input.service === 'inspection' ? 'roof inspection' : input.service === 'repair' ? 'roof repair' : 'roofing project';
  const subject = `We got your estimate request, ${firstName}`;
  const text = `${company.name} ${company.descriptor}\n\nGot it, ${firstName} — we're on it.\n\nThanks for requesting an estimate for your ${service}. Your request has been received. Our team will review your details and contact you during business hours to discuss the next step.\n\nOffice hours: ${company.hours}\nReference: ${input.leadId}\n\nNo payment has been taken for this request. A paid inspection or project deposit is booked separately after you approve the next step.\n\n${company.name} · ${company.city}${company.demo ? '\nSample roofing business — sandbox demonstration.' : ''}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f1f4ec;font-family:Arial,sans-serif;color:#20352f"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:36px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:white;border-radius:12px;overflow:hidden"><tr><td style="padding:26px 30px;background:#1a332d;color:#d6f579;font-size:22px;font-weight:bold">${escape(company.name)}<br><span style="font-size:11px;letter-spacing:3px;color:white">${escape(company.descriptor)}</span></td></tr><tr><td style="padding:32px 30px"><p style="font-size:11px;letter-spacing:2px;color:#66726b">ESTIMATE REQUEST RECEIVED</p><h1 style="font-size:27px;line-height:1.3">Got it, ${escape(firstName)} — we're on it.</h1><p style="font-size:15px;line-height:1.8">Thanks for requesting an estimate for your ${escape(service)}. Our team will review your details and contact you during business hours to discuss the next step.</p><p style="font-size:14px;line-height:1.8"><strong>Office hours</strong><br>${escape(company.hours)}</p><p style="padding:16px;background:#edf1e7;font-size:13px;line-height:1.7">No payment has been taken for this request. A paid inspection or project deposit is booked separately after you approve the next step.</p><p style="font-size:12px;color:#66726b">Request reference: ${escape(input.leadId)}</p></td></tr><tr><td style="padding:20px 30px;border-top:1px solid #dce1d8;font-size:11px;line-height:1.8;color:#66726b">${escape(company.name)} · ${escape(company.city)}${company.demo ? '<br>Sample roofing business — sandbox demonstration.' : ''}</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
export async function sendEstimateEmail(env: Bindings, input: EstimateEmail): Promise<EmailReceipt> {
  const config = emailConfiguration(env);
  if (!config.ready) return { status: 'not_configured' };
  // Sandbox demos deliver only to explicitly listed test inboxes. Never rewrite
  // a customer's recipient to someone else's inbox or silently claim delivery.
  if (config.sandbox && !config.recipients.includes(input.email.toLowerCase())) return { status: 'restricted' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${setting(env, 'RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': `roofing-estimate/${input.requestId}` },
      body: JSON.stringify({ from: config.sender, to: [input.email], ...estimateEmailContent(input) }), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json() as { id?: unknown };
    if (response.ok && typeof result.id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(result.id)) return { status: 'accepted', id: result.id };
    console.error('Estimate confirmation email refused', response.status);
  } catch { console.error('Estimate confirmation email unavailable'); }
  return { status: 'failed' };
}
