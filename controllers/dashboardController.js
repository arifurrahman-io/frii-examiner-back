const Teacher = require("../models/TeacherModel");
const Class = require("../models/ClassModel");
const Branch = require("../models/BranchModel");
const Subject = require("../models/SubjectModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel"); // Required for top teachers list
const Leave = require("../models/LeaveModel"); // ✅ NEW: Import Leave Model
const mongoose = require("mongoose"); // Required for aggregation operations

// GET /api/dashboard/summary
const getDashboardSummary = async (req, res) => {
  try {
    const results = await Promise.all([
      Branch.countDocuments(),
      Class.countDocuments(),
      Subject.countDocuments(),
      ResponsibilityType.countDocuments(),
      Teacher.countDocuments(), // Index 4: Total Teachers
      Leave.countDocuments({ status: "Granted" }), // Index 5: Total Granted Leaves
    ]);

    // Fetch total active responsibilities separately
    const totalResponsibilities = await ResponsibilityAssignment.countDocuments(
      { status: "Assigned" }
    );

    res.json({
      totalBranches: results[0],
      totalClasses: results[1],
      totalSubjects: results[2],
      totalResponsibilities: totalResponsibilities, // Using the active count
      totalTeachers: results[4], // ✅ FIX: Index adjusted after adding Leave count
      totalGrantedLeaves: results[5], // ✅ NEW: Total Granted Leaves
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch dashboard summary counts." });
  }
};

// GET /api/dashboard/top-teachers
const getTopResponsibleTeachers = async (req, res) => {
  try {
    const topTeachers = await ResponsibilityAssignment.aggregate([
      // 1. Match: Only count Active Assignments
      { $match: { status: "Assigned" } },

      // 2. Group: Group by teacher ID and calculate totalDuties
      {
        $group: {
          _id: "$teacher",
          totalDuties: { $sum: 1 },
        },
      },

      // 3. Sort: Sort by totalDuties descending
      { $sort: { totalDuties: -1 } },

      // 4. Limit: Top 10 teachers
      { $limit: 10 },

      // 5. Lookup: Join with Teacher Model to get name and ID
      {
        $lookup: {
          from: "teachers", // TeacherModel collection name
          localField: "_id",
          foreignField: "_id",
          as: "teacherDetails",
        },
      },
      // The result is an array, unwind to access the object
      { $unwind: "$teacherDetails" },

      // 6. Project: Format the final output
      {
        $project: {
          _id: 0,
          teacherId: "$teacherDetails.teacherId",
          name: "$teacherDetails.name",
          totalDuties: "$totalDuties",
        },
      },
    ]);

    res.json(topTeachers);
  } catch (error) {
    console.error("Error fetching top teachers:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch top responsible teachers list." });
  }
};

// ✅ NEW FUNCTION: GET /api/dashboard/assignment-analytics
const getAssignmentAnalytics = async (req, res) => {
  try {
    const analyticsData = await ResponsibilityAssignment.aggregate([
      // 1. Match: Only include Assigned duties
      { $match: { status: "Assigned" } },

      // 2. Lookup Responsibility Type (to get the category field)
      {
        $lookup: {
          from: "responsibilitytypes", // ResponsibilityTypeModel collection name
          localField: "responsibilityType",
          foreignField: "_id",
          as: "typeDetails",
        },
      },
      { $unwind: "$typeDetails" },

      // 3. Group by Category and calculate count
      {
        $group: {
          _id: "$typeDetails.category",
          totalAssignments: { $sum: 1 },
        },
      },

      // 4. Project and sort
      {
        $project: {
          _id: 0,
          category: "$_id",
          count: "$totalAssignments",
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json(analyticsData);
  } catch (error) {
    console.error("Error fetching assignment analytics:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch assignment analytics data." });
  }
};

// GET /api/dashboard/recent-granted-leaves
const getRecentGrantedLeaves = async (req, res) => {
  try {
    const leaves = await Leave.find({ status: "Granted" })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate({
        path: "teacher",
        select: "name teacherId campus",
        populate: { path: "campus", select: "name" },
      })
      .populate("responsibilityType", "name");

    res.json(leaves);
  } catch (error) {
    console.error("Error fetching recent granted leaves:", error);
    res.status(500).json({ message: "Failed to fetch recent granted leaves." });
  }
};

// ✅ NEW FUNCTION 1: Responsibility Name-wise Analysis (Duty Type)
// GET /api/dashboard/assignment-by-type
const getAssignmentByDutyType = async (req, res) => {
  try {
    const analyticsData = await ResponsibilityAssignment.aggregate([
      { $match: { status: "Assigned" } },

      // Lookup Responsibility Type to get the name
      {
        $lookup: {
          from: "responsibilitytypes",
          localField: "responsibilityType",
          foreignField: "_id",
          as: "typeDetails",
        },
      },
      { $unwind: "$typeDetails" },

      // Group by Responsibility Name
      {
        $group: {
          _id: "$responsibilityType",
          name: { $first: "$typeDetails.name" }, // Capture the name
          count: { $sum: 1 },
        },
      },

      // Project and sort
      {
        $project: {
          _id: 0,
          name: "$name", // Use 'name' for chart label
          count: "$count",
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json(analyticsData);
  } catch (error) {
    console.error("Error fetching assignment by duty type:", error);
    res.status(500).json({ message: "Failed to fetch duty type analysis." });
  }
};

// ✅ NEW FUNCTION 2: Branch-wise Analysis
// GET /api/dashboard/assignment-by-branch
const getAssignmentByBranch = async (req, res) => {
  try {
    const analyticsData = await ResponsibilityAssignment.aggregate([
      { $match: { status: "Assigned" } },

      // Lookup Teacher to get the Branch ID
      {
        $lookup: {
          from: "teachers",
          localField: "teacher",
          foreignField: "_id",
          as: "teacherDetails",
        },
      },
      { $unwind: "$teacherDetails" },

      // Lookup Branch Name using the ID from the Teacher document
      {
        $lookup: {
          from: "branches",
          localField: "teacherDetails.campus",
          foreignField: "_id",
          as: "branchDetails",
        },
      },
      { $unwind: { path: "$branchDetails", preserveNullAndEmptyArrays: true } },

      // Group by Branch Name
      {
        $group: {
          _id: "$branchDetails._id",
          name: { $first: "$branchDetails.name" }, // Capture the name
          count: { $sum: 1 },
        },
      },

      // Project and sort
      {
        $project: {
          _id: 0,
          name: "$name", // Use 'name' for chart label
          count: "$count",
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json(analyticsData);
  } catch (error) {
    console.error("Error fetching assignment by branch:", error);
    res.status(500).json({ message: "Failed to fetch branch analysis." });
  }
};

module.exports = {
  getDashboardSummary,
  getTopResponsibleTeachers,
  getAssignmentAnalytics, // ✅ Export new function
  getRecentGrantedLeaves,
  getAssignmentByDutyType,
  getAssignmentByBranch,
};
