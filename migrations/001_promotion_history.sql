-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Year-End Promotion history
-- Run once against your Supabase / Postgres DB
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Audit table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promotion_history (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID        NOT NULL,
  student_id      UUID        NOT NULL,
  from_class_id   UUID,
  to_class_id     UUID,
  from_class_name TEXT,
  to_class_name   TEXT,
  action          TEXT        NOT NULL CHECK (action IN ('promoted', 'graduated')),
  promoted_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_history_school
  ON public.promotion_history (school_id, promoted_at DESC);

CREATE INDEX IF NOT EXISTS idx_promo_history_student
  ON public.promotion_history (student_id);

-- 2. Trigger function ─────────────────────────────────────────────────────────
--    Fires on any UPDATE to students.class_id  OR  status → 'GRADUATED'
CREATE OR REPLACE FUNCTION public.trg_log_student_class_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_from_name TEXT;
  v_to_name   TEXT;
  v_action    TEXT;
BEGIN
  IF (OLD.class_id IS DISTINCT FROM NEW.class_id)
  OR (OLD.status  IS DISTINCT FROM NEW.status AND NEW.status = 'GRADUATED')
  THEN
    SELECT class_name INTO v_from_name
      FROM public.classes WHERE id = OLD.class_id;

    IF NEW.status = 'GRADUATED' THEN
      v_to_name := 'Alumni';
      v_action  := 'graduated';
    ELSE
      SELECT class_name INTO v_to_name
        FROM public.classes WHERE id = NEW.class_id;
      v_action := 'promoted';
    END IF;

    INSERT INTO public.promotion_history
      (school_id, student_id, from_class_id, to_class_id,
       from_class_name, to_class_name, action)
    VALUES
      (NEW.school_id, NEW.id, OLD.class_id, NEW.class_id,
       v_from_name, v_to_name, v_action);
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Attach trigger ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_student_class_change ON public.students;
CREATE TRIGGER trg_student_class_change
  AFTER UPDATE ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_student_class_change();
