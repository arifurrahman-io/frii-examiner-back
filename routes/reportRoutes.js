// server/routes/reportRoutes.js
const express = require("express");
const {
  getReportData,
  exportToExcel,
  getPDFDataForClient,
} = require("../controllers/reportController");

const router = express.Router();

// GET /api/reports/data - ফিল্টার করা JSON ডেটা (UI টেবিল বা PDF জেনারেশনের জন্য)
router.get("/data", getReportData);

// GET /api/reports/export/excel - Excel ফাইল ডাউনলোড
router.get("/export/excel", exportToExcel);

// GET /api/reports/export/pdf - PDF এর জন্য ডেটা ফেচ (ঐচ্ছিক, যদি ক্লায়েন্ট-সাইড জেনারেশন ব্যবহার হয়)
router.get("/export/pdf", getPDFDataForClient);

module.exports = router;
