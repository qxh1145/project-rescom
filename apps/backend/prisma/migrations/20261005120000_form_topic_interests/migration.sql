-- 2026-10-05: survey topics now follow the onboarding interests list
-- (@rescom/schemas FORM_TOPICS). IT, MARKETING, BUSINESS and OTHER keep their
-- values; the five removed topics move to their closest new one, matching
-- LEGACY_FORM_TOPICS. Data-only and re-runnable (old values no longer exist
-- after the first run).

UPDATE "forms" SET "topic" = CASE "topic"
  WHEN 'HEALTH' THEN 'MENTAL_HEALTH'
  WHEN 'STUDENT_LIFE' THEN 'EDUCATION'
  WHEN 'DESIGN' THEN 'ARTS_MUSIC'
  WHEN 'SOCIAL_SCIENCES' THEN 'SCHOOL_PSYCHOLOGY'
  WHEN 'ENGINEERING' THEN 'RESEARCH'
END
WHERE "topic" IN ('HEALTH', 'STUDENT_LIFE', 'DESIGN', 'SOCIAL_SCIENCES', 'ENGINEERING');
