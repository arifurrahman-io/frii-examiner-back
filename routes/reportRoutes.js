// arifurrahman-io/frii-examiner-back/frii-examiner-back-aa5325b910a695d44cb8fa1be2371493fec60e67/routes/reportRoutes.js

const express = require("express");
const {
  getReportData,
  getExaminerExchangeDates,
  saveExaminerExchangeDates,
  exportCustomReportToPDF,
  exportCampusWiseYearlyPDF,
  exportCampusRoutinePDF,
} = require("../controllers/reportController"); // Only importing getReportData
const { protect, admin } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect, admin);

router.get("/data", getReportData);
router
  .route("/examiner-exchange-dates")
  .get(getExaminerExchangeDates)
  .put(saveExaminerExchangeDates);

router.get("/export/custom-pdf", exportCustomReportToPDF);
router.get("/export/yearly-pdf", exportCampusWiseYearlyPDF);
router.get("/export/campus-routine", exportCampusRoutinePDF);

module.exports = router;
