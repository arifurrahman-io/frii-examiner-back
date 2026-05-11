const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const Teacher = require("../models/TeacherModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const Leave = require("../models/LeaveModel");
const mongoose = require("mongoose");
const Class = require("../models/ClassModel");
const Subject = require("../models/SubjectModel");

// --- ১. Assign Responsibility (Updated with Incharge Restrictions) ---
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
    // 1. Fetch Teacher, Responsibility Type, and target Class concurrently
    const [teacherExists, typeExists, classExists, subjectExists] =
      await Promise.all([
      Teacher.findById(teacher).populate("campus"),
      ResponsibilityType.findById(responsibilityType),
      targetClass ? Class.findById(targetClass) : null,
      targetSubject ? Subject.findById(targetSubject) : null,
    ]);

    if (!teacherExists || !typeExists)
      return res
        .status(404)
        .json({ message: "Teacher or Responsibility Type not found." });

    if (typeExists.requiresClassSubject && (!classExists || !subjectExists)) {
      return res.status(400).json({
        message: "Class and Subject are required for this responsibility type.",
      });
    }

    if (targetClass && !classExists) {
      return res.status(404).json({ message: "Target class not found." });
    }

    if (targetSubject && !subjectExists) {
      return res.status(404).json({ message: "Target subject not found." });
    }

    // 🛡️ ROLE PROTECTION: Incharge restricted to Class One, Two, Three
    if (req.user.role === "incharge") {
      if (String(teacherExists.campus?._id) !== String(req.user.campus)) {
        return res.status(403).json({
          message:
            "Access Denied: You can only assign teachers from your campus.",
        });
      }

      const allowedClasses = ["ONE", "TWO", "THREE"];
      if (classExists && !allowedClasses.includes(classExists.name)) {
        return res.status(403).json({
          message:
            "Access Denied: Incharge can only assign responsibilities to Class One, Two, or Three.",
        });
      }
    }

    // Extract the campus ID from the fetched teacher object
    const teacherCampusId = teacherExists.campus?._id;

    if (!teacherCampusId) {
      return res
        .status(400)
        .json({ message: "Teacher's campus is missing or invalid." });
    }

    // 2. Leave conflict check
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

    // 3. Existing assignment check
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

    // 4. Create new assignment
    const newAssignment = await ResponsibilityAssignment.create({
      teacher,
      teacherCampus: teacherCampusId,
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

// --- ২. Hard Delete (Admin Only Logic should be in Routes) ---
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

// --- ৩. Get Assignments with Filtering & Aggregation ---
const getAssignmentsForReport = async (req, res) => {
  const { year, typeId, classId, status, campusId } = req.query;

  let matchQuery = {};
  if (year) matchQuery.year = parseInt(year);
  if (typeId)
    matchQuery.responsibilityType = new mongoose.Types.ObjectId(typeId);
  if (classId) matchQuery.targetClass = new mongoose.Types.ObjectId(classId);
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

    // Apply campus filter
    if (campusId && mongoose.Types.ObjectId.isValid(campusId)) {
      pipeline.push({
        $match: {
          "teacherDetails.campus": new mongoose.Types.ObjectId(campusId),
        },
      });
    }

    // Lookup branch
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

    // Lookup types, classes, subjects
    const lookups = [
      {
        from: "responsibilitytypes",
        field: "responsibilityType",
        as: "typeDetails",
      },
      { from: "classes", field: "targetClass", as: "classDetails" },
      { from: "subjects", field: "targetSubject", as: "subjectDetails" },
    ];

    lookups.forEach((l) => {
      pipeline.push({
        $lookup: {
          from: l.from,
          localField: l.field,
          foreignField: "_id",
          as: l.as,
        },
      });
      pipeline.push({
        $unwind: { path: `$${l.as}`, preserveNullAndEmptyArrays: true },
      });
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
    res.status(500).json({
      message: "Error fetching assignments for report: " + error.message,
    });
  }
};

// --- ৪. Conflict Check ---
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
