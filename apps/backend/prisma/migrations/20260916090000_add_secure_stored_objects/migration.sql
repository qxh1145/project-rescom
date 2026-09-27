CREATE TYPE "StoredObjectStatus" AS ENUM (
  'INITIATED', 'UPLOADED', 'QUARANTINED', 'CLEAN', 'ATTACHED',
  'REJECTED', 'EXPIRED', 'DELETED'
);

CREATE TYPE "StoredObjectScanStatus" AS ENUM (
  'PENDING', 'CLEAN', 'INFECTED', 'OUTAGE', 'SKIPPED'
);

CREATE TYPE "StorageDataClass" AS ENUM (
  'SURVEY_ATTACHMENT', 'EVIDENCE', 'EXPORT'
);

CREATE TABLE "stored_objects" (
  "id" UUID NOT NULL,
  "owner_context" TEXT NOT NULL,
  "owner_record_id" UUID NOT NULL,
  "question_id" TEXT,
  "data_class" "StorageDataClass" NOT NULL DEFAULT 'SURVEY_ATTACHMENT',
  "storage_key" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "mime_type" TEXT NOT NULL,
  "checksum" TEXT,
  "status" "StoredObjectStatus" NOT NULL DEFAULT 'INITIATED',
  "scan_status" "StoredObjectScanStatus" NOT NULL DEFAULT 'PENDING',
  "scan_policy" TEXT,
  "scan_result" JSONB,
  "uploaded_at" TIMESTAMP(3),
  "scanned_at" TIMESTAMP(3),
  "attached_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stored_objects_storage_key_key"
  ON "stored_objects"("storage_key");
CREATE INDEX "stored_objects_owner_context_owner_record_id_idx"
  ON "stored_objects"("owner_context", "owner_record_id");
CREATE INDEX "stored_objects_owner_context_owner_record_id_question_id_idx"
  ON "stored_objects"("owner_context", "owner_record_id", "question_id");
CREATE INDEX "stored_objects_status_scan_status_idx"
  ON "stored_objects"("status", "scan_status");
