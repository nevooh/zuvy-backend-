const admin = require('firebase-admin');
const pool  = require('../config/db');

// ── Initialize Firebase Admin (once) ─────────────────────────────────────────
// Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
// OR set FIREBASE_SERVICE_ACCOUNT_JSON env var with the JSON string directly
if (!admin.apps.length) {
  try {
    const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
      : admin.credential.applicationDefault();

    admin.initializeApp({ credential });
  } catch (err) {
    console.error('[FCM] Firebase admin init failed:', err.message);
  }
}

// ── Send to one token ─────────────────────────────────────────────────────────
async function sendToToken(fcmToken, { title, body, data = {} }) {
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { channelId: 'zuvy_school', sound: 'default' },
      },
    });
  } catch (err) {
    // Token invalid — clean it up
    if (
      err.code === 'messaging/invalid-registration-token' ||
      err.code === 'messaging/registration-token-not-registered'
    ) {
      await pool.query(
        `UPDATE parent_devices SET fcm_token = NULL WHERE fcm_token = $1`,
        [fcmToken]
      ).catch(() => {});
    }
  }
}

// ── Send to all devices of a school ──────────────────────────────────────────
async function sendToSchool(schoolId, payload) {
  const { rows } = await pool.query(
    `SELECT DISTINCT pd.fcm_token
     FROM parent_devices pd
     JOIN students s ON s.parent_phone = pd.phone
     WHERE s.school_id = $1
       AND pd.fcm_token IS NOT NULL
     UNION
     SELECT DISTINCT pd.fcm_token
     FROM parent_devices pd
     JOIN teachers t ON t.phone = pd.phone
     WHERE t.school_id = $1
       AND pd.fcm_token IS NOT NULL`,
    [schoolId]
  );
  await Promise.allSettled(
    rows.map(r => sendToToken(r.fcm_token, payload))
  );
}

// ── Send to parent of a specific student ─────────────────────────────────────
async function sendToStudent(studentId, payload) {
  const { rows } = await pool.query(
    `SELECT pd.fcm_token
     FROM parent_devices pd
     JOIN students s ON s.parent_phone = pd.phone
     WHERE s.id = $1 AND pd.fcm_token IS NOT NULL`,
    [studentId]
  );
  await Promise.allSettled(
    rows.map(r => sendToToken(r.fcm_token, payload))
  );
}

// ── Send to a specific teacher ────────────────────────────────────────────────
async function sendToTeacher(teacherId, payload) {
  const { rows } = await pool.query(
    `SELECT pd.fcm_token
     FROM parent_devices pd
     JOIN teachers t ON t.phone = pd.phone
     WHERE t.id = $1 AND pd.fcm_token IS NOT NULL`,
    [teacherId]
  );
  await Promise.allSettled(
    rows.map(r => sendToToken(r.fcm_token, payload))
  );
}

module.exports = { sendToToken, sendToSchool, sendToStudent, sendToTeacher };
