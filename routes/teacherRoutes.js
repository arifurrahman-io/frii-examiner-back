const express = require("express");
const {
  addTeacher,
  getAllTeachers,
  getTeacherProfile,
  updateTeacher,
  deleteTeacher,
  addAnnualReport,
  deleteAnnualReport, // 🚀 নতুন কন্ট্রোলার ফাংশন ইমপোর্ট করুন
  bulkUploadTeachers,
} = require("../controllers/teacherController");

const {
  protect,
  admin,
  authorizeRoles,
  staffOnly,
} = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

// --- 🏢 Base Routes: /api/teachers ---
router
  .route("/")
  // সকল শিক্ষক দেখা ও সার্চ করা
  .get(
    protect,
    authorizeRoles(
      "admin",
      "head_teacher",
      "coordinator",
      "incharge",
      "executive"
    ),
    getAllTeachers
  )
  // নতুন শিক্ষক যুক্ত করা
  .post(protect, authorizeRoles("admin", "incharge"), addTeacher);

// --- 📤 Bulk Upload Route ---
router.post("/bulk-upload", protect, admin, upload, bulkUploadTeachers);

// --- 📊 Annual Report Management ---
// নতুন রিপোর্ট যুক্ত করা
router.post("/:id/report", protect, staffOnly, addAnnualReport);

router.delete("/:id/reports/:reportId", protect, admin, deleteAnnualReport);

// --- 🛠️ ID Specific Routes: /api/teachers/:id ---
router
  .route("/:id")
  // প্রোফাইল দেখা
  .get(
    protect,
    authorizeRoles(
      "admin",
      "head_teacher",
      "coordinator",
      "incharge",
      "executive"
    ),
    getTeacherProfile
  )
  // তথ্য আপডেট করা — admin full; head teacher / executive: name + basic salary
  .put(
    protect,
    authorizeRoles("admin", "head_teacher", "executive"),
    updateTeacher
  )
  // শিক্ষক স্থায়ীভাবে মুছে ফেলা
  .delete(protect, admin, deleteTeacher);

module.exports = router;
