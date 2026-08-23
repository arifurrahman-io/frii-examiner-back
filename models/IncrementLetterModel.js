const mongoose = require("mongoose");

const IncrementLetterSchema = new mongoose.Schema(
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
    evaluateeRole: {
      type: String,
      enum: ["teacher", "incharge", "coordinator"],
      required: true,
    },
    letterDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["draft", "final"],
      default: "draft",
    },
    averages: {
      overall: { type: Number, default: null },
      byEvaluatorRole: {
        incharge: { type: Number, default: null },
        coordinator: { type: Number, default: null },
        head_teacher: { type: Number, default: null },
      },
      byCriterion: [
        {
          criterion: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "IncrementCriteria",
          },
          titleBn: String,
          average: Number,
        },
      ],
    },
    generalIncrement: { type: Number, default: 0 },
    performanceIncrement: { type: Number, default: 0 },
    totalIncrement: { type: Number, default: 0 },
    criterionAmounts: [
      {
        criterion: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "IncrementCriteria",
        },
        titleBn: { type: String, default: "" },
        amount: { type: Number, default: 0 },
      },
    ],
    previousBasic: { type: Number, default: 0 },
    previousHouseRent: { type: Number, default: 0 },
    newBasic: { type: Number, default: 0 },
    newHouseRent: { type: Number, default: 0 },
    totalMonthly: { type: Number, default: 0 },
    effectiveFromLabel: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    finalizedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lockedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

IncrementLetterSchema.index({ teacher: 1, fiscalYear: 1 }, { unique: true });

module.exports = mongoose.model("IncrementLetter", IncrementLetterSchema);
