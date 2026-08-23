const mongoose = require("mongoose");

const createRatingField = () => ({
  type: Number,
  required: true,
  min: 1,
  max: 5,
});

const ClassPerformanceObservationSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
      index: true,
    },
    campus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    observer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    observerRole: {
      type: String,
      enum: ["admin", "head_teacher", "incharge"],
      required: true,
    },
    className: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
    },
    classDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    topic: {
      type: String,
      trim: true,
    },
    durationMinutes: {
      type: Number,
      min: 1,
    },
    criteria: {
      presentation: createRatingField(),
      discipline: createRatingField(),
      subjectDepth: createRatingField(),
    },
    overallRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    comments: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

ClassPerformanceObservationSchema.index({
  teacher: 1,
  classDate: -1,
});

ClassPerformanceObservationSchema.index({
  campus: 1,
  classDate: -1,
});

ClassPerformanceObservationSchema.pre("validate", function (next) {
  if (!this.overallRating && this.criteria) {
    const values = [
      this.criteria.presentation,
      this.criteria.discipline,
      this.criteria.subjectDepth,
    ].filter((value) => typeof value === "number");

    if (values.length) {
      this.overallRating =
        Math.round(
          (values.reduce((total, value) => total + value, 0) / values.length) *
            100
        ) / 100;
    }
  }

  next();
});

module.exports = mongoose.model(
  "ClassPerformanceObservation",
  ClassPerformanceObservationSchema
);
