-- persist active school days per school + level
CREATE TABLE IF NOT EXISTS timetable_settings (
  school_id   UUID        NOT NULL,
  level_type  VARCHAR(20) NOT NULL DEFAULT 'primary',
  active_days INTEGER[]   NOT NULL DEFAULT '{1,2,3,4,5}',
  PRIMARY KEY (school_id, level_type)
);

-- room assignment on timetable entries
ALTER TABLE timetable ADD COLUMN IF NOT EXISTS room VARCHAR(50);
