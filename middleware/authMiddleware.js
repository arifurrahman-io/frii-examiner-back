const jwt = require("jsonwebtoken");
// Production এর জন্য অবশ্যই process.env.JWT_SECRET ব্যবহার করুন
const JWT_SECRET = process.env.JWT_SECRET || "your_fallback_secret_key";

// ইউজার লগইন করেছে কিনা তা যাচাই করার জন্য
const protect = (req, res, next) => {
  let token;

  // Header থেকে টোকেন বের করা
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // টোকেন যাচাই করা
      const decoded = jwt.verify(token, JWT_SECRET);

      // req.user এ টোকেন থেকে প্রাপ্ত ডেটা (id, role) সেভ করা
      req.user = decoded;
      next();
    } catch (error) {
      console.error(error);
      return res.status(401).json({ message: "Not authorized, token failed." });
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token." });
  }
};

// ইউজার অ্যাডমিন কিনা তা যাচাই করার জন্য
const admin = (req, res, next) => {
  // protect মিডলওয়্যার থেকে আসা req.user ব্যবহার করা হয়
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({ message: "Not authorized as an admin." });
  }
};

module.exports = { protect, admin };
