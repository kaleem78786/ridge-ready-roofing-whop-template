// Swap this file and the provisioned plan environment variables to rebrand.
export type ServiceId = 'inspection' | 'repair' | 'deposit';
export const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
export const company = {
  name: 'Ridge & Ready', descriptor: 'ROOFING CO.', city: 'Raleigh, NC',
  phone: '(919) 555-0148', phoneHref: '+19195550148', email: 'hello@example.com',
  hours: 'Mon–Fri, 8am–6pm ET', demo: true,
  areas: ['Raleigh', 'Cary', 'Apex', 'Durham', 'Wake Forest', 'Chapel Hill'],
  services: [
    { id: 'inspection', number: '01', name: 'Roof inspection', price: 149, tag: 'A clear place to start', description: 'Understand what your roof needs before making a big decision.', includes: ['Roof & flashing assessment', 'Photo report with findings', 'Clear next-step recommendations'], action: 'Book an inspection' },
    { id: 'repair', number: '02', name: 'Roof tune-up', price: 399, tag: 'One visit. One flat rate.', description: 'Give the small details attention before they become bigger problems.', includes: ['Accessible flashing & seal check', 'Up to 5 minor sealant repairs', 'Before & after photo summary'], action: 'Book a roof tune-up' },
    { id: 'deposit', number: '03', name: 'Roof replacement', price: 500, tag: 'Deposit toward your project', description: 'A fresh start overhead, with a written scope and a plan you understand.', get includes(): string[] { return ['Written project estimate first', `${money(this.price)} credited to your contract`, 'Final invoice after completion']; }, action: 'Reserve your project' },
  ],
  testimonials: [
    {quote: 'The photo report made it easy to understand what needed attention. No pressure, just a clear plan.', name: 'Sarah M.', location: 'Raleigh', kind: 'Inspection'},
    {quote: 'Knowing the deposit and final balance up front made the whole process feel manageable.', name: 'James T.', location: 'Cary', kind: 'Replacement'},
    {quote: 'A straightforward scope, regular updates, and a clean yard at the end. Exactly what we hoped for.', name: 'Michelle R.', location: 'Apex', kind: 'Roof repair'},
  ],
};
export const prices = Object.fromEntries(company.services.map(service => [service.id, service.price])) as Record<ServiceId, number>;
