#!/usr/bin/env node
// Creates catalog resources only. Never charges, invoices, emails or stores a secret.
import { company } from '../src/config.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const environment = process.env.WHOP_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
const accountId = process.env.WHOP_ACCOUNT_ID;
const token = process.env.WHOP_API_KEY;
const cliMode = process.argv.includes('--cli');
if ((!token && !cliMode) || !/^biz_[a-zA-Z0-9]+$/.test(accountId || '')) throw new Error('Set WHOP_ACCOUNT_ID and either WHOP_API_KEY or use --cli after signing in. Credentials are never printed.');
if (cliMode && environment !== 'production') throw new Error('--cli uses the signed-in production account. Use a sandbox API key for sandbox provisioning.');
const origin = environment === 'sandbox' ? 'https://sandbox-api.whop.com' : 'https://api.whop.com';
const template = 'ridgeway-roofing-v1';
async function api(method, path, body, key) {
  if (cliMode) {
    const parsed = new URL(path, origin);
    const [resource, id] = parsed.pathname.slice(1).split('/');
    if (!['products', 'variants'].includes(resource) || !['GET', 'POST', 'PATCH'].includes(method)) throw new Error('Unsupported catalog operation.');
    const args = [resource, method === 'GET' ? 'list' : method === 'POST' ? 'create' : 'update', ...(id ? [id] : []), '--format', 'json'];
    for (const [name, value] of Object.entries(body || Object.fromEntries(parsed.searchParams))) {
      if (value === undefined) continue;
      if (typeof value === 'boolean') args.push(value ? `--${name}` : `--no-${name}`);
      else args.push(`--${name}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    if (key) args.push('--idempotency-key', key);
    const result = spawnSync(fileURLToPath(new URL('../node_modules/.bin/whop', import.meta.url)), args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) {
      let code = '';
      try { const failure = JSON.parse(result.stdout); code = failure.error?.code || failure.error?.type || failure.code || ''; } catch {}
      throw new Error(`Whop CLI ${resource} ${args[1]} failed (${code || result.error?.code || result.signal || result.status}). Check CLI sign-in and account permissions.`);
    }
    try { return JSON.parse(result.stdout); } catch { throw new Error('Whop CLI did not return JSON.'); }
  }
  const response = await fetch(`${origin}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Api-Version-Date': '2026-10-29-8', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Whop ${response.status}: ${data.error?.code || data.error?.type || 'request refused'}`);
  return data;
}
async function all(path) {
  const output = []; let after = '';
  do { const page = await api('GET', `${path}${path.includes('?') ? '&' : '?'}first=100${after ? `&after=${encodeURIComponent(after)}` : ''}`); output.push(...page.data); after = page.page_info?.has_next_page ? page.page_info.end_cursor : ''; } while (after);
  return output;
}
const brand = process.env.ROOFING_COMPANY_NAME || company.name;
const catalog = company.services.map(service => ({
  key: service.id,
  title: service.id === 'deposit' ? `${service.name} deposit` : service.name,
  price: Number(process.env[`WHOP_${service.id.toUpperCase()}_PRICE`] || service.price),
  description: `${service.description} Includes: ${service.includes.join('; ')}.${service.id === 'deposit' ? ' Scheduling and refund terms follow the signed agreement.' : ''}`,
}));
const products = await all(`/products?account_id=${accountId}`);
const plans = await all(`/variants?account_id=${accountId}`);
console.log(`# ${environment} catalog for ${brand}; no money was charged.`);
console.log(`WHOP_ENVIRONMENT=${environment}\nWHOP_ACCOUNT_ID=${accountId}`);
const publicResult = { environment, accountId, plans: {}, products: {}, prices: {} };
const outputIndex = process.argv.indexOf('--output');
const saveResult = () => { if (outputIndex !== -1) writeFileSync(process.argv[outputIndex + 1], `${JSON.stringify(publicResult, null, 2)}\n`); };
for (const service of catalog) {
  if (!Number.isFinite(service.price) || service.price < 1) throw new Error(`Invalid ${service.key} price.`);
  let product = products.find(p => p.metadata?.template === template && p.metadata?.service === service.key);
  if (!product) product = await api('POST', '/products', { account_id: accountId, title: `${brand}: ${service.title}`.slice(0, 80), description: service.description, visibility: 'hidden', send_welcome_message: false, global_affiliate_status: 'disabled', member_affiliate_status: 'disabled', metadata: { template, service: service.key } }, `${template}-${service.key}-product`);
  else if (product.title !== `${brand}: ${service.title}`.slice(0, 80) || product.description !== service.description) product = await api('PATCH', `/products/${product.id}`, { title: `${brand}: ${service.title}`.slice(0, 80), description: service.description });
  let plan = plans.find(p => p.product_id === product.id && p.billing_type === 'one_time' && p.currency === 'usd' && Number(p.initial_price?.amount ?? p.initial_price) === service.price);
  if (!plan) plan = await api('POST', '/variants', { account_id: accountId, product_id: product.id, title: service.title.slice(0, 30), description: service.description, billing_type: 'one_time', initial_price: service.price, currency: 'usd', release_method: 'buy_now', visibility: 'visible', unlimited_stock: true, metadata: { template, service: service.key }, payment_method_configuration: { enabled: [], disabled: ['paypal'], include_platform_defaults: true } }, `${template}-${service.key}-${service.price}-plan`);
  console.log(`WHOP_${service.key.toUpperCase()}_PLAN_ID=${plan.id}\nWHOP_${service.key.toUpperCase()}_PRICE=${service.price}`);
  publicResult.plans[service.key] = plan.id;
  publicResult.products[service.key] = product.id;
  publicResult.prices[service.key] = service.price;
  saveResult();
}
