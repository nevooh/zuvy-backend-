const express = require("express");
const app = express();
app.use(express.json());

const PORT = 3000;

// Import routes
const schoolsRoutes = require("./routes/schools");
const studentsRoutes = require("./routes/students");

// Routes
app.use("/schools", schoolsRoutes);
app.use("/students", studentsRoutes);

// Test
app.get("/", (req, res) => res.send("School OS backend alive 🚀"));

app.listen(PORT, () => console.log(`🔥 Server running at http://localhost:${PORT}`));
