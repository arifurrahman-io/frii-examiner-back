const express = require("express");
const {
  getAttendanceGrid,
  saveAttendance,
  getSalaryReport,
  getPayslip,
  getClBenefit,
  getProvidentFund,
  saveProvidentFund,
} = require("../controllers/payrollController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();
const payrollAccess = authorizeRoles("admin", "head_teacher", "executive");

router.get("/attendance", protect, payrollAccess, getAttendanceGrid);
router.put("/attendance", protect, payrollAccess, saveAttendance);
router.get("/salary-report", protect, payrollAccess, getSalaryReport);
router.get("/payslip/:teacherId", protect, payrollAccess, getPayslip);
router.get("/cl-benefit", protect, payrollAccess, getClBenefit);
router.get("/provident-fund", protect, payrollAccess, getProvidentFund);
router.put("/provident-fund", protect, payrollAccess, saveProvidentFund);

module.exports = router;
