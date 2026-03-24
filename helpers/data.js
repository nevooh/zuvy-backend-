const fs = require("fs");
const path = require("path");

// read a specific JSON file for a school
function readData(schoolId, filename) {
  const filePath = path.join(__dirname, "..", "data", schoolId, filename);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath));
}

// write to a specific JSON file for a school
function writeData(schoolId, filename, data) {
  const schoolFolder = path.join(__dirname, "..", "data", schoolId);
  if (!fs.existsSync(schoolFolder)) fs.mkdirSync(schoolFolder, { recursive: true });

  const filePath = path.join(schoolFolder, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = { readData, writeData };
