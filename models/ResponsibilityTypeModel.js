const mongoose = require("mongoose");

const ResponsibilityTypeSchema = new mongoose.Schema(
  {
    // Responsibility Name/Code: e.g., "E-Annual", "Q-HY", "Invigilator Duty"
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Full Description of the responsibility
    description: {
      type: String,
      required: false,
    },

    // 🚀 FIX: Add the required 'code' field for the Yearly Report
    code: {
      type: String,
      required: false, // Make required: true if all duties must have a code
      unique: true,
      trim: true,
      uppercase: true,
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
    timestamps: true,
  }
);

// মডেলটিকে এক্সপোর্ট করা হচ্ছে
module.exports = mongoose.model("ResponsibilityType", ResponsibilityTypeSchema);
