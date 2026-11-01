export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const sandbox = (location.pathname === '/sandbox' || location.pathname.startsWith('/sandbox/')) && (path === 'config' || path.startsWith('checkout/') || path === 'admin/jobs' || path.startsWith('admin/invoices'));
  const res = await fetch(`/api/${sandbox ? 'sandbox/' : ''}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body) });
  const data: any = await res.json().catch(()=>({error:'The server could not complete this request.'}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Please try again in a moment.');
  return data;
}
export type PixelEvent = {name: string; eventId: string; state: 'sent'|'unavailable'|'failed'; time: string};
declare global { interface Window { whop?: {track: (name:string,data?:Record<string,unknown>)=>void}; __roofingEvents?: PixelEvent[] } }
try { window.__roofingEvents = JSON.parse(sessionStorage.getItem('roofing:pixel') || '[]'); } catch { window.__roofingEvents = []; }
export function track(name: string, data: Record<string,unknown> = {}, eventId = crypto.randomUUID()) {
  let state: PixelEvent['state'] = 'unavailable';
  try { if (window.whop?.track) { window.whop.track(name,{...data,event_id:eventId}); state='sent'; } } catch { state='failed'; }
  window.__roofingEvents = [...(window.__roofingEvents || []).slice(-49), {name,eventId,state,time:new Date().toISOString()}];
  try { sessionStorage.setItem('roofing:pixel', JSON.stringify(window.__roofingEvents)); } catch {}
  window.dispatchEvent(new Event('roofing:pixel'));
}
