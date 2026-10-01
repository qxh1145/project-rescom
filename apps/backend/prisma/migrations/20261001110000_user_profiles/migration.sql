-- Story IR.4b part A (FR-9): the onboarding answers that are not FR-6
-- matching fields (display name, birth year, school, school year, goal) get
-- their own Identity-owned table instead of the `demographic_profiles` JSON
-- column, so `PATCH /users/me/profile` is a single-row upsert with no
-- read-merge-write lock. FR-9 amendment 2026-09-26: `school` = university and
-- `school_year` = academic year; neither is a matching field. `birth_year` is
-- for display and prefill only: `demographic_profiles.age` stays the matching
-- field. A user without a row reads as all-null.
--
-- Expand-only and re-runnable like 20260927060000_product_tour_progress.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "UserGoal" AS ENUM ('EARN', 'COLLECT', 'BOTH');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(50),
    "birth_year" INTEGER,
    "school" VARCHAR(200),
    "school_year" VARCHAR(20),
    "goal" "UserGoal",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
