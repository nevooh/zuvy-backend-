function normalizePhone(raw) {
  let phone = String(raw || '').replace(/[\s+\-()]/g, '');
  if (phone.startsWith('0')) phone = `254${phone.substring(1)}`;
  if (/^[71]/.test(phone)) phone = `254${phone}`;
  return phone;
}

module.exports = { normalizePhone };
