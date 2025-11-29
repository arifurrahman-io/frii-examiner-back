const User = require("../models/UserModel"); // UserModel ইমপোর্ট করুন
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// JWT Secret Key (আপনার .env ফাইলে এটি সেট করতে পারেন)
// Production এর জন্য অবশ্যই process.env.JWT_SECRET ব্যবহার করুন
const JWT_SECRET = process.env.JWT_SECRET || "your_fallback_secret_key";

// --- POST /api/auth/login ---
const loginUser = async (req, res) => {
  const { username, password } = req.body;

  try {
    // ১. ইউজারকে তার ইউজারনেম দিয়ে খুঁজে বের করা
    const user = await User.findOne({ username });
    if (!user) {
      return res
        .status(404)
        .json({ message: "Invalid credentials (User not found)." });
    }

    // ২. পাসওয়ার্ড যাচাই করা (হ্যাশড পাসওয়ার্ডের সাথে)
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ message: "Invalid credentials (Password mismatch)." });
    }

    // ৩. JWT টোকেন তৈরি করা
    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" } // টোকেন ২৪ ঘণ্টা বৈধ থাকবে
    );

    // ৪. ফ্রন্টএন্ডে টোকেন ও ইউজার ডেটা পাঠানো
    res.json({
      token,
      user: {
        _id: user._id,
        name: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error during login process." });
  }
};

// --- POST /api/auth/logout ---
const logoutUser = async (req, res) => {
  // এখানে কোনো কঠিন লজিক নেই, শুধুমাত্র সফল রেসপন্স
  res.status(200).json({ message: "Successfully logged out." });
  // যদি আপনি JWT ব্ল্যাকলিস্টিং না করেন, এই ফাংশনটি প্রায় সবসময় 200 রেসপন্স দেবে।
};

module.exports = {
  loginUser,
  logoutUser, // ✅ এই ফাংশনটি রুট এক্সপোর্টে যুক্ত করা হলো
};
