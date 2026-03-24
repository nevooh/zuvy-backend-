const express = require("express");
const router = express.Router();
const { readData, writeData } = require("../helpers/data");

// POST student
router.post("/", (req, res) => {
  const data = readData();
  const { school_id, name, admission_number } = req.body;

  if (!school_id || !name || !admission_number)
    return res.status(400).json({ error: "Missing fields" });

  const newStudent = {
    id: Date.now().toString(),
    school_id,
    name,
    admission_number
  };

  data.students.push(newStudent);
  writeData(data);
  res.json(newStudent);
});

// GET students by school_id
router.get("/", (req, res) => {
  const data = readData();
  const { school_id } = req.query;

  if (!school_id) return res.status(400).json({ error: "school_id is required" });

  const students = data.students.filter(s => s.school_id === school_id);
  res.json(students);
});

module.exports = router;
