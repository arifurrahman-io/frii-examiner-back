const bcrypt = require("bcryptjs");
const User = require("../models/UserModel"); // আপনার তৈরি করা User Model ইমপোর্ট করুন
const connectDB = require("../config/db"); // DB কানেকশন ইমপোর্ট করুন
const dotenv = require("dotenv");

dotenv.config();
connectDB(); // ডাটাবেস সংযোগ করুন

const seedAdminUser = async () => {
  try {
    // ১. অ্যাডমিনের ক্রেডেনশিয়ালস
    const adminUsername = process.env.ADMIN_USERNAME || "superadmin";
    const adminPassword = process.env.ADMIN_PASSWORD || "password123";

    // ডুপ্লিকেট অ্যাডমিন চেক করা
    const existingAdmin = await User.findOne({ username: adminUsername });
    if (existingAdmin) {
      console.log("Admin user already exists. Skipping seed.");
      return;
    }

    // ২. পাসওয়ার্ড হ্যাশ করা
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    // ৩. নতুন অ্যাডমিন তৈরি করা
    const newAdmin = await User.create({
      username: adminUsername,
      password: hashedPassword,
      role: "admin", // ⬅️ অ্যাডমিন রোল সেট করা
    });

    console.log(`✅ Super Admin created successfully: ${newAdmin.username}`);
  } catch (error) {
    console.error(`❌ Error during admin seeding: ${error.message}`);
    process.exit(1);
  }
};

// ফাংশনটি কল করা
seedAdminUser();
