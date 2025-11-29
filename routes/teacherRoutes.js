const express = require("express");
const {
  addTeacher,
  getAllTeachers,
  getTeacherProfile,
  updateTeacher,
  bulkUploadTeachers, // ✅ নতুন কন্ট্রোলার ফাংশন
} = require("../controllers/teacherController");

const { protect, admin } = require("../middleware/authMiddleware"); // ✅ Auth মিডলওয়্যার ইমপোর্ট
const upload = require("../middleware/uploadMiddleware"); // ✅ Multer (Upload) মিডলওয়্যার ইমপোর্ট

const router = express.Router();

// Base Routes: /api/teachers
router
  .route("/")
  // GET /api/teachers - সকল শিক্ষক দেখা ও সার্চ করা (লগইন আবশ্যক)
  .get(protect, getAllTeachers)
  // POST /api/teachers - নতুন শিক্ষক যুক্ত করা (অ্যাডমিন আবশ্যক)
  .post(protect, admin, addTeacher);

// ID Specific Routes: /api/teachers/:id
router
  .route("/:id")
  // GET /api/teachers/:id - একক শিক্ষকের প্রোফাইল দেখা (লগইন আবশ্যক)
  .get(protect, getTeacherProfile)
  // PUT /api/teachers/:id - শিক্ষকের তথ্য আপডেট করা (অ্যাডমিন আবশ্যক)
  .put(protect, admin, updateTeacher);

// Bulk Upload Route: /api/teachers/bulk-upload
// POST রিকোয়েস্ট ফাইল আপলোড হ্যান্ডেল করবে (Multer -> Admin -> Controller)
router.post("/bulk-upload", protect, admin, upload, bulkUploadTeachers); // ✅ বাল্ক আপলোড রুট

module.exports = router;
