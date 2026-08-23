const mongoose = require("mongoose");

const IncrementCriteriaSchema = new mongoose.Schema(
  {
    evaluateeRole: {
      type: String,
      enum: ["teacher", "incharge", "coordinator"],
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    titleBn: {
      type: String,
      required: true,
      trim: true,
    },
    descriptionBn: {
      type: String,
      trim: true,
      default: "",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

IncrementCriteriaSchema.index(
  { evaluateeRole: 1, code: 1 },
  { unique: true }
);

module.exports = mongoose.model("IncrementCriteria", IncrementCriteriaSchema);
