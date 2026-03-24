const express = require('express');
const router = express.Router();
const sendSMS = require('../services/smsService');

router.get('/test-sms', async (req, res) => {

  const phone = "+254789876713"; // your phone
  const message = "Test SMS from School Finance System";

  await sendSMS(phone, message);

  res.send("SMS test sent");
});

module.exports = router;