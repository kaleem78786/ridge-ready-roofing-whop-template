import React, { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, CheckCircle2, LockKeyhole, RefreshCw } from 'lucide-react';
import { api, type PixelEvent } from './lib';
import { company } from './config';

type Config = { ready: boolean; environment: string; accountId: string; missing: string[]; plans: Record<string, string> };
type InvoiceRow = { id: string; number: string; status: string; amount: string | number; projectTotal: number; depositCredit: number; jobId: string; paymentUrl: string | null };
type Job = { id: string; jobId: string; service?: string; status: string; email?: string; createdAt: string; amount: string | number; cardSaved: boolean };
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
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [invoiceError, setInvoiceError] = useState('');
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [notice, setNotice] = useState('');
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
    try { await Promise.all([loadJobs(), loadLeads(), loadReceivedEvents(), loadInvoices()]); } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }
  async function loadLeads() {
    const data = await api<{ leads: Lead[]; hasMore: boolean }>('admin/leads');
    setLeads(data.leads); setLeadsHasMore(data.hasMore); setAuthenticated(true);
  }
  async function loadReceivedEvents() {
    setEventsLoading(true);
    try {
      const data = await api<{ events: ReceivedEvent[]; hasMore: boolean }>('admin/events');
      setReceivedEvents(data.events); setEventsHasMore(data.hasMore); setEventsError('');
    } catch (error) { setEventsError(errorMessage(error)); }
    finally { setEventsLoading(false); }
  }
  async function loadInvoices() {
    setInvoicesLoading(true);
    try { const data = await api<{ invoices: InvoiceRow[] }>('admin/invoices'); setInvoices(data.invoices); setInvoiceError(''); }
    catch (error) { setInvoiceError(errorMessage(error)); }
    finally { setInvoicesLoading(false); }
  }
  async function emailInvoice(id: string) {
    setBusy('send'); setNotice(''); setError('');
    try { await api(`admin/invoices/${id}/send`, {}); setNotice('Whop accepted the invoice send request. Check delivery and payment status in Whop.'); await loadInvoices(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }
  async function refreshReceivedEvents() {
    setBusy('events'); await loadReceivedEvents(); setBusy('');
  }
  useEffect(() => {
    api<Config>('config').then(setConfig).catch(error => setConfigError(errorMessage(error)));
    Promise.all([loadJobs(), loadLeads(), loadReceivedEvents(), loadInvoices()]).catch(() => { /* An absent owner session displays the login form. */ });
    const update = () => setEvents([...(window.__roofingEvents || [])]);
    window.addEventListener('roofing:pixel', update);
    return () => window.removeEventListener('roofing:pixel', update);
  }, []);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy('login'); setError('');
    try {
      await api('admin/login', { password });
      setPassword(''); setAuthenticated(true); await Promise.all([loadJobs(), loadLeads(), loadReceivedEvents(), loadInvoices()]);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }
  async function logout() {
    setBusy('logout'); setError('');
    try {
      await api('admin/logout', {}); setAuthenticated(false); setJobs([]); setInvoices([]); setLeads([]); setReceivedEvents([]); setResult(null); setPaymentId('');
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
      await loadInvoices();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }
  const selected = jobs.find(job => job.id === paymentId);
  const paidJobs = jobs.filter(job => job.status === 'paid' && job.service === 'deposit' && !!job.jobId);
  const balance = selected && total ? Number(total) - Number(selected.amount) : null;
  const paymentUrl = verifiedUrl(result?.paymentUrl);
  const totalCollected = jobs.reduce((sum, job) => sum + (job.status === 'paid' ? Number(job.amount) : 0), 0);
  const totalDeposits = paidJobs.reduce((sum, job) => sum + Number(job.amount), 0);

  return <main className="container portal">
    <a className="text-link" href="/"><ArrowLeft size={16} /> Back to {company.name}</a>
    <h1>Project & payment desk</h1>
    <p>Review estimate requests and deposits, then bill the remaining balance after the work is complete.</p>
    {config && <p><span className="badge">{config.environment === 'sandbox' ? 'SANDBOX — test records only' : 'PRODUCTION'}</span> Account: <code>{config.accountId}</code></p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!authenticated ? <section className="portal-panel">
      <h2><LockKeyhole size={20} /> Owner sign in</h2>
      <p>Use the owner password configured for this website.</p>
      <form onSubmit={login}>
        <label>Owner password<input type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button className="button dark" disabled={!!busy}>{busy === 'login' ? 'Signing in…' : 'Sign in securely'} <ArrowUpRight size={17} /></button>
      </form>
    </section> : <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:'15px',margin:'25px 0 10px'}}>
        <div style={{background:'#f4f8ed',border:'1px solid #dbe6ce',padding:'16px',borderRadius:'6px'}}>
          <small style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'1px',color:'#556358',display:'block'}}>Total Collected</small>
          <div style={{fontSize:'24px',fontWeight:'700',color:'#1a332d',marginTop:'4px'}}>{dollars(totalCollected)}</div>
          <span style={{fontSize:'11px',color:'#6b7e6e'}}>{jobs.filter(j => j.status === 'paid').length} payments processed</span>
        </div>
        <div style={{background:'#f4f8ed',border:'1px solid #dbe6ce',padding:'16px',borderRadius:'6px'}}>
          <small style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'1px',color:'#556358',display:'block'}}>Project Deposits Ready</small>
          <div style={{fontSize:'24px',fontWeight:'700',color:'#1a332d',marginTop:'4px'}}>{dollars(totalDeposits)}</div>
          <span style={{fontSize:'11px',color:'#6b7e6e'}}>Credited toward final balance</span>
        </div>
        <div style={{background:'#f4f8ed',border:'1px solid #dbe6ce',padding:'16px',borderRadius:'6px'}}>
          <small style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'1px',color:'#556358',display:'block'}}>Estimate Leads</small>
          <div style={{fontSize:'24px',fontWeight:'700',color:'#1a332d',marginTop:'4px'}}>{leads.length} Active Leads</div>
          <span style={{fontSize:'11px',color:'#6b7e6e'}}>Whop Leads API connected</span>
        </div>
      </div>
      <section className="portal-panel">
        <div className="portal-actions"><h2>Estimate requests</h2><button className="text-link" onClick={refresh} disabled={!!busy}><RefreshCw size={14} /> {busy === 'refresh' ? 'Refreshing…' : 'Refresh records'}</button></div>
        <p>These requests are read back from the connected Whop account. Only leads created by this template are shown.</p>
        {leads.length ? <table><thead><tr><th scope="col">Whop lead / received</th><th scope="col">Customer</th><th scope="col">Property</th><th scope="col">Request</th></tr></thead><tbody>{leads.map(lead => <tr key={lead.id}><td><code>{lead.id}</code><br /><small>{new Date(lead.createdAt).toLocaleString()}</small></td><td><strong>{lead.name || 'Homeowner'}</strong><br />{lead.email}<br />{lead.phone}<br /><small>{lead.contactConsent ? 'Contact consent recorded' : 'Check contact consent in Whop'}</small></td><td>{lead.address}<br />{lead.zip}</td><td><strong>{lead.service || 'General estimate'}</strong>{lead.message && <details><summary>Request details</summary><p>{lead.message}</p></details>}</td></tr>)}</tbody></table> : <p>No estimate requests are recorded for this template in the latest Whop lead records.</p>}
        {leadsHasMore && <p>Showing this template's requests from the latest 50 account leads. Review older records in the Whop dashboard.</p>}
      </section>
      <section className="portal-panel">
        <div className="portal-actions"><h2>Project deposits & payments</h2><button className="text-link" onClick={refresh} disabled={!!busy}><RefreshCw size={14} /> {busy === 'refresh' ? 'Refreshing…' : 'Refresh records'}</button><button className="text-link" onClick={logout} disabled={!!busy}>Sign out</button></div>
        <p>Records are read from Whop. Only a paid deposit can be used for a final invoice; the server rechecks its ownership, plan, and refund status.</p>
        {jobs.length ? <table><thead><tr><th scope="col">Project / payment</th><th scope="col">Customer</th><th scope="col">Service / Amount</th><th scope="col">Status</th><th scope="col">Saved method</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><strong>{job.jobId}</strong><br /><code>{job.id}</code></td><td>{job.email || 'Available in Whop'}</td><td><strong>{dollars(job.amount)}</strong><br /><small>{job.service === 'repair' ? 'Roof tune-up' : job.service === 'inspection' ? 'Roof inspection' : 'Project deposit'}</small></td><td>{job.status}</td><td>{job.cardSaved ? 'Available' : 'Unavailable'}</td></tr>)}</tbody></table> : <p>No project deposits or payments are recorded for this template yet.</p>}
        {hasMore && <p>Showing the latest 100 payments. Review older records in Whop before billing a project outside this list.</p>}
      </section>
      <section className="portal-panel">
        <h2>Create a final invoice</h2>
        <p>Enter the full agreed project total. The server subtracts the verified deposit and creates one final invoice per project.</p>
        <form onSubmit={createInvoice}>
          <label>Paid project deposit<select aria-label="Paid project deposit" required value={paymentId} onChange={event => { setPaymentId(event.target.value); setResult(null); setMode('manual'); setCustomerAuthorized(false); }}><option value="" disabled>Select a paid deposit</option>{paidJobs.map(job => <option key={job.id} value={job.id}>{job.email || job.jobId} — {dollars(job.amount)}</option>)}</select></label>
          <label>Full project total in dollars (USD)<input type="number" inputMode="decimal" required min={selected ? (Number(selected.amount) + 0.01).toFixed(2) : '0.01'} max="100000" step="0.01" placeholder="8500.00" value={total} onChange={event => { setTotal(event.target.value); setResult(null); }} /></label>
          {balance !== null && <p>Estimated final balance: <strong>{dollars(balance)}</strong>. Whop calculates the final deposit credit; tax adjustments may apply.</p>}
          <label>Payment collection<select aria-label="Payment collection" value={mode} onChange={event => { setMode(event.target.value as 'manual' | 'auto'); setCustomerAuthorized(false); setResult(null); }}><option value="manual">Manual — create a Whop payment link</option><option value="auto" disabled={!selected?.cardSaved}>Auto-charge the saved method</option></select></label>
          <label className="consent"><input type="checkbox" required checked={jobCompleted} onChange={event => setJobCompleted(event.target.checked)} />I confirm this job is completed and the project total matches the agreed scope.</label>
          {mode === 'auto' && <label className="consent"><input type="checkbox" required checked={customerAuthorized} onChange={event => setCustomerAuthorized(event.target.checked)} />I confirm the homeowner explicitly authorized charging this final balance to the saved payment method.</label>}
          <button className="button dark" disabled={!!busy || !paidJobs.length || !config?.ready || !jobCompleted || (mode === 'auto' && !customerAuthorized)}>{busy === 'invoice' ? 'Submitting to Whop…' : mode === 'auto' ? 'Create & charge final balance' : 'Create final invoice'} <ArrowUpRight size={17} /></button>
        </form>
        {result && <div className="checkout-status" role="status">{result.issuanceError || result.invoice.status === 'draft' ? <LockKeyhole size={22} /> : <CheckCircle2 size={22} />}<p><strong>{result.issuanceError ? 'Draft saved — business verification required before issue/payment.' : result.invoice.status === 'draft' ? 'Invoice draft saved. It has not been issued.' : result.reused ? 'Existing final invoice retrieved.' : 'Final invoice issued in Whop.'}</strong><br />Invoice: <code>{result.invoice.id}</code><br />Status: <strong>{result.invoice.status}</strong>{result.invoice.amount_due && <><br />Amount due: {dollars(result.invoice.amount_due.amount)}</>}{result.invoice.scheduled_charge_at && <><br />Scheduled charge: {new Date(result.invoice.scheduled_charge_at).toLocaleString()}</>}</p>{result.issuanceError && <p className="error">{result.issuanceError.message}<br /><code>{result.issuanceError.code}</code><br/><a className="text-link" href={`${config?.environment === 'sandbox' ? 'https://sandbox.whop.com' : 'https://whop.com'}/dashboard/${config?.accountId}/balance/?verify=true`} target="_blank" rel="noopener noreferrer">Open Whop account verification ↗</a></p>}{paymentUrl ? <a className="text-link" href={paymentUrl} target="_blank" rel="noopener noreferrer">Open Whop payment link <ArrowUpRight size={16} /></a> : <p>No payable link was returned for this invoice status. Review the invoice in the Whop dashboard.</p>}<p>Creating or issuing an invoice does not by itself confirm payment. Check its status in Whop before closing the project.</p></div>}
      </section>
      <section className="portal-panel">
        <div className="portal-actions"><h2>Final invoices</h2><button className="text-link" onClick={loadInvoices} disabled={!!busy}><RefreshCw size={14}/>Refresh invoices</button></div>
        <p>Saved in Whop and available after you reload this page. Drafts have not been issued or charged. Emailing is a separate action.</p>
        {invoicesLoading ? <p role="status">Loading invoices from Whop…</p> : invoiceError ? <p className="error" role="alert">{invoiceError}</p> : invoices.length ? <table><thead><tr><th>Invoice</th><th>Project / deposit credit</th><th>Balance due</th><th>Status</th><th>Actions</th></tr></thead><tbody>{invoices.map(invoice => <tr key={invoice.id}><td><strong>{invoice.number || invoice.id}</strong><br/><code>{invoice.id}</code></td><td>{dollars(invoice.projectTotal)} total<br/>{dollars(invoice.depositCredit)} credit</td><td>{dollars(invoice.amount)}</td><td>{invoice.status}</td><td>{verifiedUrl(invoice.paymentUrl) && <a className="text-link" href={verifiedUrl(invoice.paymentUrl)!} target="_blank" rel="noopener noreferrer">Pay invoice ↗</a>}{invoice.status === 'open' && <button className="button outline small" disabled={!!busy} onClick={()=>emailInvoice(invoice.id)}>Email through Whop</button>}{invoice.status === 'draft' && <small>Awaiting issue; review verification message above.</small>}</td></tr>)}</tbody></table> : <p>No final invoices have been created by this template yet.</p>}
      </section>
      <section className="portal-panel">
        <div className="portal-actions"><h2>Custom events received by Whop</h2><button className="text-link" onClick={refreshReceivedEvents} disabled={!!busy}><RefreshCw size={14} />{busy === 'events' ? 'Refreshing…' : 'Refresh received events'}</button></div>
        <p>Read directly from the connected account's Whop Events API for the last 24 hours. These are server records, separate from the browser call log below. New events may take about a minute to appear.</p>
        {eventsLoading ? <p role="status">Loading received events from Whop…</p> : eventsError ? <p className="error" role="alert">{eventsError}</p> : <>
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
