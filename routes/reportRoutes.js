// arifurrahman-io/frii-examiner-back/frii-examiner-back-aa5325b910a695d44cb8fa1be2371493fec60e67/routes/reportRoutes.js

const express = require("express");
const {
  getReportData,
  exportCustomReportToPDF,
  exportCampusWiseYearlyPDF,
} = require("../controllers/reportController"); // Only importing getReportData

const router = express.Router();

router.get("/data", getReportData);

router.get("/export/custom-pdf", exportCustomReportToPDF);

router.get("/export/yearly-pdf", exportCampusWiseYearlyPDF);

module.exports = router;
