// routes/routineRoutes.js

const express = require("express");
const {
  addRoutine,
  getTeacherRoutines,
  getTeachersByRoutine,
  deleteRoutine,
  bulkUploadRoutines,
} = require("../controllers/routineController");

const { protect, admin } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

/**
 * ℹ️ লজিক আপডেট:
 * ইনচার্জদের রুটিন পরিবর্তন করার অনুমতি দেওয়া হয়েছে।
 * কন্ট্রোলারের ভেতর (routineController.js) স্বয়ংক্রিয়ভাবে চেক করা হবে
 * যে ইনচার্জ শুধুমাত্র তাঁর নিজের ক্যাম্পাসের শিক্ষকদের রুটিন পরিবর্তন করছেন কি না।
 */

// --- ROUTINE CRUD ---

// POST /api/routines - নতুন রুটিন যোগ করা (Admin & Incharge)
// আগে এখানে 'admin' মিডলওয়্যার ছিল, সেটি সরিয়ে 'protect' রাখা হয়েছে
router.route("/").post(protect, addRoutine);

// DELETE /api/routines/:id - নির্দিষ্ট রুটিন মুছে ফেলা (Admin & Incharge)
router.route("/:id").delete(protect, deleteRoutine);

// --- FILTERS & VIEWS ---

// GET /api/routines/filter - অ্যাসাইনমেন্টের জন্য যোগ্য শিক্ষক ফিল্টার করা (All Protected Users)
router.route("/filter").get(protect, getTeachersByRoutine);

// GET /api/routines/teacher/:teacherId - নির্দিষ্ট শিক্ষকের সমস্ত রুটিন দেখা (All Protected Users)
router.route("/teacher/:teacherId").get(protect, getTeacherRoutines);

// --- BULK OPERATIONS ---

// POST /api/routines/bulk-upload - এক্সেল ফাইল আপলোড (Admin & Incharge)
// মিডলওয়্যার অর্ডার: লগইন চেক (protect) -> ফাইল হ্যান্ডলিং (upload) -> প্রসেসিং (bulkUploadRoutines)
router.post("/bulk-upload", protect, upload, bulkUploadRoutines);

module.exports = router;
