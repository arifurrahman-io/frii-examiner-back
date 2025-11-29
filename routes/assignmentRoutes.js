const express = require("express");
const {
  assignResponsibility,
  getAssignmentsForReport,
  getAssignmentsByTeacherAndYear,
  deleteAssignmentPermanently, // ✅ Hard Delete Controller Function
  // Note: cancelAssignment is intentionally NOT imported as it's no longer used.
} = require("../controllers/assignmentController");

const { protect, admin } = require("../middleware/authMiddleware");

const router = express.Router();

// --- Base Routes ---

router
  .route("/")
  // POST /api/assignments (দায়িত্ব অ্যাসাইন করা - Admin Only)
  .post(protect, admin, assignResponsibility)
  // GET /api/assignments (রিপোর্টের জন্য ফিল্টার করে ডেটা আনা - Login Required)
  .get(protect, getAssignmentsForReport);

// --- ID Specific Routes ---

// DELETE /api/assignments/:id (স্থায়ীভাবে ডিলিট করা - Admin Only)
// এটি মডাল থেকে স্থায়ীভাবে ডেটা মুছে ফেলার জন্য ব্যবহৃত হবে।
router.route("/:id").delete(protect, admin, deleteAssignmentPermanently); // ✅ Hard Delete Route

// ❌ PUT /api/assignments/:id/cancel রুটটি সম্পূর্ণভাবে মুছে ফেলা হলো
// ❌ কারণ cancelAssignment ফাংশনটি এখন আর বিদ্যমান নেই এবং Soft Delete দরকার নেই।

// --- Teacher Specific Query (Conflict Check for Modal) ---
// GET /api/assignments/teacher/:teacherId?year=2025 (Login Required)
router
  .route("/teacher/:teacherId")
  .get(protect, getAssignmentsByTeacherAndYear);

module.exports = router;
