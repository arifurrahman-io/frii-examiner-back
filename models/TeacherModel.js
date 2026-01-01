const mongoose = require("mongoose");

const TeacherSchema = new mongoose.Schema(
  {
    teacherId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: false,
    },
    campus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    designation: {
      type: String,
      required: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    /** * 📊 REPORTS & RESPONSIBILITIES
     * ইনচার্জরা এখানে বছরের ভিত্তিতে রিপোর্ট এবং দায়িত্ব ইনপুট দিতে পারবেন।
     */
    reports: [
      {
        year: {
          type: Number,
          required: true,
        },
        responsibility: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ResponsibilityType",
          required: true,
        },
        performanceReport: {
          type: String,
          trim: true,
        },
        addedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User", // কোন ইনচার্জ বা অ্যাডমিন এটি যুক্ত করেছেন
        },
        date: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Teacher", TeacherSchema);
