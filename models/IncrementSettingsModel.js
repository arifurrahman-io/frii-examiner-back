const mongoose = require("mongoose");

const IncrementSettingsSchema = new mongoose.Schema(
  {
    fiscalYear: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    letterLockOn: {
      type: String,
      required: true,
      trim: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("IncrementSettings", IncrementSettingsSchema);
