const mongoose = require("mongoose");

const ExaminerExchangeDateSchema = new mongoose.Schema(
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
    lastDateOfExchange: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ExaminerExchangeDateSchema.index(
  {
    year: 1,
    responsibilityType: 1,
    targetClass: 1,
    targetSubject: 1,
  },
  { unique: true }
);

module.exports = mongoose.model(
  "ExaminerExchangeDate",
  ExaminerExchangeDateSchema
);
