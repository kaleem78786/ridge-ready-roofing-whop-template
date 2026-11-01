# Roofing website on Whop

Original reusable React website with a Hono API Worker, packaged by the official Whop CLI Vite plugin. Customer pages include services, service area, financing, clearly labeled sample reviews, contact, and estimate requests. The owner desk is `/operations`.

## Run locally

Requires Node 22.18 or newer (native TypeScript support), or a current Node 24/26 release.

```sh
npm ci
cp .env.example .dev.vars
npm run dev
```

Fill `.dev.vars` with your own server-side Whop credentials, account/catalog IDs, random session secret, and owner password. Empty configuration deliberately prevents checkout. Never put an API key into a `VITE_*` variable, browser code, the source archive, or Git.

```sh
npm test
npm run typecheck
npm run build
```

The API tests use Node's native TypeScript support and test doubles. They check server validation and authorization; they do not prove live Whop checkout or account ingestion. Roman Urdu walkthrough: [docs/SAMJHAI.md](docs/SAMJHAI.md).

The build produces `dist/client`, `dist/server/index.js`, and `dist/whop-build.zip`. Deployment must use `whop apps deploy`, rather than uploading to another host.

## Rebrand and provision plans

Edit `src/config.ts` to change the company identity, contact details, service areas, services, prices, and reviews without changing page structure. Replace the demo phone/email, sample reviews, and business policies before pitching a real merchant as a live business. The provisioning script imports this same configuration for product names, scope, and default prices; optional pricing environment variables override those defaults.

The three one-time USD services are inspection ($149), project deposit ($500), and flat-rate roof tune-up ($399). Using a Whop account API key with the needed catalog permissions, run:

```sh
node --env-file=.dev.vars scripts/provision.mjs
```

The script creates/reuses actual products and plans in the chosen environment. It prints non-secret plan IDs and prices for your environment configuration. It does not make a payment or send an invoice. Sandbox resources cannot be substituted for production resources. A signed-in production CLI can provision without copying its credentials:

```sh
WHOP_ENVIRONMENT=production WHOP_ACCOUNT_ID=biz_YOUR_ACCOUNT node scripts/provision.mjs --cli --output /tmp/roofing-plans.json
```

Catalog creates use stable idempotency keys; existing matching products/plans are reused. Every variant disables PayPal and retains Whop's default eligible payment methods.

## Whop hosting

