const mongoose = require("mongoose");

const ResponsibilityTypeSchema = new mongoose.Schema(
  {
    // Responsibility Name/Code: e.g., "E-Annual", "Q-HY", "Invigilator Duty"
    name: {
      type: String,
      required: true,
      unique: true, // নিশ্চিত করবে যে একই নামের একাধিক দায়িত্বের প্রকার না থাকে
      trim: true,
    },

    // Full Description of the responsibility
    description: {
      type: String,
      required: false,
    },

    // Category: e.g., "Examination", "Administrative", "Co-curricular"
    category: {
      type: String,
      enum: [
        "Examination",
        "Administrative",
        "Academic",
        "Co-curricular",
        "Other",
      ],
      default: "Examination",
    },

    // Optional: Indicates if this responsibility is tied to a specific Class/Subject (like Examiner)
    requiresClassSubject: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // স্বয়ংক্রিয়ভাবে createdAt এবং updatedAt ফিল্ড যুক্ত করবে
  }
);

// মডেলটিকে এক্সপোর্ট করা হচ্ছে
module.exports = mongoose.model("ResponsibilityType", ResponsibilityTypeSchema);
