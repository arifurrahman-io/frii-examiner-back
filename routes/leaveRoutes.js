// routes/leaveRoutes.js

const express = require("express");
const {
  getAllLeaveRequests,
  createLeaveRequest,
  grantLeaveRequest,
  deleteLeaveRequestPermanently, // ✅ NEW: Import the deletion controller
  exportLeavesToExcel,
  checkLeaveConflict,
} = require("../controllers/leaveController");
const { protect, admin } = require("../middleware/authMiddleware");

const router = express.Router();

// GET /api/leaves - সমস্ত অনুরোধ দেখুন (Admin Only)
router.route("/").get(protect, admin, getAllLeaveRequests);

// POST /api/leaves - নতুন অনুরোধ তৈরি করুন (Protected - Teacher/Admin)
router.route("/").post(protect, createLeaveRequest);

// PUT /api/leaves/:id/grant - স্থিতি পরিবর্তন করুন (Admin Only)
router.route("/:id/grant").put(protect, admin, grantLeaveRequest);

// ✅ NEW ROUTE: DELETE /api/leaves/:id - স্থায়ীভাবে মুছে ফেলা (Admin Only)
router.route("/:id").delete(protect, admin, deleteLeaveRequestPermanently);
// ✅ NEW ROUTE: GET /api/leaves/export/excel - Export to Excel (Protected)
router.get("/export/excel", protect, admin, exportLeavesToExcel);

router.get("/conflict-check", protect, checkLeaveConflict);

module.exports = router;
