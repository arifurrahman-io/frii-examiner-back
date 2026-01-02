const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const morgan = require("morgan"); // রিকোয়েস্ট লগিংয়ের জন্য
const connectDB = require("./config/db");

// ১. কনফিগারেশন লোড (Environment Variables)
dotenv.config();

// ২. ডাটাবেস কানেকশন
connectDB();

// ৩. রুট ফাইলগুলি ইমপোর্ট করা হচ্ছে
const authRoutes = require("./routes/authRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const routineRoutes = require("./routes/routineRoutes");
const assignmentRoutes = require("./routes/assignmentRoutes");
const reportRoutes = require("./routes/reportRoutes");
const branchRoutes = require("./routes/branchRoutes");
const classRoutes = require("./routes/classRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
const responsibilityTypeRoutes = require("./routes/responsibilityTypeRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const userRoutes = require("./routes/userRoutes");

const app = express();

// ৪. মিডেলওয়্যার সেটআপ
app.use(cors());
app.use(express.json()); // রিকোয়েস্ট বডি পার্স করার জন্য
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev")); // ডেভেলপমেন্ট মোডে রিকোয়েস্ট লগ করবে
}

// ৫. API রুট সেটআপ (Neural Matrix Endpoints)
app.use("/api/auth", authRoutes);
app.use("/api/teachers", teacherRoutes); // শিক্ষক ডিলিট ও প্রোফাইল রুট এখানে
app.use("/api/routines", routineRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/responsibility-types", responsibilityTypeRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/users", userRoutes);

// ৬. রুট রাউট
app.get("/", (req, res) => {
  res.send("Teacher Management Platform API (Neural Matrix) is active.");
});

// ৭. অ্যাডভান্সড এরর হ্যান্ডলিং মিডেলওয়্যার
// এটি ফ্রন্টএন্ডে "Internal Protocol Error" মেসেজ পাঠাতে সাহায্য করবে
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  console.error(`[Matrix Error]: ${err.message}`);
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Protocol Error: Matrix Link Interrupted.",
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
});

// ৮. সার্ভার লিসেনিং
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(
    `🚀 Server synchronized in ${
      process.env.NODE_ENV || "development"
    } mode on port ${PORT}`
  );
});

// ৯. আনহ্যান্ডেলড রিজেকশন হ্যান্ডলিং (সার্ভার ক্রাশ হওয়া রোধ করতে)
process.on("unhandledRejection", (err, promise) => {
  console.log(`Error: ${err.message}`);
  // সার্ভার গ্রেসফুলি বন্ধ করা
  server.close(() => process.exit(1));
});
