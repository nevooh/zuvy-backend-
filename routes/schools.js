const express = require("express");
const router = express.Router();
const { readData, writeData } = require("../helpers/data");

router.post("/", (req, res) => {
  const data = readData();
  if (!req.body.name) return res.status(400).json({ error: "School name required" });

  const newSchool = { id: Date.now().toString(), name: req.body.name };
  data.schools.push(newSchool);
  writeData(data);

  res.json(newSchool);
});

module.exports = router;
