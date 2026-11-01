# Website ka istemal — Roman Urdu

Live website: https://ridge-ready-roofing-demo.whop.site/

Whop `.app` entry: https://ridge-ready-roofing-demo.whop.app/ — yeh HTTP 307 se isi `.site` address par le jata hai. Final browser address `.site` hota hai.

## Abhi kya verify hua hai?

Website Whop par deploy hai. Teen asli production plans ban chuke hain: inspection **$149**, roof tune-up **$399**, project deposit **$500**. Plan IDs `README.md` mein hain.

Estimate request Whop par **201** response ke saath lead `lead_UxoivbblhJKpq` bana chuki hai. Owner portal mein account se leads dobara parhi jati hain. Is se pata chalta hai ke request sirf browser mein save nahi hui.

**Production mein asli payment submit karna abhi disabled hai.** Alag sandbox mein Payment Elements se setup intent `sint_Dx975DLXA9YFe` ka status **succeeded** aur $500 deposit `pay_vN9iPax6TSuwYR` ka status **paid** Whop se verify ho chuka hai. Yeh test payment hai, asli paison ki charge nahi.

$8,500 project total se $500 credit ghata kar **$8,000 draft invoice** `pay_Q1vPbV8pMfxMwG` bhi Whop par bana hai. Invoice abhi **draft** hai; issue/payment-link step merchant verification par ruka hua hai. Issued ya paid kehna abhi theek nahi. Pixel ke teeno events ki ingestion aur final recording bhi mukammal verify honi hain.

## Customer estimate kaise bheje?

1. Website par **Request an Estimate** kholein.
2. Apna naam, email, phone, property address, ZIP aur required service likhein. Contact consent parhein aur accept karein.
3. Whop sign-in karein. Whop Leads API ko request karne wale customer ki identity chahiye; website business owner ki identity us ki jagah istemal nahi karti.
4. Sign-in ke baad form submit karein. Kamyabi tab dikhai jati hai jab Whop asal `lead_` ID wapas deta hai. Error aaye to request ko bheja hua na samjhein.

## Inspection, tune-up aur project deposit

Inspection aur tune-up ek martaba pay hone wali services hain. Replacement ka **$500 sirf deposit** hai; poori roof replacement ki qeemat nahi. Final scope aur poora project total pehle written agreement mein tay hoga.

Deposit flow mein Whop Payment Elements card details leta hai, **setup intent** se method save hota hai, phir deposit charge hota hai. Website ka apna card form nahi hai. Apple Pay, Google Pay aur financing ka dikhna merchant eligibility, browser aur Whop par depend karta hai.

Is demo mein live payments disabled hone ki wajah se checkout rukna expected hai. Sandbox mein test cards sirf sandbox checkout ke andar use karein; production par test card na dein.

Alag test checkout ke liye live website ka `/sandbox` address kholein; test deposits aur invoices `/sandbox/operations` mein milte hain. Yeh alag sandbox account, key aur plans istemal karta hai. In ki settings missing hon to production par wapas nahi jata, checkout rok deta hai. Test job cookie bhi alag hai. Estimate form aur Whop sign-in production par rehte hain, is liye test page se bheja gaya estimate bhi roofing business ke asal Leads account mein jata hai.

## Owner portal aur final invoice

Portal: https://ridge-ready-roofing-demo.whop.site/operations

Owner password se sign-in karein. Yahan estimate requests aur project deposits Whop account se read hote hain. Koi deposit paid na ho to final invoice ke liye select nahi hoga.

Kaam mukammal hone ke baad paid deposit select karein, **poora agreed project total** likhein aur completion confirm karein. Misal: total **$8,500**, deposit credit **$500**, final balance **$8,000**; applicable tax adjustments alag ho sakti hain. Server recorded deposit dobara verify karke credit calculate karta hai.

- **Manual:** Whop invoice aur payment link banega. Link customer ko diya ja sakta hai; invoice banana khud se email bhejna nahi hai.
- **Auto-charge:** saved method charge karne ke liye customer ki explicit authorization confirm karni hogi. Card save hone ka matlab har future charge ki ijazat nahi.

Invoice ka `open`, `pending` ya scheduled hona paid hona nahi hai. Payment status Whop se confirm karne ke baad hi project paid mark karein. Dobara submit karne par existing final invoice reuse karne ki protection hai.

## Password aur keys kahan hain?

`.dev.vars` is machine ki private local configuration hai; source ZIP/Git mein shamil nahi honi chahiye. Is mein API key aur local `ADMIN_PASSWORD` ho sakte hain. In values ko screen recording, screenshot ya chat mein na dikhayein.

Live website **Whop app Secrets** wala `ADMIN_PASSWORD` use karti hai. Local `.dev.vars` edit karne se live password ya live environment khud nahi badalta. Password kam az kam 16 characters aur `APP_SESSION_SECRET` kam az kam 32 random characters ho.

## Nayi roofing company ke liye template kaise badlein?

`src/config.ts` mein company name, phone/email, city, service areas, services aur prices edit karein. Demo phone/email ko asli contact se replace karein. Sample reviews ko sirf asli permission wali reviews se replace karein; demo label tabhi hatayein jab tamam claims haqeeqi hon.

Service IDs `inspection`, `repair`, `deposit` integration ko jorti hain. Naam aur pricing config se badal sakti hai; IDs badalne ke liye API mapping bhi badalni hogi. Provisioning script isi config se catalog banati hai. Naye merchant ke Whop account par plans provision karein aur us ke plan IDs/runtime settings set karein. Purane merchant ki keys ya plan IDs reuse na karein.

Local development ke liye Node **22.18+** chahiye:

```sh
npm ci
test -f .dev.vars || cp .env.example .dev.vars
npm run dev
```

Checks:

```sh
npm test
npm run typecheck
npm run build
```

Live update official Whop CLI se deploy hota hai: `npm run deploy`. Local preview ko live deployment na samjhein. `WHOP_ENABLE_LIVE_PAYMENTS=true` production mein real charges enable karta hai; demo testing ke liye isay enable na karein.

## Pixel events aur final submission

`service_viewed` service dekhne par, `deposit_started` deposit checkout shuru karne par, aur `estimate_requested` successful lead banne ke baad fire hote hain. Portal ka **sent** label pixel function call batata hai. Asal ingestion Whop pixel dashboard mein verify hoti hai; reporting mein takreeban ek minute lag sakta hai.

Successful estimate ka event server bhi Whop Events API ko usi lead ID ke saath bhejta hai. Whop browser aur server ki same conversion ko deduplicate karta hai. Lead fail ho to conversion nahi banti; analytics fail ho to saved lead ko failed request nahi dikhaya jata. Is reporting mein contact details ya property address copy nahi hota.

Final 3–5 minute recording mein live website, successful sandbox checkout with Whop branding, created lead, final-balance invoice aur Whop mein pixel events dikhane hain. Jab tak yeh payment/invoice gates pass nahi hote, poori end-to-end submission complete kehna theek nahi.
