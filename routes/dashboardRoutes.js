const express = require("express");
const router = express.Router();
const {
  getDashboardSummary,
  getTopResponsibleTeachers,
  getRecentGrantedLeaves,
  getAssignmentByDutyType,
  getAssignmentByBranch,
} = require("../controllers/dashboardController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const dashboardAccess = authorizeRoles(
  "admin",
  "head_teacher",
  "coordinator",
  "incharge"
);

/**
 * 🛡️ সকল রাউট 'protect' মিডলওয়্যার দ্বারা সুরক্ষিত।
 * প্রতিটি ফাংশন এখন বছর-ভিত্তিক (Year-based) ডাটা সাপোর্ট করে।
 */

// ড্যাশবোর্ড সামারি (KPIs)
router.get("/summary", protect, dashboardAccess, getDashboardSummary);

// শীর্ষ দায়িত্বপ্রাপ্ত শিক্ষকদের তালিকা
router.get("/top-teachers", protect, dashboardAccess, getTopResponsibleTeachers);

// সাম্প্রতিক মঞ্জুরকৃত ছুটির তালিকা
router.get(
  "/recent-granted-leaves",
  protect,
  dashboardAccess,
  getRecentGrantedLeaves
);

// ডিউটি টাইপ অনুযায়ী অ্যানালিটিক্স (চার্টের জন্য)
router.get(
  "/assignment-by-type",
  protect,
  dashboardAccess,
  getAssignmentByDutyType
);

// ব্রাঞ্চ বা ক্যাম্পাস ভিত্তিক অ্যানালিটিক্স (চার্টের জন্য)
router.get(
  "/assignment-by-branch",
  protect,
  dashboardAccess,
  getAssignmentByBranch
);

/**
 * 💡 নোট: আপনার কন্ট্রোলার ফাইলে 'getAssignmentAnalytics' নামে
 * কোনো ফাংশন এক্সপোর্ট করা নেই, তাই সেটি এখান থেকে সরিয়ে ফেলা হয়েছে
 * যাতে 'TypeError' না আসে।
 */

module.exports = router;
