const pool = require('./db');

async function runMigrations() {
  try {
    await pool.query(`
      ALTER TABLE sent_sms
        ADD COLUMN IF NOT EXISTS batch_id      UUID,
        ADD COLUMN IF NOT EXISTS status        VARCHAR(20) DEFAULT 'sent',
        ADD COLUMN IF NOT EXISTS at_message_id VARCHAR(100);

      CREATE INDEX IF NOT EXISTS idx_sent_sms_batch_id
        ON sent_sms(batch_id);

      CREATE INDEX IF NOT EXISTS idx_sent_sms_at_message_id
        ON sent_sms(at_message_id);
    `);

    // 005: allow archived classes to share names across academic years
    // Partial unique index only enforces uniqueness on active classes,
    // so promotion can archive grade 8 and create a new grade 8 in one transaction.
    await pool.query(`
      ALTER TABLE public.classes
        DROP CONSTRAINT IF EXISTS unique_class_stream_per_school;

      CREATE UNIQUE INDEX IF NOT EXISTS unique_active_class_stream_per_school
        ON public.classes (school_id, class_name, COALESCE(stream_name, ''))
        WHERE (is_archived = false OR is_archived IS NULL);
    `);

    // pending_registrations: holds form data between OTP request and verification
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_registrations (
        phone          VARCHAR(20) PRIMARY KEY,
        school_name    TEXT        NOT NULL,
        admin_name     TEXT        NOT NULL,
        admin_email    TEXT        NOT NULL DEFAULT '',
        county         TEXT        DEFAULT '',
        student_count  INT         DEFAULT 0,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE pending_registrations
        ADD COLUMN IF NOT EXISTS admin_email TEXT NOT NULL DEFAULT '';
    `);

    // Add phone column to users if not already there
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_billing (
        id               SERIAL PRIMARY KEY,
        school_id        UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        billing_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        amount_due       INT         NOT NULL DEFAULT 0,
        amount_paid      INT         NOT NULL DEFAULT 0,
        status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        next_billing_date TIMESTAMPTZ,
        paid_at          TIMESTAMPTZ,
        note             TEXT        DEFAULT '',
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // master admin enriched school fields
    await pool.query(`
      ALTER TABLE schools
        ADD COLUMN IF NOT EXISTS county        TEXT         DEFAULT '',
        ADD COLUMN IF NOT EXISTS plan          TEXT         DEFAULT 'trial',
        ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS billing_type  TEXT         DEFAULT 'termly';
    `);

    // billing settings — create table + add columns first, then seed row
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_settings (
        id                   SERIAL PRIMARY KEY,
        annual_rate          INT  NOT NULL DEFAULT 150,
        termly_rate          INT  NOT NULL DEFAULT 60,
        default_billing_type TEXT NOT NULL DEFAULT 'termly',
        updated_at           TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE billing_settings
        ADD COLUMN IF NOT EXISTS grace_days   INT NOT NULL DEFAULT 21,
        ADD COLUMN IF NOT EXISTS warning_days INT NOT NULL DEFAULT 3;
    `);
    await pool.query(`
      INSERT INTO billing_settings (annual_rate, termly_rate, default_billing_type, grace_days, warning_days)
      SELECT 150, 60, 'termly', 21, 3
      WHERE NOT EXISTS (SELECT 1 FROM billing_settings);
    `);

    // invoices table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id             SERIAL PRIMARY KEY,
        school_id      UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        invoice_number VARCHAR(20) UNIQUE NOT NULL,
        student_count  INT         NOT NULL DEFAULT 0,
        amount_due     INT         NOT NULL DEFAULT 0,
        amount_paid    INT         NOT NULL DEFAULT 0,
        billing_type   VARCHAR(10) NOT NULL DEFAULT 'termly',
        status         VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        due_date       TIMESTAMPTZ NOT NULL,
        paid_at        TIMESTAMPTZ,
        payment_method VARCHAR(30),
        payment_ref    VARCHAR(100),
        period_start   TIMESTAMPTZ NOT NULL,
        period_end     TIMESTAMPTZ NOT NULL,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_school_id ON invoices(school_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status    ON invoices(status);
    `);

    // platform_settings: global master-configurable values (SMS rate, min top-up, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key        VARCHAR(100) PRIMARY KEY,
        value      TEXT         NOT NULL,
        updated_at TIMESTAMPTZ  DEFAULT NOW()
      );
      INSERT INTO platform_settings (key, value) VALUES
        ('sms_rate_per_sms', '2.0'),
        ('sms_min_top_up',   '100')
      ON CONFLICT (key) DO NOTHING;
    `);

    // 004: add short_form column to subjects (migration file was never wired in)
    await pool.query(`
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS short_form VARCHAR(100);
    `);

    // 008: add bank_account to school_profiles for receipt display
    await pool.query(`
      ALTER TABLE school_profiles ADD COLUMN IF NOT EXISTS bank_account VARCHAR(200) DEFAULT '';
    `);

    // 007: subjects unique constraint must be scoped per school.
    // Use ALTER TABLE ... DROP CONSTRAINT IF EXISTS (plain SQL, no PL/pgSQL,
    // no risk of hitting primary-key or constraint-backed indexes).
    await pool.query(`
      ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_name_key;
      ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_name_school_level_key;
      ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_name_code_key;
      ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_code_key;
      ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_name_school_level_idx;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS unique_subject_name_per_school_level
        ON subjects (school_id, name, school_level);
    `);

    // 009: admin_accounts table for sub-admin management
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_accounts (
        id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        school_id        UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        role_level       VARCHAR(20)  NOT NULL DEFAULT 'sub' CHECK (role_level IN ('main', 'sub')),
        is_active        BOOLEAN      NOT NULL DEFAULT true,
        created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
        created_at       TIMESTAMPTZ  DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  DEFAULT NOW(),
        UNIQUE(user_id, school_id)
      );
      CREATE INDEX IF NOT EXISTS idx_admin_accounts_school_id ON admin_accounts(school_id);
      CREATE INDEX IF NOT EXISTS idx_admin_accounts_role_level ON admin_accounts(role_level);
    `);

    console.log('✅ Migrations applied');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  }
}

module.exports = runMigrations;
