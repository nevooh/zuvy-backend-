-- Parent/teacher device FCM tokens for push notifications
CREATE TABLE IF NOT EXISTS parent_devices (
  id         SERIAL PRIMARY KEY,
  phone      VARCHAR(20) NOT NULL UNIQUE,
  fcm_token  TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parent_devices_phone ON parent_devices(phone);
CREATE INDEX IF NOT EXISTS idx_parent_devices_token ON parent_devices(fcm_token) WHERE fcm_token IS NOT NULL;
