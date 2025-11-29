const mongoose = require("mongoose");

const BranchSchema = new mongoose.Schema(
  {
    // Branch Name: e.g., "Ban-Day" (Banasree - Day Shift)
    name: {
      type: String,
      required: true,
      unique: true, // নিশ্চিত করবে যে একই নামের একাধিক ব্রাঞ্চ না থাকে
      trim: true,
    },

    // Branch Location: e.g., "Banasree"
    location: {
      type: String,
      required: false, // এটি ঐচ্ছিক রাখা যেতে পারে
      trim: true,
    },

    // A short description about the branch (optional)
    description: {
      type: String,
    },

    // Status: For enabling/disabling a branch without deleting it
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // স্বয়ংক্রিয়ভাবে createdAt এবং updatedAt ফিল্ড যুক্ত করবে
  }
);

// মডেলটিকে এক্সপোর্ট করা হচ্ছে
module.exports = mongoose.model("Branch", BranchSchema);
