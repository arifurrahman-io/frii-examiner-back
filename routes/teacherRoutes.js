const express = require("express");
const {
  addTeacher,
  getAllTeachers,
  getTeacherProfile,
  updateTeacher,
  addAnnualReport, // 🚀 নতুন কন্ট্রোলার ফাংশন
  bulkUploadTeachers,
} = require("../controllers/teacherController");

const { protect, admin, staffOnly } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

// Base Routes: /api/teachers
router
  .route("/")
  // GET /api/teachers - সকল শিক্ষক দেখা ও সার্চ করা (Admin/Incharge/Teacher সবাই পারবে)
  .get(protect, getAllTeachers)
  // POST /api/teachers - নতুন শিক্ষক যুক্ত করা (শুধুমাত্র Admin এবং Incharge পারবে)
  .post(protect, staffOnly, addTeacher);

// 🚀 NEW ROUTE: বার্ষিক রিপোর্ট যুক্ত করা (Admin এবং Incharge পারবে)
// POST /api/teachers/:id/report
router.post("/:id/report", protect, staffOnly, addAnnualReport);

// ID Specific Routes: /api/teachers/:id
router
  .route("/:id")
  .get(protect, staffOnly, getTeacherProfile)
  .put(protect, admin, updateTeacher); // 🚀 এখন আর undefined হবে না

// Bulk Upload Route: /api/teachers/bulk-upload
// শুধুমাত্র অ্যাডমিন বাল্ক আপলোড করতে পারবে
router.post("/bulk-upload", protect, admin, upload, bulkUploadTeachers);

module.exports = router;
