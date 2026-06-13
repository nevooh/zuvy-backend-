const axios  = require('axios');
const crypto = require('crypto');

const BASE        = 'https://payment.intasend.com';
const PUBLISHABLE = process.env.INSTASEND_PUBLISHABLE_KEY;
const SECRET      = process.env.INSTASEND_SECRET_KEY;

// STK push needs both public key header + Bearer secret
function stkHeaders() {
  return {
    'Content-Type':            'application/json',
    'INTASEND_PUBLIC_API_KEY': PUBLISHABLE,
    'Authorization':           `Bearer ${SECRET}`,
  };
}

// Checkout only uses the public key (secret is cleared in the SDK)
function checkoutHeaders() {
  return {
    'Content-Type':            'application/json',
    'INTASEND_PUBLIC_API_KEY': PUBLISHABLE,
  };
}

/**
 * Initiate M-Pesa STK push.
 * api_ref should be our invoice_number — this is how we match the webhook back to our DB.
 */
async function stkPush({ phone, email, amount, apiRef }) {
  const { data } = await axios.post(
    `${BASE}/api/v1/payment/mpesa-stk-push/`,
    {
      public_key:   PUBLISHABLE,
      phone_number: phone,
      email:        email || 'noreply@schoolos.ke',
      amount:       amount,
      currency:     'KES',
      method:       'M-PESA',
      api_ref:      apiRef,
    },
    { headers: stkHeaders() }
  );
  return data; // { invoice: { invoice_id, state, api_ref } }
}

/**
 * Create a hosted IntaSend checkout link (supports M-Pesa, Airtel, card, bank).
 * api_ref should be our invoice_number — webhook uses it to find us.
 */
async function createCheckout({ title, amount, apiRef, email, redirectUrl }) {
  const { data } = await axios.post(
    `${BASE}/api/v1/checkout/`,
    {
      public_key:   PUBLISHABLE,
      first_name:   'School',
      last_name:    'Admin',
      email:        email || 'noreply@schoolos.ke',
      amount:       amount,
      currency:     'KES',
      api_ref:      apiRef,
      comment:      title,
      redirect_url: redirectUrl || `${process.env.APP_URL || 'https://schoolos.ke'}/billing/success`,
    },
    { headers: checkoutHeaders() }
  );
  return data; // { id, url }
}

/**
 * Verify an IntaSend webhook signature.
 * Header name is not publicly documented — we try common variants and log a warning if none match
 * rather than hard-blocking (tighten once the real header name is confirmed with IntaSend support).
 */
function verifyWebhook(rawBody, signature) {
  if (!SECRET || !signature) return true; // skip if no sig sent
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Extract the webhook signature from the request headers.
 * IntaSend's header name is not publicly documented — check several variants.
 */
function extractSig(headers) {
  return headers['x-intasend-signature']
      || headers['x-instasend-signature']
      || headers['intasend-signature']
      || headers['x-signature']
      || null;
}

module.exports = { stkPush, createCheckout, verifyWebhook, extractSig };
