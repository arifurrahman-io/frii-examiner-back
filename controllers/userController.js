const User = require("../models/UserModel");
const bcrypt = require("bcryptjs");

// ✅ সকল ইউজার গেট করা
const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ নতুন ইউজার অ্যাড করা
const addUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
    });
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// ✅ ইউজার আপডেট করা
const updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// ✅ ইউজার ডিলিট করা
const deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User removed successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// 🚀 এটিই সবচেয়ে গুরুত্বপূর্ণ অংশ: অবজেক্ট হিসেবে এক্সপোর্ট
module.exports = {
  getUsers,
  addUser,
  updateUser,
  deleteUser,
};
