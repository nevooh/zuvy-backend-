-- Fix subjects unique constraint to be scoped per school.
-- Uses plain ALTER TABLE ... DROP CONSTRAINT IF EXISTS — no PL/pgSQL,
-- no risk of accidentally touching the primary key or constraint-backed indexes.

ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_name_key;
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_name_school_level_key;
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_name_code_key;
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_code_key;
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_name_school_level_idx;

CREATE UNIQUE INDEX IF NOT EXISTS unique_subject_name_per_school_level
  ON subjects (school_id, name, school_level);
