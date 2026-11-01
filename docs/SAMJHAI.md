# Istemal — Roman Urdu

Website: https://ridge-ready-roofing-demo.whop.app/ . Whop isay `.whop.site` par redirect karta hai.
Owner portal: https://ridge-ready-roofing-demo.whop.site/operations

Ab website ka main flow **sandbox** hai. Production CLI aur sandbox merchant dono `mystudentlife78.6@gmail.com` ke hain. Sandbox mein asli paison ki charge nahi hoti.

## Customer ka flow

1. **Request an estimate** par naam, email, phone, property address, ZIP aur service dein. Contact consent accept karein.
2. Whop sign-in poora karein. Ab sandbox user ko sandbox account se hi connect kiya jata hai. Form login ke baad khud submit hota hai.
3. Asli Whop lead banne par **Request received** confirmation milti hai. Form submit karne ki koi fee nahi. Yeh screen email bhejne ka claim nahi karti.
4. Inspection $149, tune-up $399, replacement ka deposit $500 hai. $500 poori roof ki qeemat nahi; pehle written scope approve karna zaroori hai.
5. Deposit mein pehle Whop card save karta hai, phir $500 charge karta hai. Card details sirf Whop ke hosted fields mein jati hain. Test card `4242 4242 4242 4242`, future expiry aur 3-digit CVC **sirf sandbox** mein use karein.
6. Payment ka final status Whop se verify hota hai. Processing ho to screen khud dobara check karti hai.

Is account par setup `sint_D2S0S2vjYEpm9` succeeded aur payment `pay_g8OjsjL0UOXnSb` $500 paid verify hain. Lead `lead_j338YR4AWBJqx` bhi account se read-back hua hai.

## Owner invoice kaise banaye?

1. `/operations` par owner password se login karein. Private password `.dev.vars` / Whop app Secrets mein hai; chat ya recording mein na dikhayein.
2. **Paid project deposit** mein relevant $500 deposit select karein.
3. **Full project total in dollars** mein poora agreed amount likhein. Misal: `8500` ka matlab $8,500 hai; cents enter nahi karne.
4. Job complete hone ka checkbox confirm karein. Manual mode mein final invoice banayein. $8,500 − $500 = **$8,000**.
5. Invoice Whop mein save hota hai aur **Final invoices** history mein reload ke baad bhi milta hai. Dobara submit karne par existing invoice reuse hota hai.
6. Issued/open invoice par payment link aur **Email through Whop** action milta hai. Auto-charge ke liye saved method ke saath homeowner ki alag authorization chahiye.

**Abhi ek account blocker hai:** invoice `pay_GtW3MnTe5QibMf`, #00000002, $8,000 ka draft bana hai. Whop usay issue karne par `invoice_account_verification_required` deta hai. Portal ka **Open Whop account verification** link use karein. Merchant verification complete hone se pehle payable link ya final charge nahi ban sakta. Draft ko paid samajhna ghalat hoga.

Account ka pehle se mojood $84,500 draft alag purana record hai. Usay is naye $8,000 test invoice se confuse na karein; repair ke dauran us purane invoice ko charge ya modify nahi kiya gaya.

## Pixel aur template

Whop Events API mein `estimate_requested`, `service_viewed` aur `deposit_started` teeno read-back verify hue hain. Owner portal mein **Received** actual account record hai; browser log ka **sent** sirf function call batata hai.

`src/config.ts` se company name, contact, service areas, services, prices aur reviews badal sakte hain. Naye merchant ke liye us ke apne plans, keys aur OAuth app configure karein. Demo reviews ko asli reviews ke baghair verified na kahein.

Reference video ka customer/owner workflow dekh kar identity, card-saving, pending status aur invoice history ke maslay fix kiye hain. Is repair mein nayi screen recording nahi banayi gayi.
