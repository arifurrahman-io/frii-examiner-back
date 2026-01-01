const jwt = require("jsonwebtoken");
const User = require("../models/UserModel");

// এনভায়রনমেন্ট ভ্যারিয়েবল থেকে সিক্রেট কী সংগ্রহ
const JWT_SECRET = process.env.JWT_SECRET || "your_fallback_secret_key";

/**
 * @desc ইউজার অথেন্টিকেশন যাচাই (JWT Verification)
 */
const protect = async (req, res, next) => {
  let token;

  // Authorization হেডার চেক করা
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // হেডার থেকে টোকেন আলাদা করা
      token = req.headers.authorization.split(" ")[1];

      // টোকেন ডিকোড ও ভেরিফাই করা
      const decoded = jwt.verify(token, JWT_SECRET);

      // ডাটাবেস থেকে ইউজার খুঁজে বের করা (পাসওয়ার্ড বাদে)
      req.user = await User.findById(decoded.id).select("-password");

      // ইউজার অস্তিত্বহীন হলে
      if (!req.user) {
        return res
          .status(401)
          .json({ success: false, message: "User no longer exists." });
      }

      // ইউজার স্ট্যাটাস চেক (অ্যাকাউন্ট ডিঅ্যাক্টিভেটেড কিনা)
      if (req.user.status === "inactive") {
        return res
          .status(401)
          .json({ success: false, message: "Your account is deactivated." });
      }

      next(); // সব ঠিক থাকলে পরবর্তী ধাপে যাবে
    } catch (error) {
      console.error("Auth Token Error:", error.message);
      return res
        .status(401)
        .json({ success: false, message: "Not authorized, token failed." });
    }
  }

  // যদি টোকেন না পাঠানো হয়
  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Not authorized, no token provided." });
  }
};

/**
 * @desc শুধুমাত্র অ্যাডমিন রোলের জন্য অনুমতি (RBAC)
 * এই ফাংশনটি ৪0৩ Forbidden এরর হ্যান্ডেল করে।
 */
const admin = (req, res, next) => {
  // রোলটি স্ট্রিং হিসেবে নির্ভুলভাবে চেক করা
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    // যদি অ্যাডমিন না হয় তবে ৪0৩ এরর প্রদান করবে
    return res.status(403).json({
      success: false,
      message: `Access denied. Role: ${
        req.user?.role || "Guest"
      } is not authorized to access this resource.`,
    });
  }
};

/**
 * @desc মাল্টি-রোল এক্সেস (অ্যাডমিন বা ইনচার্জ উভয়ের জন্য)
 */
const staffOnly = (req, res, next) => {
  const allowedRoles = ["admin", "incharge"];
  if (req.user && allowedRoles.includes(req.user.role)) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Access restricted. Only Admin or Incharge can access this.",
    });
  }
};

module.exports = { protect, admin, staffOnly };
