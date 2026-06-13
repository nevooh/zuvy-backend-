const AfricasTalking = require('africastalking');

const at  = AfricasTalking({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
const sms = at.SMS;

function normalizePhone(phone) {
  let p = String(phone).trim();
  if (p.startsWith('0'))                              p = '+254' + p.substring(1);
  else if ((p.startsWith('7') || p.startsWith('1')) && !p.startsWith('+')) p = '+254' + p;
  else if (p.startsWith('254') && !p.startsWith('+')) p = '+' + p;
  return p;
}

async function sendSystemSms(phone, message) {
  try {
    await sms.send({ to: [normalizePhone(phone)], message });
  } catch (err) {
    console.error('System SMS failed:', err.message);
  }
}

module.exports = sendSystemSms;
