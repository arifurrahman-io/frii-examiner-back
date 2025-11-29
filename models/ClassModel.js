const mongoose = require("mongoose");

const ClassSchema = new mongoose.Schema(
  {
    // Class Name: e.g., "Nine", "Eight", "Five"
    name: {
      type: String,
      required: true,
      unique: true, // নিশ্চিত করবে যে একই নামের একাধিক ক্লাস না থাকে
      trim: true,
      uppercase: true, // ডাটা কনসিস্টেন্সি বজায় রাখতে সব ক্লাস নামকে আপারকেস করা যেতে পারে
    },

    // Class Level/Order: এটি রিপোর্টিং এবং সাজানোর (sorting) জন্য দরকারি
    // যেমন: Five এর জন্য 5, Nine এর জন্য 9
    level: {
      type: Number,
      required: true,
      unique: true, // প্রতিটি লেভেল যেন অনন্য হয়
    },

    // Class group or stream (optional, for higher classes like Nine/Ten)
    stream: {
      type: [String], // Array of strings: ['Science', 'Arts', 'Commerce']
      required: false,
    },
  },
  {
    timestamps: true, // স্বয়ংক্রিয়ভাবে createdAt এবং updatedAt ফিল্ড যুক্ত করবে
  }
);

// মডেলটিকে এক্সপোর্ট করা হচ্ছে
module.exports = mongoose.model("Class", ClassSchema);
