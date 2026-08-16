# Digital lending platform (India) — Phase 0/1

Technology platform for a digital personal-loan journey where an **RBI-regulated
lender (NBFC or bank) is the lender of record**. This repository is the platform,
not a lender. Nothing here is production ready: see
[Open compliance dependencies](#open-compliance-dependencies).

## What exists today

| Area | Status |
| --- | --- |
| `packages/money` — exact monetary arithmetic, amortization, APR, fee/tax, repayment allocation, affordability/FOIR | implemented, 45 tests |
| Identity, consent, lender/product, audit, idempotency, outbox schema | implemented (Prisma migration) |
| OTP authentication, device registry, refresh-token rotation with replay detection | implemented, e2e tested |
| Granular consent capture and withdrawal | implemented, e2e tested |
| Product listing and server-computed quote (EMI, fees, tax, APR, full schedule) | implemented, e2e tested |
| KYC provider abstraction (PAN + offline-Aadhaar OTP) with mock provider, encrypted documents, duplicate-document detection | implemented, e2e tested |
| Loan application lifecycle (state machine, append-only transition history) and financial/employment onboarding | implemented, e2e tested |
| Rule-based credit decisioning with a versioned policy, reason codes and retained decision inputs; weighted fraud signals | implemented, e2e tested |
| Credit bureau enquiry, binding offers/KFS, e-sign, ledger, disbursement, repayments, support, admin, mobile app | **not implemented** |

## Design principles enforced in code

- **No floating-point money.** `Money` holds integer paise as `bigint`; rates are
  `decimal.js`; database money columns are `NUMERIC(20,4)`.
- **Pricing is configuration, never code.** Rate, fees, tax, tenure, allocation
  order and eligibility live in immutable `LoanProductVersion` rows so repricing a
  product cannot reprice a live loan.
- **No mock provider can run in production.** `SMS_PROVIDER=mock` (and every
  future provider switch) is rejected at startup when `NODE_ENV=production`, and an
  unknown provider value fails startup rather than falling back to a mock.
- **PII is encrypted at field level** (AES-256-GCM) with HMAC blind indexes for
  exact lookup. Phone numbers are never stored or logged in plaintext; OTPs are
  stored only as scrypt hashes with a server-side pepper.
- **Deny by default.** Every route requires authentication unless explicitly
  marked `@Public()`, and each request re-checks the session against the database
  so revoking a device takes effect immediately.
- **Every state change is auditable.** Audit rows and outbox events are written in
  the same transaction as the change they describe.
- **Idempotency is enforced by the database**, not by application logic, so two
  concurrent identical financial requests cannot both proceed.
- **No dark patterns.** Consent is captured per purpose against a specific text
  version; there is no bundled "accept all", and declining an optional purpose has
  no effect on the application.

## Local setup

Requires Node 20+, PostgreSQL 14+.

```bash
npm install
createdb lending                       # or: psql -c 'CREATE DATABASE lending'
cp apps/api/.env.example apps/api/.env # then fill in the generated keys below
```

Generate development key material (never reuse these anywhere real):

```bash
openssl rand -hex 32     # JWT_SECRET
openssl rand -base64 32  # FIELD_ENCRYPTION_KEY, BLIND_INDEX_KEY, OTP_PEPPER
```

```bash
npm run prisma:migrate:dev --workspace @lending/api
npm run seed --workspace @lending/api   # consent purposes + a DRAFT placeholder product
npm run start:dev --workspace @lending/api
```

API docs at `http://localhost:3000/api/docs`. Probes: `/healthz`, `/readyz`.

```bash
npm run lint
npm run typecheck
npm test
```

The seeded lender and product are development placeholders, marked as such, and
the product version stays `DRAFT` — real lender identity, licence reference,
grievance contacts and pricing must come from an executed lender agreement.

## Repository layout

```
packages/money      exact money, amortization, APR, allocation, affordability (no framework deps)
apps/api            NestJS modular monolith: auth, consent, products, kyc, applications, risk
apps/api/prisma     schema, migrations, development seed
```

## Open compliance dependencies

The following are unresolved and block any real launch. None of them can be
closed by writing code:

1. Confirm the operating model (platform + regulated lender of record) and execute
   the lender agreement, including any first-loss arrangement.
2. Legal review of the operating model, the loan agreement, the key fact
   statement, the pricing disclosure, and the grievance-redressal process.
3. Real lender identity, licence details and grievance officer contacts.
4. Approved v1 product parameters (amount band, tenure, rate, fees, taxes,
   penalties, cooling-off period).
5. Credit-committee sign-off of the credit policy in
   `apps/api/src/modules/risk/policy.ts`. The shipped version is `v1-dev`: its
   FOIR ceiling, employment-history minimums and fraud thresholds are development
   defaults, and it decides on declared income with no bureau enquiry and no
   income verification, so it must not decision a real customer as it stands.
6. KYC provider, credit bureau, payment/disbursement rails and e-sign vendors,
   with contracts and production credentials held in a secrets manager.
7. Data-residency, retention and deletion policy sign-off.
8. Independent security review and penetration test.

Until these are closed, no part of this system may be used to make a credit
decision, take money from a customer, or disburse funds.
