const express = require("express");
const {
  addSubject,
  getAllSubjects,
  updateSubject,
  deleteSubject,
} = require("../controllers/subjectController");
const { protect, admin } = require("../middleware/authMiddleware"); // Auth Middleware

const router = express.Router();

// Base Route: /api/subjects
router
  .route("/")
  // GET: সমস্ত বিষয় দেখা (Protected)
  .get(protect, getAllSubjects)
  // POST: নতুন বিষয় যুক্ত করা (Admin required)
  .post(protect, admin, addSubject);

// ID Specific Routes: /api/subjects/:id
router
  .route("/:id")
  // PUT: বিষয় আপডেট করা (Admin required)
  .put(protect, admin, updateSubject)
  // DELETE: বিষয় ডিলিট করা (Admin required)
  .delete(protect, admin, deleteSubject);

module.exports = router;
