// routes/leaveRoutes.js

const express = require("express");
const {
  getAllLeaveRequests,
  createLeaveRequest,
  updateLeaveRequest,
  grantLeaveRequest,
  deleteLeaveRequestPermanently,
  exportLeavesToExcel,
  checkLeaveConflict,
} = require("../controllers/leaveController");

// ইনচার্জদের অনুমতি দেওয়ার জন্য adminOrIncharge মিডলওয়্যার প্রয়োজন হতে পারে
// অথবা আপনি protect মিডলওয়্যার ব্যবহার করে কন্ট্রোলারের ভেতরে রোল চেক করতে পারেন
const { protect, admin } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * ℹ️ লজিক আপডেট:
 * ইনচার্জরা এখন এই রাউটটি অ্যাক্সেস করতে পারবেন।
 * কন্ট্রোলারের ভেতর (getAllLeaveRequests) চেক করা হবে ইউজার ইনচার্জ হলে
 * শুধুমাত্র তাঁর ক্যাম্পাসের ডেটা পাঠানো হবে।
 */
// GET /api/leaves - সমস্ত বা ক্যাম্পাস ভিত্তিক অনুরোধ দেখুন (Admin & Incharge)
router.route("/").get(protect, getAllLeaveRequests);

// POST /api/leaves - নতুন অনুরোধ তৈরি করুন (Teacher/Admin/Incharge)
router.route("/").post(protect, createLeaveRequest);

// --- 🛡️ ADMIN RESTRICTED ROUTES ---

// PUT /api/leaves/:id/grant - স্থিতি পরিবর্তন করুন (Admin Only)
router.route("/:id/grant").put(protect, admin, grantLeaveRequest);

// DELETE /api/leaves/:id - স্থায়ীভাবে মুছে ফেলা (Admin Only)
router
  .route("/:id")
  .put(protect, updateLeaveRequest)
  .delete(protect, admin, deleteLeaveRequestPermanently);

// GET /api/leaves/export/excel - Export to Excel (Admin Only)
router.get("/export/excel", protect, admin, exportLeavesToExcel);

// কনফ্লিক্ট চেক (সবাই করতে পারবে)
router.get("/conflict-check", protect, checkLeaveConflict);

module.exports = router;
