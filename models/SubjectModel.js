const mongoose = require("mongoose");

const SubjectSchema = new mongoose.Schema(
  {
    // Subject Name: e.g., "Physics", "Bangla-I", "Mathematics"
    name: {
      type: String,
      required: true,
      unique: true, // নিশ্চিত করবে যে একই নামের একাধিক বিষয় না থাকে
      trim: true,
    },

    // Subject Code or Short Name: e.g., "PHY", "MTH" (Optional but useful)
    code: {
      type: String,
      required: false,
      unique: true,
      trim: true,
    },

    // Subject Type: Useful for reporting (e.g., "Compulsory", "Optional", "Religious")
    type: {
      type: String,
      enum: ["Compulsory", "Optional", "Core", "Religious", "Group"],
      default: "Core",
    },

    // Optional: A link to the ClassModel if the subject is class-specific
    // For instance, Chemistry is only relevant from Class IX upwards.
    minClassLevel: {
      type: Number,
      required: false,
    },
  },
  {
    timestamps: true, // স্বয়ংক্রিয়ভাবে createdAt এবং updatedAt ফিল্ড যুক্ত করবে
  }
);

// মডেলটিকে এক্সপোর্ট করা হচ্ছে
module.exports = mongoose.model("Subject", SubjectSchema);
