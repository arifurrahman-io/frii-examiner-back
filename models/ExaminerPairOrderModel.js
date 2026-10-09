const mongoose = require("mongoose");

const ExaminerPairOrderSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: true,
    },
    responsibilityType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResponsibilityType",
      required: true,
    },
    targetClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    targetSubject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    // Ordered teacher refs: index 0 = Examiner-1 / Examiner, index 1 = Examiner-2 / Scrutinizer
    teacherOrder: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher",
      },
    ],
  },
  {
    timestamps: true,
  }
);

ExaminerPairOrderSchema.index(
  {
    year: 1,
    responsibilityType: 1,
    targetClass: 1,
    targetSubject: 1,
  },
  { unique: true }
);

module.exports = mongoose.model("ExaminerPairOrder", ExaminerPairOrderSchema);
