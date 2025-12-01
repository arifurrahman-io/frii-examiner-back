// arifurrahman-io/frii-examiner-back/frii-examiner-back-aa5325b910a695d44cb8fa1be2371493fec60e67/routes/reportRoutes.js

const express = require("express");
const { getReportData } = require("../controllers/reportController"); // Only importing getReportData

const router = express.Router();

router.get("/data", getReportData);

module.exports = router;
