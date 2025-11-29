// models/LeaveModel.js

// 1. CRITICAL FIX: Import Mongoose
const mongoose = require("mongoose");

const LeaveSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    responsibilityType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResponsibilityType",
      required: true,
    }, // e.g., Annual Exam Examiner
    year: { type: Number, required: true },
    startDate: { type: Date, required: false },
    endDate: { type: Date, required: false },
    status: {
      type: String,
      enum: ["Pending", "Granted", "Rejected"],
      default: "Granted",
    },
    reason: { type: String, required: false }, // ✅ NEW: Optional reason field
  },
  { timestamps: true }
);

// 2. Export the model
module.exports = mongoose.model("Leave", LeaveSchema);
