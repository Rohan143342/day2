-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'PROFILE_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REFERRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('SALARIED', 'SELF_EMPLOYED', 'BUSINESS_OWNER');

-- CreateEnum
CREATE TYPE "IncomeVerificationMethod" AS ENUM ('DECLARED', 'BANK_STATEMENT', 'PAYSLIP');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVE', 'REFER', 'REJECT');

-- CreateTable
CREATE TABLE "loan_applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "device_id" UUID,
    "requested_amount" DECIMAL(20,4) NOT NULL,
    "requested_tenure_months" INTEGER NOT NULL,
    "purpose_code" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" BIGSERIAL NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" "ApplicationStatus",
    "to_status" "ApplicationStatus" NOT NULL,
    "reason" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant_profiles" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employment_type" "EmploymentType" NOT NULL,
    "employer_name_encrypted" TEXT,
    "work_experience_months" INTEGER NOT NULL,
    "monthly_income" DECIMAL(20,4) NOT NULL,
    "existing_monthly_emi" DECIMAL(20,4) NOT NULL,
    "income_verification" "IncomeVerificationMethod" NOT NULL DEFAULT 'DECLARED',
    "residence_state" TEXT NOT NULL,
    "residence_pincode" VARCHAR(6) NOT NULL,
    "date_of_birth_encrypted" TEXT NOT NULL,
    "age_years" INTEGER NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applicant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_decisions" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "policy_version" TEXT NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "reason_codes" TEXT[],
    "eligible_amount" DECIMAL(20,4),
    "eligible_tenure_months" INTEGER,
    "offered_rate_percent" DECIMAL(9,4),
    "foir" DECIMAL(9,4),
    "fraud_score" INTEGER NOT NULL DEFAULT 0,
    "fraud_signals" TEXT[],
    "inputs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_applications_user_id_status_created_at_idx" ON "loan_applications"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "application_status_history_application_id_created_at_idx" ON "application_status_history"("application_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_profiles_application_id_key" ON "applicant_profiles"("application_id");

-- CreateIndex
CREATE INDEX "applicant_profiles_user_id_idx" ON "applicant_profiles"("user_id");

-- CreateIndex
CREATE INDEX "risk_decisions_application_id_created_at_idx" ON "risk_decisions"("application_id", "created_at");

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_product_version_id_fkey" FOREIGN KEY ("product_version_id") REFERENCES "loan_product_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "loan_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "loan_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_decisions" ADD CONSTRAINT "risk_decisions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "loan_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
