const mongoose = require("mongoose");

const DutyExclusivitySchema = new mongoose.Schema(
  {
    hyPreTest: { type: Boolean, default: true },
    eTest: { type: Boolean, default: true },
    eAnnual: { type: Boolean, default: true },
  },
  { _id: false }
);

const AppSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "global",
    },
    dutyExclusivity: {
      type: DutyExclusivitySchema,
      default: () => ({
        hyPreTest: true,
        eTest: true,
        eAnnual: true,
      }),
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppSettings", AppSettingsSchema);
