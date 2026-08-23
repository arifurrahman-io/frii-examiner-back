const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, unique: true, sparse: true, trim: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: [
        "admin",
        "head_teacher",
        "coordinator",
        "executive",
        "teacher",
        "incharge",
      ],
      default: "teacher",
    },
    // Shift incharge → single campus/shift Branch
    campus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: function () {
        return this.role === "incharge";
      },
    },
    // Branch coordinator / executive → multiple campuses/shifts
    campuses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
      },
    ],
    // Link staff login to Teacher profile (for incharge / coordinator evaluation target)
    teacherProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      default: null,
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
