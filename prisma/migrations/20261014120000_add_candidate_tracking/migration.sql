-- CreateEnum
CREATE TYPE "screening_status" AS ENUM ('SHORTLIST', 'REJECT', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "processing_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE IF NOT EXISTS "candidate" (
    "id" SERIAL NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "job_role" TEXT,
    "normalized_role" TEXT,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "education" JSONB NOT NULL DEFAULT '[]',
    "experience" JSONB NOT NULL DEFAULT '[]',
    "projects" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL,
    "match_score" INTEGER NOT NULL,
    "matched_requirements" JSONB NOT NULL DEFAULT '[]',
    "missing_requirements" JSONB NOT NULL DEFAULT '[]',
    "screening_status" "screening_status" NOT NULL,
    "screening_explanation" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "assigned_hr_id" TEXT,
    "assigned_hr_email" TEXT,
    "assigned_hr_name" TEXT,
    "processing_status" "processing_status" NOT NULL DEFAULT 'COMPLETED',
    "notification_status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "notification_attempts" INTEGER NOT NULL DEFAULT 0,
    "notification_error" TEXT,
    "notified_at" TIMESTAMP(3),
    "gmail_message_id" TEXT NOT NULL,
    "gmail_thread_id" TEXT,
    "attachment_id" TEXT,
    "filename" TEXT,
    "mime_type" TEXT,
    "attachment_size" INTEGER,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "candidate_notification_log" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "notification_status" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_idempotency_key_key" ON "candidate"("idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_screening_status_idx" ON "candidate"("screening_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_normalized_role_idx" ON "candidate"("normalized_role");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_assigned_hr_email_idx" ON "candidate"("assigned_hr_email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_notification_status_idx" ON "candidate"("notification_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_created_at_idx" ON "candidate"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_notification_log_candidate_id_idx" ON "candidate_notification_log"("candidate_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidate_notification_log_candidate_id_fkey'
  ) THEN
    ALTER TABLE "candidate_notification_log" ADD CONSTRAINT "candidate_notification_log_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
