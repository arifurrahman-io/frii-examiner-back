const mongoose = require("mongoose");

const PayrollAttendanceSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    campus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    year: {
      type: Number,
      required: true,
      min: 2000,
      max: 2100,
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    presentDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    clDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    lwpDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

PayrollAttendanceSchema.index({ teacher: 1, year: 1, month: 1 }, { unique: true });
PayrollAttendanceSchema.index({ campus: 1, year: 1, month: 1 });

module.exports = mongoose.model("PayrollAttendance", PayrollAttendanceSchema);
