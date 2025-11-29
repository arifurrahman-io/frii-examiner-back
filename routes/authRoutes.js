const express = require("express");
// এখানে loginUser এবং logoutUser দুটি ফাংশনই কন্ট্রোলার থেকে ইমপোর্ট করুন
const { loginUser, logoutUser } = require("../controllers/authController");
const router = express.Router();

// POST /api/auth/login (লগইন)
router.post("/login", loginUser);

// POST /api/auth/logout (লগআউট - সাধারণত POST রিকোয়েস্ট ব্যবহার করা হয়)
// এই রুটটি টোকেন ইনভ্যালিডেট বা সার্ভার সেশন পরিষ্কার করে।
router.post("/logout", logoutUser);

// (আপনি চাইলে এখানে register, forgot password, ইত্যাদির জন্য রুট যুক্ত করতে পারেন)

module.exports = router;
