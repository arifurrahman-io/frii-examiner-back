const express = require("express");
const {
  addBranch,
  getAllBranches,
  updateBranch, // ✅ ইমপোর্ট করা হলো
  deleteBranch, // ✅ ইমপোর্ট করা হলো
} = require("../controllers/branchController");
const { protect, admin } = require("../middleware/authMiddleware");

const router = express.Router();

// Route: /api/branches
router
  .route("/")
  // GET: সমস্ত ব্রাঞ্চের তালিকা দেখাও (Protected)
  .get(protect, getAllBranches)
  // POST: নতুন ব্রাঞ্চ যুক্ত করো (Admin Only)
  .post(protect, admin, addBranch);

// Route: /api/branches/:id (ID-নির্দিষ্ট রুট)
router
  .route("/:id")
  // PUT: ব্রাঞ্চ আপডেট করো (Admin Only)
  .put(protect, admin, updateBranch) // ✅ যুক্ত করা হলো
  // DELETE: ব্রাঞ্চ ডিলিট করো (Admin Only)
  .delete(protect, admin, deleteBranch); // ✅ যুক্ত করা হলো

module.exports = router;
