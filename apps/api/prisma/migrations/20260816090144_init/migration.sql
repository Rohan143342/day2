-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DeviceTrustState" AS ENUM ('UNVERIFIED', 'TRUSTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTRATION', 'LOGIN', 'DEVICE_VERIFICATION', 'BANK_ACCOUNT_CHANGE');

-- CreateEnum
CREATE TYPE "InterestMethodology" AS ENUM ('REDUCING_BALANCE', 'FLAT');

-- CreateEnum
CREATE TYPE "RepaymentFrequency" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "FeeCollection" AS ENUM ('DEDUCT_FROM_DISBURSEMENT', 'COLLECTED_SEPARATELY');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LenderStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "phone_blind_index" TEXT NOT NULL,
    "phone_last4" VARCHAR(4) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "installation_id" TEXT NOT NULL,
    "model" TEXT,
    "os_version" TEXT,
    "app_version" TEXT,
    "integrity_verdict" TEXT,
    "trust_state" "DeviceTrustState" NOT NULL DEFAULT 'UNVERIFIED',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "rotated_from_id" UUID,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "ip_hash" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_purposes" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "data_categories" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_purposes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "consent_texts" (
    "id" UUID NOT NULL,
    "purpose_code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "body" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose_code" TEXT NOT NULL,
    "text_version" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "withdrawn_at" TIMESTAMP(3),
    "ip_hash" TEXT,
    "device_id" UUID,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lenders" (
    "id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "license_type" TEXT NOT NULL,
    "license_reference" TEXT NOT NULL,
    "grievance_officer_name" TEXT NOT NULL,
    "grievance_email" TEXT NOT NULL,
    "grievance_phone" TEXT NOT NULL,
    "status" "LenderStatus" NOT NULL DEFAULT 'ONBOARDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_products" (
    "id" UUID NOT NULL,
    "lender_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_product_versions" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "min_amount" DECIMAL(20,4) NOT NULL,
    "max_amount" DECIMAL(20,4) NOT NULL,
    "min_tenure_months" INTEGER NOT NULL,
    "max_tenure_months" INTEGER NOT NULL,
    "interest_methodology" "InterestMethodology" NOT NULL,
    "annual_rate_percent" DECIMAL(9,4) NOT NULL,
    "repayment_frequency" "RepaymentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "processing_fee_percent" DECIMAL(9,4) NOT NULL,
    "processing_fee_min" DECIMAL(20,4),
    "processing_fee_max" DECIMAL(20,4),
    "tax_on_fees_percent" DECIMAL(9,4) NOT NULL,
    "fee_collection" "FeeCollection" NOT NULL,
    "late_payment_fee_percent" DECIMAL(9,4) NOT NULL,
    "late_payment_grace_days" INTEGER NOT NULL,
    "allocation_order" TEXT[],
    "cooling_off_days" INTEGER NOT NULL,
    "min_age_years" INTEGER NOT NULL,
    "max_age_years" INTEGER NOT NULL,
    "min_monthly_income" DECIMAL(20,4) NOT NULL,
    "allowed_states" TEXT[],
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "ip_hash" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "user_id" UUID,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_blind_index_key" ON "users"("phone_blind_index");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_installation_id_key" ON "devices"("user_id", "installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_family_id_idx" ON "sessions"("user_id", "family_id");

-- CreateIndex
CREATE INDEX "otp_challenges_user_id_purpose_created_at_idx" ON "otp_challenges"("user_id", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "consent_texts_purpose_code_version_locale_key" ON "consent_texts"("purpose_code", "version", "locale");

-- CreateIndex
CREATE INDEX "consents_user_id_purpose_code_granted_at_idx" ON "consents"("user_id", "purpose_code", "granted_at");

-- CreateIndex
CREATE UNIQUE INDEX "loan_products_lender_id_code_key" ON "loan_products"("lender_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "loan_product_versions_product_id_version_key" ON "loan_product_versions"("product_id", "version");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_texts" ADD CONSTRAINT "consent_texts_purpose_code_fkey" FOREIGN KEY ("purpose_code") REFERENCES "consent_purposes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_purpose_code_fkey" FOREIGN KEY ("purpose_code") REFERENCES "consent_purposes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_products" ADD CONSTRAINT "loan_products_lender_id_fkey" FOREIGN KEY ("lender_id") REFERENCES "lenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_product_versions" ADD CONSTRAINT "loan_product_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "loan_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
