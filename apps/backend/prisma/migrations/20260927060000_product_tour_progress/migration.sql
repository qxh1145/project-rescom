-- Interactive product tours (Design canvas section 20): tour progress is kept
-- per account so a finished or dismissed tour is not offered again on another
-- device. Re-runnable like the other drift-tolerant migrations.

DO $$ BEGIN
  CREATE TYPE "ProductTourId" AS ENUM ('FIRST_SURVEY', 'FIRST_PUBLISH', 'TRACK_SURVEY', 'FORM_BUILDER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ProductTourStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'DISMISSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "product_tour_progress" (
    "user_id" UUID NOT NULL,
    "tour_id" "ProductTourId" NOT NULL,
    "status" "ProductTourStatus" NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_tour_progress_pkey" PRIMARY KEY ("user_id", "tour_id")
);

DO $$ BEGIN
  ALTER TABLE "product_tour_progress"
    ADD CONSTRAINT "product_tour_progress_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
