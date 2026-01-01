const express = require("express");
const router = express.Router();

// ✅ নিশ্চিত করুন এখানে কার্লি ব্র্যাকেট { } ব্যবহার করেছেন
const {
  getUsers,
  addUser,
  updateUser,
  deleteUser,
} = require("../controllers/userController");
const { protect, admin } = require("../middleware/authMiddleware");

// ১৩ নম্বর লাইন যেখানে আপনার এরর আসছিল
router.get("/", protect, admin, getUsers);

router.post("/add", protect, admin, addUser);
router.put("/update/:id", protect, admin, updateUser);
router.delete("/delete/:id", protect, admin, deleteUser);

module.exports = router;
