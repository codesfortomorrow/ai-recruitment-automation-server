-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'excel_sync_status') THEN
    CREATE TYPE "excel_sync_status" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'excel_sync_trigger') THEN
    CREATE TYPE "excel_sync_trigger" AS ENUM ('SCHEDULED', 'MANUAL');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "excel_sync_log" (
    "id" SERIAL NOT NULL,
    "file_hash" TEXT,
    "status" "excel_sync_status" NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER NOT NULL,
    "trigger_source" "excel_sync_trigger" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "excel_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "excel_sync_log_status_idx" ON "excel_sync_log"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "excel_sync_log_completed_at_idx" ON "excel_sync_log"("completed_at");
