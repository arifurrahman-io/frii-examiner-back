const express = require("express");
const {
  getAppSettings,
  updateAppSettings,
} = require("../controllers/settingsController");
const { protect, admin, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router
  .route("/")
  .get(protect, authorizeRoles("admin", "incharge"), getAppSettings)
  .put(protect, admin, updateAppSettings);

module.exports = router;
