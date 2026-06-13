const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const MASTER_EMAIL = 'zuvytechnologies@gmail.com';
const FROM         = 'Zuvy Network <onboarding@resend.dev>';

// ── Send school-deleted audit email to master admin ───────────────────────
async function sendSchoolDeletedEmail({ schoolName, schoolEmail, deletedAt, restoreDeadline }) {
  try {
    await resend.emails.send({
      from:    FROM,
      to:      MASTER_EMAIL,
      subject: `[Zuvy] School moved to trash: ${schoolName}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h2 style="margin:0 0 8px;color:#991B1B;font-size:18px">School Moved to Trash</h2>
            <p style="margin:0;color:#7F1D1D;font-size:14px">This school has been soft-deleted and will be permanently removed after 90 days.</p>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;color:#0F172A">
            <tr><td style="padding:10px 0;border-bottom:1px solid #F1F5F9;color:#64748B;width:140px">School Name</td><td style="padding:10px 0;border-bottom:1px solid #F1F5F9;font-weight:700">${schoolName}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #F1F5F9;color:#64748B">School Email</td><td style="padding:10px 0;border-bottom:1px solid #F1F5F9">${schoolEmail}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #F1F5F9;color:#64748B">Deleted At</td><td style="padding:10px 0;border-bottom:1px solid #F1F5F9">${new Date(deletedAt).toUTCString()}</td></tr>
            <tr><td style="padding:10px 0;color:#64748B">Auto-delete On</td><td style="padding:10px 0;font-weight:700;color:#DC2626">${new Date(restoreDeadline).toUTCString()}</td></tr>
          </table>
          <p style="margin-top:24px;font-size:12px;color:#94A3B8">This is an automated audit email from Zuvy Network master control.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Email send failed (school deleted):', err.message);
  }
}

// ── Send new password to school admin ────────────────────────────────────
async function sendPasswordResetEmail({ adminName, adminEmail, schoolName, newPassword }) {
  try {
    await resend.emails.send({
      from:    FROM,
      to:      adminEmail,
      subject: `Your ${schoolName} admin password has been reset`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h2 style="margin:0 0 8px;color:#1E3A8A;font-size:18px">Password Reset</h2>
            <p style="margin:0;color:#1E40AF;font-size:14px">Your administrator password for <strong>${schoolName}</strong> has been reset by Zuvy network admin.</p>
          </div>
          <p style="font-size:14px;color:#0F172A">Hi ${adminName},</p>
          <p style="font-size:14px;color:#64748B">Use the temporary password below to log in. Change it immediately after signing in.</p>
          <div style="background:#0F172A;border-radius:10px;padding:20px 24px;margin:20px 0;text-align:center">
            <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:#A5F3FC">${newPassword}</span>
          </div>
          <p style="font-size:12px;color:#94A3B8;margin-top:24px">If you did not request this reset, contact Zuvy support immediately.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Email send failed (password reset):', err.message);
  }
}

// ── Send welcome email with login credentials to new school admin ─────────
async function sendNewSchoolEmail({ adminName, adminEmail, schoolName, password }) {
  try {
    await resend.emails.send({
      from:    FROM,
      to:      adminEmail,
      subject: `Welcome to School OS — Your ${schoolName} login details`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h2 style="margin:0 0 8px;color:#3730A3;font-size:18px">Welcome to School OS 🎉</h2>
            <p style="margin:0;color:#4338CA;font-size:14px">Your school <strong>${schoolName}</strong> has been set up on the Zuvy School OS platform.</p>
          </div>
          <p style="font-size:14px;color:#0F172A">Hi ${adminName},</p>
          <p style="font-size:14px;color:#64748B">Here are your administrator login credentials. Keep them safe and change your password after first login.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;color:#64748B;width:120px">Email</td>
              <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;font-weight:700;color:#0F172A">${adminEmail}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#64748B">Password</td>
              <td style="padding:10px 0">
                <span style="font-family:monospace;font-size:22px;font-weight:700;letter-spacing:4px;color:#6366F1;background:#EEF2FF;padding:6px 14px;border-radius:8px">${password}</span>
              </td>
            </tr>
          </table>
          <p style="font-size:12px;color:#94A3B8;margin-top:24px">Powered by Zuvy Technologies · School OS</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Email send failed (new school):', err.message);
  }
}

// ── Trial ending warning (3 days before) ─────────────────────────────────
async function sendTrialWarningEmail({ adminName, adminEmail, schoolName, trialEndsAt, billingType, studentCount, amountDue }) {
  try {
    await resend.emails.send({
      from:    FROM,
      to:      adminEmail,
      subject: `[Action Required] Your ${schoolName} trial ends in 3 days`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h2 style="margin:0 0 8px;color:#92400E;font-size:18px">Trial Ending Soon</h2>
            <p style="margin:0;color:#78350F;font-size:14px">Your free trial for <strong>${schoolName}</strong> ends on <strong>${new Date(trialEndsAt).toDateString()}</strong>.</p>
          </div>
          <p style="font-size:14px;color:#0F172A">Hi ${adminName},</p>
          <p style="font-size:14px;color:#64748B">After your trial ends, an invoice will be generated based on your active students. You will have 21 days to pay before the account is paused.</p>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px 20px;margin:20px 0">
            <table style="width:100%;font-size:14px">
              <tr><td style="color:#64748B;padding:6px 0">Active Students</td><td style="font-weight:700;color:#0F172A;text-align:right">${studentCount}</td></tr>
              <tr><td style="color:#64748B;padding:6px 0">Billing Type</td><td style="font-weight:700;color:#0F172A;text-align:right">${billingType === 'annual' ? 'Annual' : 'Per Term'}</td></tr>
              <tr style="border-top:1px solid #E2E8F0"><td style="color:#64748B;padding:10px 0 0">Estimated Amount</td><td style="font-weight:900;color:#6366F1;font-size:18px;text-align:right">KES ${amountDue.toLocaleString()}</td></tr>
            </table>
          </div>
          <p style="font-size:12px;color:#94A3B8">Zuvy Technologies · School OS</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Email send failed (trial warning):', err.message);
  }
}

// ── Trial ended — invoice generated ──────────────────────────────────────
async function sendInvoiceEmail({ adminName, adminEmail, schoolName, invoice }) {
  const rate   = invoice.billing_type === 'annual' ? 150 : 60;
  const period = invoice.billing_type === 'annual' ? 'Annual' : 'Per Term';
  try {
    await resend.emails.send({
      from:    FROM,
      to:      adminEmail,
      subject: `Invoice ${invoice.invoice_number} — ${schoolName} (KES ${invoice.amount_due.toLocaleString()})`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h2 style="margin:0 0 4px;color:#3730A3;font-size:18px">Invoice ${invoice.invoice_number}</h2>
            <p style="margin:0;color:#4338CA;font-size:13px">Due: <strong>${new Date(invoice.due_date).toDateString()}</strong> · 21-day grace period</p>
          </div>
          <p style="font-size:14px;color:#0F172A">Hi ${adminName},</p>
          <p style="font-size:14px;color:#64748B">Your free trial has ended. Here is your invoice for <strong>${schoolName}</strong>.</p>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px 20px;margin:20px 0">
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr style="border-bottom:1px solid #E2E8F0"><td style="color:#64748B;padding:8px 0">Active Students</td><td style="font-weight:700;text-align:right;padding:8px 0">${invoice.student_count}</td></tr>
              <tr style="border-bottom:1px solid #E2E8F0"><td style="color:#64748B;padding:8px 0">Rate</td><td style="font-weight:700;text-align:right;padding:8px 0">KES ${rate} × ${invoice.student_count} students (${period})</td></tr>
              <tr><td style="color:#64748B;padding:10px 0 0;font-weight:700">Total Due</td><td style="font-weight:900;color:#6366F1;font-size:20px;text-align:right;padding:10px 0 0">KES ${invoice.amount_due.toLocaleString()}</td></tr>
            </table>
          </div>
          <p style="font-size:13px;color:#64748B">Contact us to pay via M-Pesa or bank transfer. Your account will be paused if unpaid after <strong>${new Date(invoice.due_date).toDateString()}</strong>.</p>
          <p style="font-size:12px;color:#94A3B8;margin-top:24px">Zuvy Technologies · School OS</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Email send failed (invoice):', err.message);
  }
}

// ── Payment received — receipt ────────────────────────────────────────────
async function sendPaymentReceiptEmail({ adminName, adminEmail, schoolName, invoice }) {
  try {
    await resend.emails.send({
      from:    FROM,
      to:      adminEmail,
      subject: `Payment Received — ${invoice.invoice_number} (KES ${invoice.amount_paid.toLocaleString()})`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h2 style="margin:0 0 8px;color:#14532D;font-size:18px">Payment Confirmed ✓</h2>
            <p style="margin:0;color:#166534;font-size:14px">Your account for <strong>${schoolName}</strong> is now active.</p>
          </div>
          <p style="font-size:14px;color:#0F172A">Hi ${adminName},</p>
          <p style="font-size:14px;color:#64748B">We received your payment of <strong>KES ${invoice.amount_paid.toLocaleString()}</strong> for invoice <strong>${invoice.invoice_number}</strong>.</p>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px 20px;margin:20px 0">
            <table style="width:100%;font-size:14px">
              <tr><td style="color:#64748B;padding:6px 0">Invoice</td><td style="font-weight:700;text-align:right">${invoice.invoice_number}</td></tr>
              <tr><td style="color:#64748B;padding:6px 0">Amount Paid</td><td style="font-weight:700;text-align:right;color:#059669">KES ${invoice.amount_paid.toLocaleString()}</td></tr>
              <tr><td style="color:#64748B;padding:6px 0">Method</td><td style="font-weight:700;text-align:right">${invoice.payment_method || 'Bank Transfer'}</td></tr>
              <tr><td style="color:#64748B;padding:6px 0">Date</td><td style="font-weight:700;text-align:right">${new Date().toDateString()}</td></tr>
            </table>
          </div>
          <p style="font-size:12px;color:#94A3B8">Zuvy Technologies · School OS</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Email send failed (receipt):', err.message);
  }
}

// ── Send OTP code to admin email ─────────────────────────────────────────────
async function sendOtpEmail({ adminEmail, adminName, otp }) {
  try {
    await resend.emails.send({
      from:    FROM,
      to:      adminEmail,
      subject: `${otp} — Your School OS verification code`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <div style="margin-bottom:24px">
            <span style="background:#6366F1;color:#fff;font-size:11px;font-weight:700;
              letter-spacing:1px;padding:4px 12px;border-radius:20px">SCHOOL OS</span>
          </div>
          <h2 style="margin:0 0 8px;color:#0F172A;font-size:22px;font-weight:800;letter-spacing:-0.5px">
            Your verification code
          </h2>
          <p style="color:#64748B;font-size:14px;margin:0 0 28px">
            Hi ${adminName || 'Admin'}, use the code below to reset your password.
            It expires in <strong>5 minutes</strong>.
          </p>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;
            padding:28px;text-align:center;margin-bottom:24px">
            <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#0F172A">
              ${otp}
            </div>
          </div>
          <p style="color:#94A3B8;font-size:12px;margin:0">
            If you didn't request this, ignore this email — your account is safe.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error('OTP email failed:', err.message);
  }
}

module.exports = {
  sendSchoolDeletedEmail,
  sendPasswordResetEmail,
  sendNewSchoolEmail,
  sendTrialWarningEmail,
  sendInvoiceEmail,
  sendPaymentReceiptEmail,
  sendOtpEmail,
};
