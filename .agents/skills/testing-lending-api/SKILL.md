---
name: testing-lending-api
description: How to run and end-to-end test the NestJS/Prisma lending API (apps/api) over real HTTP, including how to obtain OTPs from the mock SMS provider, how to create quotable products, and which deterministic mock KYC vectors exist.
---

# Testing the lending API end to end

There is no frontend. Everything is an HTTP API under `/api/v1/...`, deny-by-default authenticated.
Health probes are version-neutral: `GET /healthz`, `GET /readyz`. Swagger at `/api/docs` when
`SWAGGER_ENABLED=true` (not in production).

## Bring-up

```bash
npm install                                        # repo root, npm workspaces
cd apps/api
npx prisma generate && npx prisma migrate deploy && npx ts-node prisma/seed.ts
npm run start:dev                                  # PORT from .env, default 3000
```

Requires a local PostgreSQL with database `lending` (dev credentials live in `apps/api/.env`,
which also sets `SMS_PROVIDER=mock` and `KYC_PROVIDER=mock`). Check the port is free first —
a stale `node dist/main.js` from an earlier session may already hold 3000 and serve an older
build (symptom: `/healthz` returns 404 while `/api/docs` returns 200). Use another port instead
of killing it if you are not sure who owns it.

## Getting the OTP (the main obstacle)

The mock SMS provider does not print the OTP and the database stores only a scrypt hash, so the
OTP cannot be recovered out of process. Do **not** patch product code to expose it. Two options:

1. Jest e2e (`apps/api/test/*.e2e-spec.ts`): read `app.get(MockSmsProvider).sent` in-process.
2. For real end-to-end HTTP testing, boot the app in a throwaway harness that mirrors `src/main.ts`
   (same `ValidationPipe`, `enableVersioning({type: URI, prefix:'v'})`, `setGlobalPrefix('api',
   {exclude:['healthz','readyz']})`) and expose a **test-only sidecar HTTP port** returning the
   last `MockSmsProvider.sent[].variables.code` for a phone. Keep the harness outside git or delete
   it afterwards. A working copy is at `/home/ubuntu/testing-artifacts/harness.ts` in the session
   that wrote this skill; recreate it as `apps/api/harness.ts` and run with
   `PORT=3100 SIDECAR_PORT=3999 npx ts-node -T harness.ts`.

Auth throttles that will bite a test script: one OTP per 30 s per user, 5 per 15 min, 5 wrong
attempts per challenge. Use a fresh random `+91[6-9]XXXXXXXXX` per login.
`device.installationId` must be **8–128 characters** or verify returns 400.

## Making a quotable product

The seeded dev product is deliberately `DRAFT` and must never quote (404). Create fixtures directly
in the DB — copy the field set from `apps/api/test/products.e2e-spec.ts`: an `ACTIVE` `Lender`, a
`LoanProduct`, and a `LoanProductVersion` with `status: 'ACTIVE'` and `effectiveFrom` in the past.
A version is non-offerable (404) if it is not ACTIVE, is future-dated, has `effectiveTo` in the
past, or its lender is not `ACTIVE`.

Quotes are gated on consent: `POST /api/v1/consents` with
`{decisions:[{purposeCode:'IDENTITY_VERIFICATION', textVersion:1, granted:true}]}` first, otherwise
quote and KYC return 403 `CONSENT_REQUIRED`. The echoed `textVersion` must match a row in
`consent_texts` or the API returns 409.

## Deterministic mock KYC vectors

- PAN 4th character must be `P` (individual) — anything else fails `DOCUMENT_INACTIVE`.
- PAN starting `ZZZZZ` → `DOCUMENT_NOT_FOUND`.
- Claimed name starting `MISMATCH` → `MANUAL_REVIEW` / `NAME_MISMATCH`.
- Offline-Aadhaar OTP is always `123456`; the challenge lives **in process memory**, so restarting
  the server invalidates pending Aadhaar verifications.
- Documents are single-use across accounts: reusing a PAN/Aadhaar already VERIFIED by another user
  returns 409 `KYC_DOCUMENT_ALREADY_USED`. **Randomise PAN/Aadhaar per test run**, otherwise a
  second run of the same script fails with 409 on data left behind by the first.

## Verifying financial output independently

Never assert quote figures against the same library that produced them. Recompute EMI, schedule and
APR with an independent tool (e.g. Python `decimal`): EMI = `P*i*(1+i)^n/((1+i)^n-1)` rounded
half-even to paise, interest per period on the opening balance, residue absorbed by the final
instalment, and APR = the periodic IRR that discounts the instalments back to `netDisbursed`,
annualised ×12. Remember the configured processing-fee **min/max clamp** when reproducing fees —
forgetting it looks like a product bug when it is not.

## Idempotency

`@Idempotent()` exists (`src/common/idempotency.interceptor.ts`) but as of phase 1 **no route uses
it**, so an `Idempotency-Key` header is silently ignored and no `idempotency_keys` row is written.
Grep for `Idempotent()` in `apps/api/src` before writing idempotency tests.

## Devin secrets needed

None. All keys used are the dev-only values committed in `apps/api/.env`.
