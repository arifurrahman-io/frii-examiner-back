const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true }, // শুধুমাত্র ইমেইল ইউনিক থাকবে
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["admin", "teacher", "incharge"],
      default: "teacher",
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
