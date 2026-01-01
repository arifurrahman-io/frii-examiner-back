const express = require("express");
const dotenv = require("dotenv");

// Load env variables FIRST, before importing anything that uses them (like connectDB)
dotenv.config(); // ✅ FIX: Moved to the top to ensure process.env.MONGO_URI is set

const cors = require("cors");
const connectDB = require("./config/db"); // Now, connectDB has access to MONGO_URI

// --- রুট ফাইলগুলি ইমপোর্ট করা হচ্ছে ---
const teacherRoutes = require("./routes/teacherRoutes");
const routineRoutes = require("./routes/routineRoutes");
const assignmentRoutes = require("./routes/assignmentRoutes");
const reportRoutes = require("./routes/reportRoutes");
const authRoutes = require("./routes/authRoutes");
const branchRoutes = require("./routes/branchRoutes");
const classRoutes = require("./routes/classRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
const responsibilityTypeRoutes = require("./routes/responsibilityTypeRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const leaveRoutes = require("./routes/leaveRoutes"); // ✅ NEW: Leave Routes
const users = require("./routes/userRoutes");

// Connect to Database
connectDB(); // Now, the function runs with a defined MONGO_URI

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Allows parsing JSON data in request body

// --- API রুট সেটআপ ---
// প্রতিটি রুটের আগে বেস পাথ '/api/' ব্যবহার করা হচ্ছে
app.use("/api/teachers", teacherRoutes);
app.use("/api/routines", routineRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/responsibility-types", responsibilityTypeRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/leaves", leaveRoutes); // ✅ NEW: Leave Management Route
app.use("/api/users", users);

// Define Root Route
app.get("/", (req, res) => {
  res.send("Teacher Management Platform API is running successfully!");
});

// Error Handling Middleware (Optional but Recommended)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server running in ${
      process.env.NODE_ENV || "development"
    } mode on port ${PORT}`
  );
});
