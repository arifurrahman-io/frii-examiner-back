const User = require("../models/UserModel");
const bcrypt = require("bcryptjs");

/**
 * ✅ সকল ইউজার গেট করা (ক্যাম্পাস তথ্য সহ)
 */
const getUsers = async (req, res) => {
  try {
    // ইউজারদের পাসওয়ার্ড বাদে এবং ক্যাম্পাস ডাটা পপুলেট করে নিয়ে আসা
    const users = await User.find()
      .select("-password")
      .populate("campus", "name");
    res.json(users);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to retrieve user matrix: " + error.message });
  }
};

/**
 * ✅ নতুন ইউজার অ্যাড করা (ভ্যালিডেশন ও সিকিউরিটি সহ)
 */
const addUser = async (req, res) => {
  try {
    const { name, email, password, role, campus, username } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();

    // ১. ইমেইল ডুপ্লিকেশন চেক
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({
        message: "Identity conflict: User with this email already exists.",
      });
    }

    // ২. ইনচার্জ রোলের ক্ষেত্রে ক্যাম্পাস নিশ্চিত করা
    if (role === "incharge" && !campus) {
      return res.status(400).json({
        message:
          "Protocol Error: Campus node must be assigned for Incharge role.",
      });
    }

    // ৩. পাসওয়ার্ড হ্যাশিং
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // ৪. ইউজার তৈরি
    const user = await User.create({
      name,
      username: username?.trim() || normalizedEmail,
      email: normalizedEmail,
      password: hashedPassword,
      role: role || "teacher",
      // অ্যাডমিন বা টিচার হলে ক্যাম্পাস ফিল্ড রিমুভ করা
      campus: role === "incharge" ? campus : undefined,
    });

    // ৫. সিকিউর রেসপন্স (পাসওয়ার্ড ছাড়া)
    const userResponse = await User.findById(user._id)
      .select("-password")
      .populate("campus", "name");

    res.status(201).json({
      message: "New access node established successfully.",
      data: userResponse,
    });
  } catch (error) {
    console.error("User Creation Error:", error);
    res
      .status(500)
      .json({ message: "Internal System Error during node creation." });
  }
};

/**
 * ✅ ইউজার প্রোফাইল বা রোল আপডেট করা
 */
const updateUser = async (req, res) => {
  try {
    const { password, role, campus, email, username, ...otherData } = req.body;

    // আপডেট করার জন্য প্রাথমিক ডাটা
    let updateFields = { ...otherData, role };
    if (email) updateFields.email = email.trim().toLowerCase();
    if (username) updateFields.username = username.trim();

    // 🛡️ পাসওয়ার্ড লজিক: যদি পাসওয়ার্ড ইনপুট দেওয়া হয় তবেই সেটি হ্যাশ করে আপডেট হবে
    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(password, salt);
    } else {
      // যদি পাসওয়ার্ড ব্ল্যাঙ্ক থাকে, তবে ডাটাবেস থেকে আগের পাসওয়ার্ড বজায় রাখতে
      // এই ফিল্ডটি আপডেট অবজেক্ট থেকে বাদ দেওয়া হলো।
      delete updateFields.password;
    }

    // ইনচার্জ রোলের ক্ষেত্রে ক্যাম্পাস লজিক
    if (role === "incharge") {
      if (!campus) {
        return res
          .status(400)
          .json({ message: "Campus must be assigned for Incharge node." });
      }
      updateFields.campus = campus;
    } else {
      updateFields.$unset = { campus: "" }; // অ্যাডমিন/টিচার হলে ক্যাম্পাস ডাটা মুছে ফেলবে
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    )
      .select("-password")
      .populate("campus", "name");

    if (!updatedUser) {
      return res.status(404).json({ message: "User node not found." });
    }

    res.json({
      message: "User synchronization complete.",
      data: updatedUser,
    });
  } catch (error) {
    res.status(400).json({ message: "Update failed: " + error.message });
  }
};

/**
 * ✅ ইউজার রিমুভ করা
 */
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // নোট: আপনি চাইলে এখানে চেক করতে পারেন যেন অ্যাডমিন নিজেকে ডিলিট না করতে পারে
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Access node terminated and removed from system." });
  } catch (error) {
    res.status(400).json({ message: "Deletion failed: " + error.message });
  }
};

// মডিউল এক্সপোর্ট
module.exports = {
  getUsers,
  addUser,
  updateUser,
  deleteUser,
};
