# Ridge & Ready — Whop roofing template

Original React website and Hono API Worker deployed with the official Whop Websites CLI. Company identity, service areas, reviews, service scope and prices live in `src/config.ts`.

- Live: https://ridge-ready-roofing-demo.whop.app/ (Whop redirects to https://ridge-ready-roofing-demo.whop.site/).
- Customer site: `/`; owner desk: `/operations`.
- Current deployment is a **sandbox demo**. No real payments are enabled.
- Account owner: `mystudentlife78.6@gmail.com`, verified for production CLI and the separate sandbox account.

## Verified on this account

| Flow | Actual result |
| --- | --- |
| Estimate | Whop lead `lead_j338YR4AWBJqx`; HTTP 201 and account read-back |
| Card on file | Setup `sint_D2S0S2vjYEpm9`, status `succeeded` |
| Project deposit | Payment `pay_g8OjsjL0UOXnSb`, status `paid`, $500 USD |
| Final balance | Native invoice `pay_GtW3MnTe5QibMf`, #00000002, $8,000 due, **draft** |
| Custom pixels | All three names read back from Whop Events API |
| Checks | 33 automated tests; TypeScript check; desktop/mobile live checks |

**Remaining external gate:** Whop refuses invoice issuance with `invoice_account_verification_required`. The $8,000 draft exists, but it has no payable link until the merchant completes verification. No final-balance charge or delivered invoice email is claimed. The portal shows the exact state and a Whop verification link. See [Whop invoice issue errors](https://docs.whop.com/developer/guides/invoices).

Evidence from this account is under `output/current-qa/` in the workspace. Old `output/evidence/` records concern earlier accounts and must not be represented as current proof. The existing older recording is not proof of the repaired flow; no replacement video was made during this repair.

## Local development

Requires Node 22.18+ with native TypeScript support.

```sh
npm ci
cp .env.example .dev.vars
# Configure private server values in .dev.vars.
npm run dev
npm test
npm run typecheck
npm run build
npm run deploy
```

Use Whop app Secrets for the hosted configuration. Local `.dev.vars` changes do not update live Secrets. Never commit or archive keys, owner passwords, session cookies or `.dev.vars`. The source ZIP excludes these files, browser profiles, dependencies and old recordings.

The production Website app is `app_2pVNKJGaLGEh5u`, account `biz_7G24bZs7UfiGOX`. Sandbox resources belong to `biz_6a79XwK95z7vPY`. Both are owned through the email above; their resources and user IDs remain separate.

## Plans and rebranding

Edit `src/config.ts`, replace demo contact details and illustrative reviews, then provision the selected account:

```sh
node --env-file=.dev.vars scripts/provision.mjs
```

| Service | USD | Current sandbox plan |
| --- | --- | --- |
| Roof inspection | 149 | `plan_o72QNZ5P7Xg4g` |
| Project deposit | 500 | `plan_hCRsVDrj5kiT5` |
| Roof tune-up | 399 | `plan_Gqdt0QUySSgv8` |

The separate production plans are `plan_S99ZW6IxA7UGc`, `plan_SDa0PRrQYAEdX`, and `plan_0fyMZ80svu3g2`, respectively. Never interchange sandbox and production plans. The provisioning script is idempotent and excludes PayPal.

## Customer and owner workflow

1. A customer completes the estimate form and signs in with Whop. The draft survives sign-in and submits afterward. Confirmation requires an actual Whop `lead_` response. The form makes no charge and does not claim an email was sent.
2. Sandbox-only demos need a **sandbox OAuth app**, not the production Website app ID. Set `WHOP_OAUTH_APP_ID`, `WHOP_OAUTH_ORIGIN=https://sandbox-api.whop.com` and `WHOP_OAUTH_AUTHORIZE_HOST=https://sandbox-api.whop.com`; register the exact hosted `/api/auth/whop/callback` URI on that public OAuth app. This deployment uses `app_d7ZibNnSkufUwV`.
3. The server binds the verified visitor identity to the account and environment. A missing sandbox user never falls back to the merchant owner. In production, leave the OAuth overrides empty and use the production Website app.
4. The customer approves the written project estimate before a deposit. Whop `PaymentElement`, `EmailElement` and required `BrandingElement` collect details. Deposit Elements use `mode="setup"` and `setupFutureUsage="off_session"`; the verified setup is then used for the deposit payment. No custom card form exists.
5. The alternative wallet surface uses `ExpressCheckoutElement` and `BrandingElement`. Apple/Google Pay require an eligible device and merchant. Actual wallet payment was not tested. Whop decides financing availability.
6. Payment status comes from Whop, with automatic pending-status refresh. A return URL or client success callback cannot mark a job paid.
7. Owner signs in at `/operations`, selects a paid deposit with a project reference, enters the **full project price in dollars**, and confirms completion. $8,500 total less $500 paid produces an $8,000 final invoice. Whop stores the invoice; history survives reloads. Existing invoices are reused.
8. Manual collection provides a Whop link after issue. The owner can explicitly email an open invoice through Whop. Auto-charge requires a saved method and separate owner attestation of the customer's authorization for that final amount. Account verification still applies.

`/sandbox` and `/sandbox/operations` provide isolated sandbox checkout routes for a later production configuration. In this sandbox-only demo, the main site already uses sandbox. When the main environment is production, estimate/sign-in routes remain production even when visiting `/sandbox`; only test payment routes switch accounts.

## Tracking, webhooks and security

`whop.track` sends `service_viewed`, `deposit_started` and `estimate_requested`. The estimate event follows a successful real lead. A server mirror uses the same lead/event ID for deduplication. `WHOP_PIXEL_ACCOUNT_ID` selects the hosted Website's production analytics account during sandbox-payment demos; sandbox user IDs are excluded from that cross-environment analytics mirror. Customer contact details and property addresses are not copied into custom events.

The owner desk reads actual Whop Events API records separately from its browser-call log. “Sent” means a client call, while “Received” means an account read-back. Whop handles automatic page views and checkout tracking on its hosting.

Webhook endpoints verify signatures with `@whop/sdk/helpers`: `/api/webhooks/whop` and isolated `/api/sandbox/webhooks/whop`. Each needs its account's actual signing secret. Sessions are signed, HttpOnly and time limited; OAuth uses PKCE, state and nonce. Mutations enforce same-origin requests. Final billing verifies account ownership, paid status, refunds, project identity and recorded deposit credit.

## Implemented Whop features

This reusable roofing template uses Whop Websites hosting, three one-time plans, Payment Elements with express checkout and required branding, authenticated estimate capture through the Leads API, setup-intent card storage followed by a project deposit, and native final-balance invoices with manual payment or authorized stored-method charging. Its owner portal reads leads, deposits, persistent invoice history and ingested custom pixel events directly from Whop. It also verifies signed webhooks and keeps sandbox identities, plans and payment credentials separate from production. Invoice issuance remains gated by this merchant's Whop verification.

Roman Urdu instructions: [docs/SAMJHAI.md](docs/SAMJHAI.md).
