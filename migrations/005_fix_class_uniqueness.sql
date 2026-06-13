-- Migration 005: Allow archived classes to share names across academic years
-- The old constraint prevented promotion: archiving grade 8 and then inserting
-- a new grade 8 for the promoted grade 7s violated the unique key.
-- Replace it with a partial index that only enforces uniqueness on active classes.

-- Drop the old full-table unique constraint
ALTER TABLE public.classes
  DROP CONSTRAINT IF EXISTS unique_class_stream_per_school;

-- New partial unique index: only active (non-archived) classes must be unique
-- This allows multiple archived classes with the same name (different years)
-- while still preventing duplicate active classes.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_class_stream_per_school
  ON public.classes (school_id, class_name, COALESCE(stream_name, ''))
  WHERE (is_archived = false OR is_archived IS NULL);
