const User = require("../models/UserModel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Environment variables থেকে সিক্রেট কি লোড করা
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET || JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required.");
}

/**
 * JWT Access এবং Refresh Token তৈরি করার হেল্পার ফাংশন
 */
const generateTokens = (user) => {
  const campus = user.campus
    ? {
        _id: user.campus._id || user.campus,
        name: user.campus.name,
      }
    : undefined;

  const campuses = Array.isArray(user.campuses)
    ? user.campuses.map((item) => ({
        _id: item._id || item,
        name: item.name,
      }))
    : [];

  const accessToken = jwt.sign(
    {
      id: user._id,
      role: user.role,
      name: user.name || user.username,
      username: user.username,
      email: user.email,
      campus,
      campuses,
      teacherProfile: user.teacherProfile || null,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  const refreshToken = jwt.sign(
    { id: user._id },
    REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
};

// --- POST /api/auth/login ---
const loginUser = async (req, res) => {
  const { username, password } = req.body;
  const identifier = username?.trim();

  // ১. ইনপুট চেক করা
  if (!identifier || !password) {
    return res.status(400).json({
      success: false,
      message: "Username/Email and password are required.",
    });
  }

  try {
    // ২. ইউজারকে তার ইউজারনেম অথবা ইমেইল দিয়ে খুঁজে বের করা
    // .select('+password') ব্যবহার করা হয়েছে কারণ মডেলে পাসওয়ার্ড ডিফল্টভাবে হাইড করা থাকতে পারে
    const user = await User.findOne({
      $or: [
        { username: identifier },
        { email: identifier.toLowerCase() },
        { name: identifier },
      ],
    })
      .select("+password")
      .populate("campus", "name")
      .populate("campuses", "name")
      .populate("teacherProfile", "name teacherId");

    if (!user) {
      console.log(`Login failed: User not found - ${identifier}`);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials (User not found).",
      });
    }

    // ৩. পাসওয়ার্ড যাচাই করা
    if (!user.password) {
      console.error(`ERROR: Password hash missing for user: ${user.email}`);
      return res.status(500).json({
        success: false,
        message: "Server configuration error: User password missing.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      console.log(`Login failed: Password mismatch for user - ${identifier}`);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials (Password mismatch).",
      });
    }

    // ৪. সফল লগইন হলে টোকেন তৈরি করা
    const { accessToken, refreshToken } = generateTokens(user);

    // ৫. ফ্রন্টএন্ডে ডেটা পাঠানো
    res.json({
      success: true,
      token: accessToken, // আগের compatibility বজায় রাখতে 'token' কি ব্যবহার করা হয়েছে
      refreshToken,
      user: {
        _id: user._id,
        name: user.name || user.username,
        username: user.username,
        role: user.role,
        email: user.email,
        campus: user.campus
          ? {
              _id: user.campus._id || user.campus,
              name: user.campus.name,
            }
          : undefined,
        campuses: Array.isArray(user.campuses)
          ? user.campuses.map((item) => ({
              _id: item._id || item,
              name: item.name,
            }))
          : [],
        teacherProfile: user.teacherProfile
          ? {
              _id: user.teacherProfile._id || user.teacherProfile,
              name: user.teacherProfile.name,
              teacherId: user.teacherProfile.teacherId,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("SERVER CRITICAL ERROR during login process:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error during login process. Please check server logs.",
    });
  }
};

// --- POST /api/auth/refresh ---
// Access token এক্সপায়ার হলে নতুন টোকেন পাওয়ার জন্য
const refreshAccessToken = async (req, res) => {
  const { token } = req.body;

  if (!token)
    return res.status(401).json({ message: "Refresh Token required" });

  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    const user = await User.findById(decoded.id)
      .populate("campus", "name")
      .populate("campuses", "name")
      .populate("teacherProfile", "name teacherId");

    if (!user) return res.status(403).json({ message: "User not found" });

    const tokens = generateTokens(user);
    res.json({ success: true, ...tokens });
  } catch (err) {
    res.status(403).json({ message: "Invalid or expired Refresh Token" });
  }
};

// --- POST /api/auth/logout ---
const logoutUser = async (req, res) => {
  // ডায়নামিক UI-তে ফ্রন্টএন্ড থেকে টোকেন রিমুভ করলেই এটি কার্যকর হয়
  res.status(200).json({ success: true, message: "Successfully logged out." });
};

module.exports = {
  loginUser,
  logoutUser,
  refreshAccessToken,
};
