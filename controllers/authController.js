const User = require("../models/UserModel"); // UserModel ইমপোর্ট করুন
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// JWT Secret Key (আপনার .env ফাইলে এটি সেট করতে পারেন)
// Production এর জন্য অবশ্যই process.env.JWT_SECRET ব্যবহার করুন
const JWT_SECRET = process.env.JWT_SECRET || "your_fallback_secret_key";

// --- POST /api/auth/login ---
const loginUser = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }

  try {
    // ১. ইউজারকে তার ইউজারনেম দিয়ে খুঁজে বের করা
    // .select('+password') ensures the password hash is retrieved, even if schema sets select: false.
    const user = await User.findOne({ username }).select("+password");

    if (!user) {
      // 401 Unauthenticated for generic failure
      return res
        .status(401)
        .json({ message: "Invalid credentials (User not found)." });
    }

    // ২. পাসওয়ার্ড যাচাই করা (হ্যাশড পাসওয়ার্ডের সাথে)
    // CRITICAL CHECK: Ensure user.password exists before comparing
    if (!user.password) {
      console.error(
        `ERROR: User ${user.username} found, but password hash is missing/null in DB!`
      );
      return res.status(500).json({
        message:
          "Configuration error: User record is incomplete (Password missing).",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // 401 Unauthenticated
      return res
        .status(401)
        .json({ message: "Invalid credentials (Password mismatch)." });
    }

    // ৩. JWT টোকেন তৈরি করা
    const token = jwt.sign(
      { id: user._id, role: user.role, username: user.username }, // Add username to payload
      JWT_SECRET,
      { expiresIn: "1d" } // টোকেন ২৪ ঘণ্টা বৈধ থাকবে
    );

    // ৪. ফ্রন্টএন্ডে টোকেন ও ইউজার ডেটা পাঠানো
    res.json({
      token,
      user: {
        _id: user._id,
        name: user.username, // Use username as display name
        role: user.role,
      },
    });
  } catch (error) {
    // Log the error details on the server side
    console.error(
      "SERVER CRITICAL ERROR during login process:",
      error.message,
      error.stack
    );
    // Return a generic 500 response to the client
    res.status(500).json({
      message:
        "Server error during login process. Please check server logs for details.",
    });
  }
};

// --- POST /api/auth/logout ---
const logoutUser = async (req, res) => {
  // এখানে কোনো কঠিন লজিক নেই, শুধুমাত্র সফল রেসপন্স
  res.status(200).json({ message: "Successfully logged out." });
};

module.exports = {
  loginUser,
  logoutUser,
};
