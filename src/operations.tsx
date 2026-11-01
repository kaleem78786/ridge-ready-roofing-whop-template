import React, { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, CheckCircle2, LockKeyhole, RefreshCw } from 'lucide-react';
import { api, type PixelEvent } from './lib';
import { company } from './config';

type Config = { ready: boolean; environment: string; missing: string[]; plans: Record<string, string> };
type Job = { id: string; jobId: string; status: string; email?: string; createdAt: string; amount: string | number; cardSaved: boolean };
type Lead = { id: string; createdAt: string; name: string; email: string; phone: string; address: string; zip: string; service: string; message: string; contactConsent: boolean };
type ReceivedEvent = { id: string; eventId: string; name: string; time: string; path: string };
type InvoiceResult = { invoice: { id: string; status: string; amount_due?: { amount: string | number }; scheduled_charge_at?: string | null }; paymentUrl?: string | null; reused: boolean; issuanceError?: { code: string; message: string } };
const dollars = (value: string | number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
function verifiedUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (url.hostname === 'whop.com' || url.hostname.endsWith('.whop.com')) return url.href;
  } catch { /* An unverified link is never rendered. */ }
  return null;
}

export function Operations() {
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState('');
  const [events, setEvents] = useState<PixelEvent[]>(window.__roofingEvents || []);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsHasMore, setLeadsHasMore] = useState(false);
  const [receivedEvents, setReceivedEvents] = useState<ReceivedEvent[]>([]);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [total, setTotal] = useState('');
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [jobCompleted, setJobCompleted] = useState(false);
  const [customerAuthorized, setCustomerAuthorized] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<InvoiceResult | null>(null);

  async function loadJobs() {
    const data = await api<{ jobs: Job[]; hasMore: boolean }>('admin/jobs');
    setJobs(data.jobs);
    setHasMore(data.hasMore);
    setAuthenticated(true);
    return data;
  }
  async function refresh() {
    setBusy('refresh'); setError('');
    try { await Promise.all([loadJobs(), loadLeads(), loadReceivedEvents()]); } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }
  async function loadLeads() {
    const data = await api<{ leads: Lead[]; hasMore: boolean }>('admin/leads');
    setLeads(data.leads); setLeadsHasMore(data.hasMore); setAuthenticated(true);
  }
  async function loadReceivedEvents() {
    try {
      const data = await api<{ events: ReceivedEvent[]; hasMore: boolean }>('admin/events');
      setReceivedEvents(data.events); setEventsHasMore(data.hasMore); setEventsError('');
    } catch (error) { setEventsError(errorMessage(error)); }
  }
  async function refreshReceivedEvents() {
    setBusy('events'); await loadReceivedEvents(); setBusy('');
  }
  useEffect(() => {
    api<Config>('config').then(setConfig).catch(error => setConfigError(errorMessage(error)));
    Promise.all([loadJobs(), loadLeads(), loadReceivedEvents()]).catch(() => { /* An absent owner session displays the login form. */ });
    const update = () => setEvents([...(window.__roofingEvents || [])]);
    window.addEventListener('roofing:pixel', update);
    return () => window.removeEventListener('roofing:pixel', update);
  }, []);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy('login'); setError('');
    try {
      await api('admin/login', { password });
      setPassword(''); setAuthenticated(true); await Promise.all([loadJobs(), loadLeads(), loadReceivedEvents()]);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }
  async function logout() {
    setBusy('logout'); setError('');
    try {
      await api('admin/logout', {}); setAuthenticated(false); setJobs([]); setLeads([]); setReceivedEvents([]); setResult(null); setPaymentId('');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }
  async function createInvoice(event: FormEvent) {
    event.preventDefault(); setBusy('invoice'); setError(''); setResult(null);
    try {
      const data = await api<InvoiceResult>('admin/invoices', {
        paymentId, totalDollars: Number(total), mode, jobCompleted,
        ...(mode === 'auto' ? { customerAuthorized } : {}),
      });
      if (!data.invoice?.id || !data.invoice.status) throw new Error('Whop did not return a verified invoice. Check the owner account before retrying.');
      setResult(data);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }
  const selected = jobs.find(job => job.id === paymentId);
  const paidJobs = jobs.filter(job => job.status === 'paid');
  const balance = selected && total ? Number(total) - Number(selected.amount) : null;
  const paymentUrl = verifiedUrl(result?.paymentUrl);

  return <main className="container portal">
    <a className="text-link" href="/"><ArrowLeft size={16} /> Back to {company.name}</a>
    <h1>Project & payment desk</h1>
    <p>Review estimate requests and deposits, then bill the remaining balance after the work is complete.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!authenticated ? <section className="portal-panel">
      <h2><LockKeyhole size={20} /> Owner sign in</h2>
      <p>Use the owner password configured for this website.</p>
      <form onSubmit={login}>
        <label>Owner password<input type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button className="button dark" disabled={!!busy}>{busy === 'login' ? 'Signing in…' : 'Sign in securely'} <ArrowUpRight size={17} /></button>
      </form>
    </section> : <>
      <section className="portal-panel">
        <div className="portal-actions"><h2>Estimate requests</h2><button className="text-link" onClick={refresh} disabled={!!busy}><RefreshCw size={14} /> {busy === 'refresh' ? 'Refreshing…' : 'Refresh records'}</button></div>
        <p>These requests are read back from the connected Whop account. Only leads created by this template are shown.</p>
        {leads.length ? <table><thead><tr><th scope="col">Whop lead / received</th><th scope="col">Customer</th><th scope="col">Property</th><th scope="col">Request</th></tr></thead><tbody>{leads.map(lead => <tr key={lead.id}><td><code>{lead.id}</code><br /><small>{new Date(lead.createdAt).toLocaleString()}</small></td><td><strong>{lead.name || 'Homeowner'}</strong><br />{lead.email}<br />{lead.phone}<br /><small>{lead.contactConsent ? 'Contact consent recorded' : 'Check contact consent in Whop'}</small></td><td>{lead.address}<br />{lead.zip}</td><td><strong>{lead.service || 'General estimate'}</strong>{lead.message && <details><summary>Request details</summary><p>{lead.message}</p></details>}</td></tr>)}</tbody></table> : <p>No estimate requests are recorded for this template in the latest Whop lead records.</p>}
        {leadsHasMore && <p>Showing this template's requests from the latest 50 account leads. Review older records in the Whop dashboard.</p>}
      </section>
      <section className="portal-panel">
        <div className="portal-actions"><h2>Project deposits</h2><button className="text-link" onClick={refresh} disabled={!!busy}><RefreshCw size={14} /> {busy === 'refresh' ? 'Refreshing…' : 'Refresh records'}</button><button className="text-link" onClick={logout} disabled={!!busy}>Sign out</button></div>
        <p>Records are read from Whop. Only a paid deposit can be used for a final invoice; the server rechecks its ownership, plan, and refund status.</p>
        {jobs.length ? <table><thead><tr><th scope="col">Project / payment</th><th scope="col">Customer</th><th scope="col">Deposit</th><th scope="col">Status</th><th scope="col">Saved method</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><strong>{job.jobId}</strong><br /><code>{job.id}</code></td><td>{job.email || 'Available in Whop'}</td><td>{dollars(job.amount)}</td><td>{job.status}</td><td>{job.cardSaved ? 'Available' : 'Unavailable'}</td></tr>)}</tbody></table> : <p>No project deposits are recorded for this template yet.</p>}
        {hasMore && <p>Showing the latest 100 payments. Review older records in Whop before billing a project outside this list.</p>}
      </section>
      <section className="portal-panel">
        <h2>Create a final invoice</h2>
        <p>Enter the full agreed project total. The server subtracts the verified deposit and creates one final invoice per project.</p>
        <form onSubmit={createInvoice}>
          <label>Paid project deposit<select aria-label="Paid project deposit" required value={paymentId} onChange={event => { setPaymentId(event.target.value); setResult(null); setMode('manual'); setCustomerAuthorized(false); }}><option value="" disabled>Select a paid deposit</option>{paidJobs.map(job => <option key={job.id} value={job.id}>{job.email || job.jobId} — {dollars(job.amount)}</option>)}</select></label>
          <label>Full project total (USD)<input type="number" inputMode="decimal" required min="501" max="100000" step="0.01" placeholder="8500.00" value={total} onChange={event => { setTotal(event.target.value); setResult(null); }} /></label>
          {balance !== null && <p>Estimated final balance: <strong>{dollars(balance)}</strong>. Whop calculates the final deposit credit; tax adjustments may apply.</p>}
          <label>Payment collection<select aria-label="Payment collection" value={mode} onChange={event => { setMode(event.target.value as 'manual' | 'auto'); setCustomerAuthorized(false); setResult(null); }}><option value="manual">Manual — create a Whop payment link</option><option value="auto" disabled={!selected?.cardSaved}>Auto-charge the saved method</option></select></label>
          <label className="consent"><input type="checkbox" required checked={jobCompleted} onChange={event => setJobCompleted(event.target.checked)} />I confirm this job is completed and the project total matches the agreed scope.</label>
          {mode === 'auto' && <label className="consent"><input type="checkbox" required checked={customerAuthorized} onChange={event => setCustomerAuthorized(event.target.checked)} />I confirm the homeowner explicitly authorized charging this final balance to the saved payment method.</label>}
          <button className="button dark" disabled={!!busy || !paidJobs.length || !config?.ready || !jobCompleted || (mode === 'auto' && !customerAuthorized)}>{busy === 'invoice' ? 'Submitting to Whop…' : mode === 'auto' ? 'Create & charge final balance' : 'Create final invoice'} <ArrowUpRight size={17} /></button>
        </form>
        {result && <div className="checkout-status" role="status">{result.issuanceError || result.invoice.status === 'draft' ? <LockKeyhole size={22} /> : <CheckCircle2 size={22} />}<p><strong>{result.issuanceError ? 'Draft saved — business verification required before issue/payment.' : result.invoice.status === 'draft' ? 'Invoice draft saved. It has not been issued.' : result.reused ? 'Existing final invoice retrieved.' : 'Final invoice issued in Whop.'}</strong><br />Invoice: <code>{result.invoice.id}</code><br />Status: <strong>{result.invoice.status}</strong>{result.invoice.amount_due && <><br />Amount due: {dollars(result.invoice.amount_due.amount)}</>}{result.invoice.scheduled_charge_at && <><br />Scheduled charge: {new Date(result.invoice.scheduled_charge_at).toLocaleString()}</>}</p>{result.issuanceError && <p className="error">{result.issuanceError.message}<br /><code>{result.issuanceError.code}</code></p>}{paymentUrl ? <a className="text-link" href={paymentUrl} target="_blank" rel="noopener noreferrer">Open Whop payment link <ArrowUpRight size={16} /></a> : <p>No payable link was returned for this invoice status. Review the invoice in the Whop dashboard.</p>}<p>Creating or issuing an invoice does not by itself confirm payment. Check its status in Whop before closing the project.</p></div>}
      </section>
      <section className="portal-panel">
        <div className="portal-actions"><h2>Custom events received by Whop</h2><button className="text-link" onClick={refreshReceivedEvents} disabled={!!busy}><RefreshCw size={14} />{busy === 'events' ? 'Refreshing…' : 'Refresh received events'}</button></div>
        <p>Read directly from the production account's Whop Events API for the last 24 hours. These are server records, separate from the browser call log below. New events may take about a minute to appear.</p>
        {eventsError ? <p className="error" role="alert">{eventsError}</p> : <>
          <div className="portal-actions">{['estimate_requested', 'service_viewed', 'deposit_started'].map(name => <span className="badge" key={name}>{name}: {receivedEvents.some(event => event.name === name) ? 'Received' : 'Not received in this period'}</span>)}</div>
          {receivedEvents.length ? <table><thead><tr><th scope="col">Custom event</th><th scope="col">Received event time</th><th scope="col">Page</th><th scope="col">Whop event reference</th></tr></thead><tbody>{receivedEvents.map(event => <tr key={event.id}><td><strong>{event.name}</strong></td><td>{new Date(event.time).toLocaleString()}</td><td>{event.path || 'Not recorded'}</td><td><code>{event.eventId || event.id}</code></td></tr>)}</tbody></table> : <p>No matching custom events were returned by Whop for this period.</p>}
          {eventsHasMore && <p>Showing the latest 100 matching events. Use Whop's dashboard for older records.</p>}
        </>}
      </section>
    </>}
    <section className="portal-panel">
      <h2>Integration readiness</h2>
      {config ? <><div className="portal-actions"><span className="badge">{config.environment}</span><strong>{config.ready ? 'Checkout configuration ready' : 'Account connection needed'}</strong></div><p>{config.ready ? 'Configuration values are present. A completed Whop test transaction is still required to verify the integration.' : 'Missing configuration: ' + config.missing.join(', ')}</p></> : <p>{configError || 'Checking server configuration…'}</p>}
    </section>
    <section className="portal-panel">
      <h2>Browser pixel call log</h2>
      <p>Client log for this browser session. “Sent” means the Whop pixel function was called. Confirm actual ingestion in Whop’s pixel dashboard; reporting can take about a minute.</p>
      {events.length ? events.slice().reverse().map((event, index) => <div className="pixel-line" key={`${event.eventId}-${index}`}><div><strong>{event.name}</strong><br /><small>{new Date(event.time).toLocaleTimeString()} · {event.eventId}</small></div><span>{event.state}</span></div>) : <p>No recorded events in this browser session. View a service, start a deposit, or submit a successful estimate request on the home page.</p>}
    </section>
  </main>;
}
