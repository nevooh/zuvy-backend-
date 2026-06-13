-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002: Destructive Stream-Preserving Promotion
-- Run once in your PostgreSQL database
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add new columns to classes ───────────────────────────────────────────────
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS academic_year       INT     DEFAULT EXTRACT(YEAR FROM NOW())::int,
  ADD COLUMN IF NOT EXISTS previous_stream_id  UUID    REFERENCES public.classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_archived         BOOLEAN DEFAULT false;

-- 2. Backfill existing classes ────────────────────────────────────────────────
UPDATE public.classes
SET
  academic_year = EXTRACT(YEAR FROM NOW())::int,
  is_archived   = false
WHERE academic_year IS NULL OR is_archived IS NULL;

-- 3. Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_classes_school_year_archived
  ON public.classes (school_id, academic_year, is_archived);

CREATE INDEX IF NOT EXISTS idx_classes_previous_stream
  ON public.classes (previous_stream_id);
