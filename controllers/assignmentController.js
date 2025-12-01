const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const Teacher = require("../models/TeacherModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const Leave = require("../models/LeaveModel");
const mongoose = require("mongoose");
const Class = require("../models/ClassModel");
const Subject = require("../models/SubjectModel");

// --- ১. Assign Responsibility ---
const assignResponsibility = async (req, res) => {
  const {
    teacher,
    responsibilityType,
    year,
    targetClass,
    targetSubject,
    notes,
  } = req.body;

  try {
    // 1. Fetch Teacher Details and Responsibility Type concurrently
    const [teacherExists, typeExists] = await Promise.all([
      // Populate the 'campus' field from the Teacher model
      Teacher.findById(teacher).populate("campus"),
      ResponsibilityType.findById(responsibilityType),
    ]);

    if (!teacherExists || !typeExists)
      return res
        .status(404)
        .json({ message: "Teacher or Responsibility Type not found." });

    // ✅ NEW: Extract the campus ID from the fetched teacher object
    const teacherCampusId = teacherExists.campus?._id;

    // Safety check: ensure campus was found
    if (!teacherCampusId) {
      return res
        .status(400)
        .json({ message: "Teacher's campus is missing or invalid." });
    }

    // ... (Leave conflict check remains unchanged) ...
    const leaveConflict = await Leave.findOne({
      teacher,
      responsibilityType,
      year,
      status: "Granted",
    });

    if (leaveConflict)
      return res.status(400).json({
        message: `Assignment blocked: Teacher has a Granted Leave for this responsibility type in ${year}.`,
      });

    // ... (Existing assignment check remains unchanged) ...
    const existingAssignment = await ResponsibilityAssignment.findOne({
      teacher,
      responsibilityType,
      year,
      targetClass: targetClass || null,
      targetSubject: targetSubject || null,
    });

    if (existingAssignment && existingAssignment.status !== "Cancelled")
      return res.status(400).json({
        message: "This exact responsibility is already assigned and active.",
      });

    // 2. Create new assignment with the new teacherCampus field
    const newAssignment = await ResponsibilityAssignment.create({
      teacher,
      teacherCampus: teacherCampusId, // ✅ SAVE THE CAMPUS ID
      responsibilityType,
      year,
      targetClass,
      targetSubject,
      notes,
      status: "Assigned",
    });

    res.status(201).json(newAssignment);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error assigning responsibility: " + error.message });
  }
};

// --- ২. Hard Delete ---
const deleteAssignmentPermanently = async (req, res) => {
  try {
    const deletedAssignment = await ResponsibilityAssignment.findByIdAndDelete(
      req.params.id
    );

    if (!deletedAssignment)
      return res
        .status(404)
        .json({ message: "Assignment not found for deletion." });

    res.json({ message: "Assignment permanently deleted." });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting assignment: " + error.message });
  }
};

// --- ৩. Get Assignments with Filtering & Campus support ---
const getAssignmentsForReport = async (req, res) => {
  const { year, typeId, classId, status, campusId } = req.query;

  let matchQuery = {};
  if (year) matchQuery.year = parseInt(year);
  if (typeId) matchQuery.responsibilityType = typeId;
  if (classId) matchQuery.targetClass = classId;
  if (status) matchQuery.status = status;
  if (!matchQuery.status) matchQuery.status = { $ne: "Cancelled" };

  try {
    let pipeline = [{ $match: matchQuery }];

    // Lookup teacher
    pipeline.push({
      $lookup: {
        from: "teachers",
        localField: "teacher",
        foreignField: "_id",
        as: "teacherDetails",
      },
    });
    pipeline.push({ $unwind: "$teacherDetails" });

    // Apply campus filter if provided
    if (campusId && mongoose.Types.ObjectId.isValid(campusId)) {
      pipeline.push({
        $match: {
          "teacherDetails.campus": new mongoose.Types.ObjectId(campusId),
        },
      });
    }

    // Lookup branch name from campuses collection
    pipeline.push({
      $lookup: {
        from: "branches",
        localField: "teacherDetails.campus",
        foreignField: "_id",
        as: "branchDetails",
      },
    });
    pipeline.push({
      $unwind: { path: "$branchDetails", preserveNullAndEmptyArrays: true },
    });

    // Lookup responsibility type
    pipeline.push({
      $lookup: {
        from: "responsibilitytypes",
        localField: "responsibilityType",
        foreignField: "_id",
        as: "typeDetails",
      },
    });
    pipeline.push({ $unwind: "$typeDetails" });

    // Lookup class
    pipeline.push({
      $lookup: {
        from: "classes",
        localField: "targetClass",
        foreignField: "_id",
        as: "classDetails",
      },
    });
    pipeline.push({
      $unwind: { path: "$classDetails", preserveNullAndEmptyArrays: true },
    });

    // Lookup subject
    pipeline.push({
      $lookup: {
        from: "subjects",
        localField: "targetSubject",
        foreignField: "_id",
        as: "subjectDetails",
      },
    });
    pipeline.push({
      $unwind: { path: "$subjectDetails", preserveNullAndEmptyArrays: true },
    });

    // Final projection
    pipeline.push({
      $project: {
        _id: 1,
        Teacher: "$teacherDetails.name",
        Campus: { $ifNull: ["$branchDetails.name", "N/A"] },
        "Responsibility Type": "$typeDetails.name",
        Year: "$year",
        Class: "$classDetails.name",
        Subject: "$subjectDetails.name",
        Status: "$status",
        CreatedAt: "$createdAt",
        UpdatedAt: "$updatedAt",
      },
    });

    pipeline.push({ $sort: { Class: 1, Teacher: 1 } });

    const assignments = await ResponsibilityAssignment.aggregate(pipeline);

    res.json(assignments);
  } catch (error) {
    console.error("Report Fetch Error:", error);
    res.status(500).json({
      message: "Error fetching assignments for report: " + error.message,
    });
  }
};

// --- ৪. Get Assignments by Teacher & Year (Conflict Check) ---
const getAssignmentsByTeacherAndYear = async (req, res) => {
  const { teacherId } = req.params;
  const { year } = req.query;

  if (!mongoose.Types.ObjectId.isValid(teacherId))
    return res.status(400).json({ message: "Invalid Teacher ID format." });

  let query = { teacher: teacherId };
  if (year) query.year = parseInt(year);

  try {
    const assignments = await ResponsibilityAssignment.find(query)
      .populate("responsibilityType", "name")
      .populate("targetClass", "name")
      .populate("targetSubject", "name")
      .sort({ createdAt: -1 });

    res.json(assignments);
  } catch (error) {
    console.error("Assignment conflict check failed:", error);
    res.status(500).json({
      message: "Failed to fetch existing assignments for conflict check.",
    });
  }
};

module.exports = {
  assignResponsibility,
  deleteAssignmentPermanently,
  getAssignmentsForReport,
  getAssignmentsByTeacherAndYear,
};
