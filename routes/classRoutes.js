const express = require("express");
const {
  addClass,
  getAllClasses,
  updateClass,
  deleteClass,
} = require("../controllers/classController");
const { protect, admin } = require("../middleware/authMiddleware"); // ✅ সুরক্ষিত মিডলওয়্যার ইমপোর্ট

const router = express.Router();

// Base Route: /api/classes
router
  .route("/")
  // GET: সমস্ত ক্লাস দেখা (Protected)
  .get(protect, getAllClasses)
  // POST: নতুন ক্লাস যুক্ত করা (Admin Only)
  .post(protect, admin, addClass);

// ID Specific Routes: /api/classes/:id
router
  .route("/:id")
  // PUT: ক্লাস আপডেট করা (Admin Only)
  .put(protect, admin, updateClass)
  // DELETE: ক্লাস ডিলিট করা (Admin Only)
  .delete(protect, admin, deleteClass);

module.exports = router;
