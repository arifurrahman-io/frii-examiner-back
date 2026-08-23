const bcrypt = require("bcryptjs");
const User = require("../models/UserModel");

const verifyAdminPassword = async (userId, password) => {
  const normalizedPassword = String(password || "").trim();

  if (!normalizedPassword) {
    return {
      ok: false,
      status: 400,
      message: "Admin password is required.",
    };
  }

  const adminUser = await User.findById(userId).select("password role");

  if (!adminUser || adminUser.role !== "admin") {
    return {
      ok: false,
      status: 403,
      message: "Admin authorization failed.",
    };
  }

  const passwordMatches = await bcrypt.compare(
    normalizedPassword,
    adminUser.password
  );

  if (!passwordMatches) {
    return {
      ok: false,
      status: 401,
      message: "Admin password did not match. Deletion was not started.",
    };
  }

  return { ok: true };
};

module.exports = {
  verifyAdminPassword,
};
