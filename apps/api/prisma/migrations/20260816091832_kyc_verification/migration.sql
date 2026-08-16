-- CreateEnum
CREATE TYPE "KycMethod" AS ENUM ('PAN', 'AADHAAR_OFFLINE_XML');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('INITIATED', 'AWAITING_OTP', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW', 'EXPIRED');

-- CreateTable
CREATE TABLE "kyc_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "KycMethod" NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'INITIATED',
    "provider_name" TEXT NOT NULL,
    "provider_reference" TEXT,
    "document_number_encrypted" TEXT,
    "document_blind_index" TEXT,
    "document_last4" VARCHAR(4),
    "name_encrypted" TEXT,
    "dob_encrypted" TEXT,
    "address_encrypted" TEXT,
    "name_match_score" DECIMAL(5,4),
    "failure_code" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_verifications_user_id_method_created_at_idx" ON "kyc_verifications"("user_id", "method", "created_at");

-- CreateIndex
CREATE INDEX "kyc_verifications_document_blind_index_idx" ON "kyc_verifications"("document_blind_index");

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
