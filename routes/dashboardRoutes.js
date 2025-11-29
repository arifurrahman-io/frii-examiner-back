const express = require("express");
const {
  getDashboardSummary,
  getTopResponsibleTeachers, // ✅ Top Teachers ফাংশন ইমপোর্ট
  getAssignmentAnalytics, // Import added in previous step
  getRecentGrantedLeaves, // ✅ FIX: Missing import added
  getAssignmentByDutyType, // ✅ IMPORT
  getAssignmentByBranch, // ✅ IMPORT
} = require("../controllers/dashboardController");
const { protect } = require("../middleware/authMiddleware"); // Auth required

const router = express.Router();

// GET /api/dashboard/summary
router.route("/summary").get(protect, getDashboardSummary);

// ✅ NEW ROUTE: GET /api/dashboard/top-teachers
router.route("/top-teachers").get(protect, getTopResponsibleTeachers);

// ✅ NEW ROUTE: GET /api/dashboard/assignment-analytics
router.route("/assignment-analytics").get(protect, getAssignmentAnalytics);

// ✅ NEW ROUTE: GET /api/dashboard/recent-granted-leaves
router.route("/recent-granted-leaves").get(protect, getRecentGrantedLeaves);

// ✅ NEW ROUTE: GET /api/dashboard/assignment-by-type
router.route("/assignment-by-type").get(protect, getAssignmentByDutyType);

// ✅ NEW ROUTE: GET /api/dashboard/assignment-by-branch
router.route("/assignment-by-branch").get(protect, getAssignmentByBranch);

module.exports = router;
