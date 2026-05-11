const express = require("express");
const {
  assignResponsibility,
  getAssignmentsForReport,
  getAssignmentsByTeacherAndYear,
  deleteAssignmentPermanently,
} = require("../controllers/assignmentController");

const { protect, admin } = require("../middleware/authMiddleware");

const router = express.Router();

// --- ১. Base Routes ---

router
  .route("/")
  /**
   * POST /api/assignments
   * দায়িত্ব অ্যাসাইন করা।
   * এখানে 'admin' সরিয়ে দেওয়া হয়েছে কারণ 'incharge' এখন ক্লাস ১-৩ এর জন্য এক্সেস পাবে।
   * কন্ট্রোলারের ভেতরে অলরেডি রোল ভিত্তিক সিকিউরিটি চেক যুক্ত করা হয়েছে।
   */
  .post(protect, assignResponsibility)

  /**
   * GET /api/assignments
   * রিপোর্টের জন্য ফিল্টার করে ডেটা আনা (Login Required)
   */
  .get(protect, getAssignmentsForReport);

// --- ২. ID Specific Routes ---

/**
 * DELETE /api/assignments/:id
 * স্থায়ীভাবে ডিলিট করা - এটি শুধুমাত্র Admin এর জন্য সংরক্ষিত।
 * ইনচার্জ ডাটা এন্ট্রি করতে পারলেও ডিলিট করার প্রটোকল তার নেই।
 */
router.route("/:id").delete(protect, admin, deleteAssignmentPermanently);

// --- ৩. Teacher Specific Query (Conflict Check) ---
/**
 * GET /api/assignments/teacher/:teacherId
 * শিক্ষকের বর্তমান বছরের এসাইনমেন্ট চেক করা (Login Required)
 */
router
  .route("/teacher/:teacherId")
  .get(protect, getAssignmentsByTeacherAndYear);

module.exports = router;
