const axios = require('axios');

const CELCOM_BASE       = 'https://isms.celcomafrica.com/api/services';
const CELCOM_API_KEY    = process.env.CELCOM_API_KEY;
const CELCOM_PARTNER_ID = process.env.CELCOM_PARTNER_ID || '1373';
const CELCOM_SHORTCODE  = process.env.CELCOM_SENDER_ID  || 'ZUVY_TECH';

const sendOtpSms = async (phoneNumber, otp) => {
  try {
    let phone = String(phoneNumber).trim();
    if (phone.startsWith('+'))  phone = phone.substring(1);
    if (phone.startsWith('0'))  phone = '254' + phone.substring(1);
    if (phone.startsWith('7') || phone.startsWith('1')) phone = '254' + phone;

    const message = `Your School OS verification code is: ${otp}. Valid for 5 minutes. Do not share this code.`;

    const { data } = await axios.post(
      `${CELCOM_BASE}/sendsms/`,
      {
        apikey:    CELCOM_API_KEY,
        partnerID: CELCOM_PARTNER_ID,
        shortcode: CELCOM_SHORTCODE,
        mobile:    phone,
        message,
        pass_type: 'plain',
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    console.log(`✅ OTP SMS sent to ${phone}`);
    return true;
  } catch (err) {
    console.error(`❌ OTP SMS failed: ${err.message}`);
    return false;
  }
};

module.exports = sendOtpSms;