Install/sign in with the [official CLI](https://whop.sh), then select the intended merchant business. This repository is already scaffolded. Use `whop apps create --help` to register a **website** for this code, then `whop apps deploy --app app_YOUR_ID` to let the CLI link and deploy the project. Do not fabricate an app ID or handwrite `whop.app.json`. To start a separate fresh website instead, use the documented `whop apps init --app_type website --name "Your company" --domain your-company` workflow.

Store runtime configuration in the Whop app's Secrets settings. Whop injects the production account ID and API origin; server-side API requests can use the platform authentication proxy. Sandbox testing requires its separate sandbox key. `WHOP_ENVIRONMENT` defaults to `sandbox`. Production payments additionally require `WHOP_ENABLE_LIVE_PAYMENTS=true`.

```sh
npm run deploy
```

Live entry URL: [ridge-ready-roofing-kaleem.whop.app](https://ridge-ready-roofing-kaleem.whop.app/). Whop currently responds with HTTP **307** to the canonical [ridge-ready-roofing-kaleem.whop.site](https://ridge-ready-roofing-kaleem.whop.site/) website. Both are Whop-hosted; the `.app` URL is a redirecting entry address, and `.site` is the final browser address. Current [Whop Websites docs](https://docs.whop.com/developer/websites/quickstart) document `.site` hosting.

The three production plans have been created on the demo merchant: inspection `plan_JP8PFTIsCdE60` ($149), tune-up `plan_PKHpwaAoFXZtn` ($399), and deposit `plan_qh5BuIad8W2na` ($500). Production payment submission remains intentionally disabled; catalog creation and website deployment do not prove a successful test checkout.

## Deposit → job → final invoice

1. The customer accepts the written project scope and starts a deposit. Whop Payment Elements collect the payment details; custom card fields are never used.
2. A Whop setup intent saves the method. The server verifies its success before charging the $500 deposit. The customer sees paid status only after a server read of the Whop payment.
3. Whop is the durable payment/job record. `/operations` reads deposits after owner authentication. A browser return URL cannot mark a project paid.
4. After completing the work, the owner selects a paid deposit, enters the full agreed project price, and confirms completion. For an $8,500 project with a $500 credit, the final balance is $8,000 before applicable adjustments.
5. Manual collection creates/issues a Whop invoice and provides its verified payment URL. Auto collection uses the stored method only after the owner's explicit attestation that the homeowner authorized that charge. Stored-card setup alone is not final-charge authorization.

The server verifies deposit ownership, template/plan, paid status, and refunds. It credits the recorded deposit and reuses an existing non-void final invoice. Issued, pending, and scheduled invoices are not reported as paid. Sending an invoice email is a separate action; creating a manual link does not silently send email.

The estimate form calls `POST /api/leads`; success requires a `lead_` ID from Whop. Whop's Leads API associates each lead with a Whop user, so a homeowner signs in with Whop before sending the request. The server uses that authenticated visitor's `user_id`; it never substitutes the merchant owner. Customer contact/scope details are stored in lead metadata. An unsigned visitor receives `401 whop_sign_in_required`, not a fabricated lead confirmation.

Configure a signed webhook at `/api/webhooks/whop` for payment/setup events; unsigned payloads are rejected. The owner portal always rereads Whop records.

## Whop visitor sign-in

The Website app uses public OAuth 2.1 with PKCE and `openid profile email`. Configure the app's `oauth_client_type` as `public` and register these exact callback URLs:

- `https://ridge-ready-roofing-kaleem.whop.app/api/auth/whop/callback`
- `https://ridge-ready-roofing-kaleem.whop.site/api/auth/whop/callback`

For a rebranded deployment, register its actual HTTPS callback on the new app. The runtime provides `APP_ID`; local development can set `WHOP_APP_ID`.

`GET /api/auth/whop/start` redirects to Whop with a cryptographic state, nonce, and PKCE challenge. The HttpOnly, SameSite=Lax state cookie permits the cross-site callback. `/api/auth/whop/callback` verifies state, exchanges the code, and verifies the visitor through Whop's `/oauth/userinfo` endpoint. Only the resulting identity is kept in a signed HttpOnly cookie; access and refresh credentials are not exposed to browser JavaScript or persisted. `GET /api/auth/whop` reports sign-in status. The frontend preserves the estimate while sign-in completes. See [Whop OAuth](https://docs.whop.com/developer/guides/oauth).

Whop lead validation failures are logged server-side with credentials, email addresses, and long tokens redacted; the public API returns a generic error and code.

## Payment Elements and sandbox limits

Checkout uses Whop Elements, including express checkout and required Whop branding. Apple Pay/Google Pay depend on the browser, wallet, domain registration, and merchant eligibility. Financing is shown by Whop when supported for the merchant and purchase; the website does not promise approval or a specific payment method.

The [official sandbox guide](https://docs.whop.com/developer/guides/sandbox) currently says Elements sandbox access is not generally available, and sandbox supports cards only. A merchant/account with working Elements sandbox access is therefore required to prove the requested test checkout. Merely rendering the components, passing a build, or testing API mocks does not satisfy that acceptance gate.

The separate sandbox merchant/key has now been configured and an actual Elements deposit has succeeded in this account: setup intent `sint_Dx975DLXA9YFe` is `succeeded`, and payment `pay_vN9iPax6TSuwYR` is `paid` for $500 USD. Evidence is in `output/evidence/sandbox-paid-proof.json` and its screenshot. This observed result is account-specific despite the documented general sandbox limitation. Production payment submission stays disabled. Use the documented sandbox success card `4242 4242 4242 4242`, future expiry such as `12/34`, and a three-digit CVC only against sandbox. Additional card-saving documentation: [Save payment methods](https://docs.whop.com/developer/guides/save-payment-methods).

Final invoice `pay_Q1vPbV8pMfxMwG` has been read back from Whop sandbox as **draft**, with $8,000 due: $8,500 agreed project total minus the $500 recorded deposit. Issuing this invoice is currently blocked by merchant verification; no issued/payment-link or final payment success is claimed. See `output/evidence/final-invoice-readback.json`.

The live `/sandbox` route uses a separate test checkout and `/sandbox/operations` uses its test deposits/invoices. Configure all `WHOP_SANDBOX_*` account, API-key and plan settings from `.env.example`; missing dedicated values stop checkout instead of falling back to production credentials or plans. Sandbox job cookies are separate from production job cookies. Estimate requests, visitor sign-in and owner sign-in still use the production endpoints, so a sandbox site visit does not silently change where customer leads are stored. Sandbox webhooks use `/api/sandbox/webhooks/whop` with their dedicated signing secret.

`tests/sandbox-isolation.test.mts` checks credential/catalog separation, secret-free public configuration, same-origin enforcement after route rewriting, browser endpoint selection and separate job cookies. These are local security checks; they do not establish that Whop accepted a test payment.

## Tracking and proof

`src/lib.ts` calls `whop.track` with unique event IDs for `service_viewed`, `deposit_started`, and `estimate_requested`. The estimate event fires only after the lead API returns success. Whop supplies automatic page-view and checkout tracking on its supported hosted domains.

After a successful lead creation, the server also mirrors that actual `estimate_requested` conversion to Whop's Events API using the same lead ID as the browser event and a stable idempotency key. This follows Whop's documented browser/server deduplication flow. It carries the validated `_wuid` cookie, verified Whop visitor ID, original IP/user agent, and a same-origin page URL with tracking parameters; contact details and property addresses are not copied into analytics. Failed lead creation never creates an analytics conversion, and an analytics refusal cannot change a successfully saved lead into a failed form submission. The server credential needs `event:create`. See [server-side Events API](https://docs.whop.com/developer/ads/events-api).

The owner desk shows configuration readiness and the client pixel-call log. “Sent” means the pixel function was invoked, not that ingestion has been independently verified. Confirm all three custom names in Whop's pixel dashboard, allowing about a minute for reporting. See [Whop tracking](https://docs.whop.com/developer/websites/tracking).

## Submission verification

Do not mark these complete without live evidence:

- An actual required Whop-hosted URL and responsive desktop/mobile review.
- A successful sandbox Elements checkout showing express checkout and BrandingElement.
- A saved-method setup intent and paid deposit verified through Whop.
- An estimate submission and corresponding lead visible on the merchant account.
- A final-balance invoice read back from Whop, with correct deposit credit.
- All three custom pixel events visible in Whop reporting.
- A 3–5 minute real screen recording covering the live site, successful test checkout, lead, invoice, and pixel events.
- A source ZIP or GitHub repository without credentials.

The website and production catalog are live. An estimate has been verified with HTTP 201 and Whop lead `lead_UxoivbblhJKpq`; the owner portal reads template leads back from Whop. The sandbox saved-method setup and $500 deposit are verified, and an $8,000 final invoice exists as a draft. Invoice issuance, all-three pixel ingestion, and the complete recording remain outstanding. A local preview or recording of blocked screens is not the requested end-to-end submission.

## Feature paragraph

This roofing template integrates Whop Websites deployment, three one-time service plans, Whop Payment Elements with express checkout and required branding, estimate capture through the Leads API, setup-intent card storage for project deposits, and an authenticated owner workflow for final-balance invoices with manual collection or authorized stored-method charging. It also includes signed webhook verification and custom `estimate_requested`, `service_viewed`, and `deposit_started` pixel calls, with reusable company/service configuration and responsive layouts. Merchant eligibility and completed live testing determine the available payment methods and verified submission status.
