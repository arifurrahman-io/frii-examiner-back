const express = require("express");
const {
  addClassPerformanceObservation,
  exportShiftPerformanceReportPDF,
  getShiftPerformanceReport,
  getTeacherPerformanceObservations,
  getTeacherPerformanceSummary,
} = require("../controllers/classPerformanceController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect, authorizeRoles("admin", "head_teacher", "incharge"));

router.get("/reports/shift", getShiftPerformanceReport);
router.get("/reports/shift/pdf", exportShiftPerformanceReportPDF);

router
  .route("/teachers/:teacherId")
  .get(getTeacherPerformanceObservations)
  .post(addClassPerformanceObservation);

router.get("/teachers/:teacherId/summary", getTeacherPerformanceSummary);

module.exports = router;
