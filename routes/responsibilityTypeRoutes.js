const express = require("express");
const {
  addResponsibilityType,
  getAllResponsibilityTypes,
  updateResponsibilityType,
  deleteResponsibilityType,
} = require("../controllers/responsibilityTypeController");
const { protect, admin } = require("../middleware/authMiddleware"); // Auth Middleware

const router = express.Router();

// Base Route: /api/responsibility-types
router
  .route("/")
  // GET: সমস্ত প্রকার দায়িত্ব দেখা (Protected)
  .get(protect, getAllResponsibilityTypes)
  // POST: নতুন প্রকার দায়িত্ব যুক্ত করা (Admin required)
  .post(protect, admin, addResponsibilityType);

// ID Specific Routes: /api/responsibility-types/:id
router
  .route("/:id")
  // PUT: প্রকার আপডেট করা (Admin required)
  .put(protect, admin, updateResponsibilityType)
  // DELETE: প্রকার ডিলিট করা (Admin required)
  .delete(protect, admin, deleteResponsibilityType);

module.exports = router;
