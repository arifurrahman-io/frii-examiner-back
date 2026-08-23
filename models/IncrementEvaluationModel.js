const mongoose = require("mongoose");

const IncrementEvaluationSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
      index: true,
    },
    fiscalYear: {
      type: String,
      required: true,
      index: true,
    },
    criterion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IncrementCriteria",
      required: true,
      index: true,
    },
    score: {
      type: Number,
      required: true,
      min: 1,
    },
    scaleMax: {
      type: Number,
      required: true,
      enum: [4, 5],
    },
    normalizedScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    evaluator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    evaluatorRole: {
      type: String,
      enum: ["admin", "head_teacher", "coordinator", "incharge"],
      required: true,
    },
    evaluatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

IncrementEvaluationSchema.index({ teacher: 1, fiscalYear: 1, evaluatedAt: -1 });

module.exports = mongoose.model(
  "IncrementEvaluation",
  IncrementEvaluationSchema
);
