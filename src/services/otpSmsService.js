const AfricasTalking = require('africastalking');

// Separate instance — no billing, no wallet deduction
const africasTalking = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME
});

const sms = africasTalking.SMS;

const sendOtpSms = async (phoneNumber, otp) => {
  try {
    // Clean the number
    let cleaned = String(phoneNumber).trim();
    if (cleaned.startsWith('0')) cleaned = '+254' + cleaned.substring(1);
    else if (cleaned.startsWith('7') || cleaned.startsWith('1')) cleaned = '+254' + cleaned;
    else if (cleaned.startsWith('254') && !cleaned.startsWith('+')) cleaned = '+' + cleaned;

    const message = `Your School OS verification code is: ${otp}. Valid for 2 minutes. Do not share this code.`;

    const response = await sms.send({ to: [cleaned], message });
    console.log(`✅ OTP SMS sent to ${cleaned}`);
    return true;

  } catch (err) {
    console.error(`❌ OTP SMS failed: ${err.message}`);
    return false; // Don't crash the app if SMS fails
  }
};

module.exports = sendOtpSms;