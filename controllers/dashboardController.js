const Teacher = require("../models/TeacherModel");
const Class = require("../models/ClassModel");
const Branch = require("../models/BranchModel");
const Subject = require("../models/SubjectModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const Leave = require("../models/LeaveModel");
const mongoose = require("mongoose");

/**
 * 🛠️ হেল্পার ফাংশন: বর্তমান বছর বা রিকোয়েস্ট করা বছর বের করা
 */
const getSelectedYear = (req) => {
  return req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
};

// --- ১. ড্যাশবোর্ড সামারি (বছর ভিত্তিক) ---
const getDashboardSummary = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const results = await Promise.all([
      Branch.countDocuments(),
      Class.countDocuments(),
      Subject.countDocuments(),
      ResponsibilityType.countDocuments(),
      Teacher.countDocuments(),
      // শুধুমাত্র নির্দিষ্ট বছরের মঞ্জুরকৃত ছুটি
      Leave.countDocuments({ status: "Granted", year: targetYear }),
      // শুধুমাত্র নির্দিষ্ট বছরের সক্রিয় দায়িত্ব
      ResponsibilityAssignment.countDocuments({
        status: "Assigned",
        year: targetYear,
      }),
    ]);

    res.json({
      totalBranches: results[0],
      totalClasses: results[1],
      totalSubjects: results[2],
      totalResponsibilityTypes: results[3],
      totalTeachers: results[4],
      totalGrantedLeaves: results[5],
      totalResponsibilities: results[6],
      activeSession: targetYear,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch dashboard summary." });
  }
};

// --- ২. টপ শিক্ষক তালিকা (বছর ভিত্তিক) ---
const getTopResponsibleTeachers = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const topTeachers = await ResponsibilityAssignment.aggregate([
      { $match: { status: "Assigned", year: targetYear } },
      { $group: { _id: "$teacher", totalDuties: { $sum: 1 } } },
      { $sort: { totalDuties: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "teachers",
          localField: "_id",
          foreignField: "_id",
          as: "teacherDetails",
        },
      },
      { $unwind: "$teacherDetails" },
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
    res.status(500).json({ message: "Failed to fetch top teachers list." });
  }
};

// --- ৩. ডিউটি টাইপ অনুযায়ী অ্যানালিটিক্স (বছর ভিত্তিক) ---
const getAssignmentByDutyType = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const analyticsData = await ResponsibilityAssignment.aggregate([
      { $match: { status: "Assigned", year: targetYear } },
      {
        $lookup: {
          from: "responsibilitytypes",
          localField: "responsibilityType",
          foreignField: "_id",
          as: "typeDetails",
        },
      },
      { $unwind: "$typeDetails" },
      {
        $group: {
          _id: "$responsibilityType",
          name: { $first: "$typeDetails.name" },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, name: "$name", count: "$count" } },
      { $sort: { count: -1 } },
    ]);
    res.json(analyticsData);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch duty type analysis." });
  }
};

// --- ৪. ক্যাম্পাস ভিত্তিক অ্যানালিটিক্স (বছর ভিত্তিক) ---
const getAssignmentByBranch = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const analyticsData = await ResponsibilityAssignment.aggregate([
      { $match: { status: "Assigned", year: targetYear } },
      {
        $lookup: {
          from: "teachers",
          localField: "teacher",
          foreignField: "_id",
          as: "teacherDetails",
        },
      },
      { $unwind: "$teacherDetails" },
      {
        $lookup: {
          from: "branches",
          localField: "teacherDetails.campus",
          foreignField: "_id",
          as: "branchDetails",
        },
      },
      { $unwind: "$branchDetails" },
      {
        $group: {
          _id: "$branchDetails._id",
          name: { $first: "$branchDetails.name" },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, name: "$name", count: "$count" } },
      { $sort: { count: -1 } },
    ]);
    res.json(analyticsData);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch branch analysis." });
  }
};

// --- ৫. সাম্প্রতিক মঞ্জুরকৃত ছুটি (বছর ভিত্তিক) ---
const getRecentGrantedLeaves = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const leaves = await Leave.find({ status: "Granted", year: targetYear })
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
    res.status(500).json({ message: "Failed to fetch recent leaves." });
  }
};

module.exports = {
  getDashboardSummary,
  getTopResponsibleTeachers,
  getRecentGrantedLeaves,
  getAssignmentByDutyType,
  getAssignmentByBranch,
};
