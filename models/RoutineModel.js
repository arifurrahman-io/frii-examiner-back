const mongoose = require("mongoose");

const RoutineDetailSchema = new mongoose.Schema(
  {
    // The Class ID being taught
    className: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    // The Subject ID being taught
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    // Optional slot field (if time/day information is added later)
    slot: {
      type: String,
      required: false,
    },
  },
  { _id: true }
); // Crucial: Ensures each assignment gets its own _id for deletion

// The main Routine structure: One document per Teacher
const RoutineSchema = new mongoose.Schema(
  {
    // Reference to the Teacher Model (Unique per teacher)
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
      unique: true, // Crucial: Only one document per teacher
    },

    // An array where each element represents a year's worth of routine assignments
    years: [
      {
        year: {
          type: Number,
          required: true,
        },
        // Array of assignments for that specific year
        assignments: [RoutineDetailSchema],
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Routine", RoutineSchema);
