const mongoose = require("mongoose");

const ResponsibilityAssignmentSchema = new mongoose.Schema(
  {
    // Reference to the Teacher Model: কাকে দায়িত্ব দেওয়া হচ্ছে
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },

    teacherCampus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: false, // Optional, but recommended to be true
    },

    // Reference to the Responsibility Type Model: কী দায়িত্ব দেওয়া হচ্ছে
    responsibilityType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResponsibilityType",
      required: true,
    },

    // Academic Year: কোন বছরের জন্য এই দায়িত্ব
    year: {
      type: Number,
      required: true,
    },

    // Reference to the Class Model (Required for tasks like Examiner/Tabulator)
    targetClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: false, // যদি responsibilityType-এ requiresClassSubject: true থাকে, তবে এটি required হবে
    },

    // Reference to the Subject Model (Required for tasks like Examiner)
    targetSubject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: false, // যদি responsibilityType-এ requiresClassSubject: true থাকে, তবে এটি required হবে
    },

    // Status of the assignment
    status: {
      type: String,
      enum: ["Assigned", "Confirmed", "Cancelled", "Completed"],
      default: "Assigned",
    },

    // Optional Note/Comment about the assignment
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// গুরুত্বপূর্ণ: একটি নির্দিষ্ট বছর, শিক্ষক, ক্লাস, এবং বিষয়ের জন্য একই দায়িত্ব যেন ডুপ্লিকেট না হয়, তার জন্য ইউনিক ইনডেক্স ব্যবহার করা যেতে পারে।
ResponsibilityAssignmentSchema.index(
  {
    teacher: 1,
    responsibilityType: 1,
    year: 1,
    targetClass: 1,
    targetSubject: 1,
  },
  { unique: true }
);

// মডেলটিকে এক্সপোর্ট করা হচ্ছে
module.exports = mongoose.model(
  "ResponsibilityAssignment",
  ResponsibilityAssignmentSchema
);
