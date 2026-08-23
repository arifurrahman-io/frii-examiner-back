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

const isIncharge = (req) => req.user?.role === "incharge";

const getUserCampusId = (req) =>
  req.user?.campus?._id || req.user?.campus || null;

const requireInchargeCampus = (req) => {
  const campusId = getUserCampusId(req);
  if (isIncharge(req) && !campusId) {
    const error = new Error("No Campus/Shift is assigned to this incharge.");
    error.statusCode = 403;
    throw error;
  }
  if (campusId && !mongoose.Types.ObjectId.isValid(campusId)) {
    const error = new Error("Assigned Campus/Shift is invalid.");
    error.statusCode = 403;
    throw error;
  }
  return campusId;
};

const sendDashboardError = (res, error, fallbackMessage) => {
  res.status(error.statusCode || 500).json({
    message: error.message || fallbackMessage,
  });
};

const getScopedTeacherQuery = (req) => {
  if (!isIncharge(req)) return {};
  return { campus: requireInchargeCampus(req) };
};

const getScopedTeacherIds = async (req) => {
  if (!isIncharge(req)) return null;
  const teachers = await Teacher.find(getScopedTeacherQuery(req)).select("_id").lean();
  return teachers.map((teacher) => teacher._id);
};

const buildAssignmentPipelineStart = (req, targetYear) => {
  const pipeline = [
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
  ];

  if (isIncharge(req)) {
    const campusObjectId = new mongoose.Types.ObjectId(requireInchargeCampus(req));
    pipeline.push({
      $match: {
        $or: [
          { teacherCampus: campusObjectId },
          { "teacherDetails.campus": campusObjectId },
        ],
      },
    });
  }

  return pipeline;
};

const countScopedAssignments = async (req, targetYear) => {
  if (!isIncharge(req)) {
    return ResponsibilityAssignment.countDocuments({
      status: "Assigned",
      year: targetYear,
    });
  }

  const result = await ResponsibilityAssignment.aggregate([
    ...buildAssignmentPipelineStart(req, targetYear),
    { $count: "count" },
  ]);

  return result[0]?.count || 0;
};

// --- ১. ড্যাশবোর্ড সামারি (বছর ভিত্তিক) ---
const getDashboardSummary = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const scopedTeacherQuery = getScopedTeacherQuery(req);
    const scopedTeacherIds = await getScopedTeacherIds(req);
    const leaveQuery = { status: "Granted", year: targetYear };
    if (scopedTeacherIds) leaveQuery.teacher = { $in: scopedTeacherIds };

    const results = await Promise.all([
      isIncharge(req) ? Promise.resolve(1) : Branch.countDocuments(),
      Class.countDocuments(),
      Subject.countDocuments(),
      ResponsibilityType.countDocuments(),
      Teacher.countDocuments(scopedTeacherQuery),
      // শুধুমাত্র নির্দিষ্ট বছরের মঞ্জুরকৃত ছুটি
      Leave.countDocuments(leaveQuery),
      // শুধুমাত্র নির্দিষ্ট বছরের সক্রিয় দায়িত্ব
      countScopedAssignments(req, targetYear),
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
    sendDashboardError(res, error, "Failed to fetch dashboard summary.");
  }
};

// --- ২. টপ শিক্ষক তালিকা (বছর ভিত্তিক) ---
const getTopResponsibleTeachers = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const topTeachers = await ResponsibilityAssignment.aggregate([
      ...buildAssignmentPipelineStart(req, targetYear),
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
    sendDashboardError(res, error, "Failed to fetch top teachers list.");
  }
};

// --- ৩. ডিউটি টাইপ অনুযায়ী অ্যানালিটিক্স (বছর ভিত্তিক) ---
const getAssignmentByDutyType = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const analyticsData = await ResponsibilityAssignment.aggregate([
      ...buildAssignmentPipelineStart(req, targetYear),
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
    sendDashboardError(res, error, "Failed to fetch duty type analysis.");
  }
};

// --- ৪. ক্যাম্পাস ভিত্তিক অ্যানালিটিক্স (বছর ভিত্তিক) ---
const getAssignmentByBranch = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const analyticsData = await ResponsibilityAssignment.aggregate([
      ...buildAssignmentPipelineStart(req, targetYear),
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
    sendDashboardError(res, error, "Failed to fetch branch analysis.");
  }
};

// --- ৫. সাম্প্রতিক মঞ্জুরকৃত ছুটি (বছর ভিত্তিক) ---
const getRecentGrantedLeaves = async (req, res) => {
  const targetYear = getSelectedYear(req);
  try {
    const scopedTeacherIds = await getScopedTeacherIds(req);
    const query = { status: "Granted", year: targetYear };
    if (scopedTeacherIds) query.teacher = { $in: scopedTeacherIds };

    const leaves = await Leave.find(query)
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
    sendDashboardError(res, error, "Failed to fetch recent leaves.");
  }
};

module.exports = {
  getDashboardSummary,
  getTopResponsibleTeachers,
  getRecentGrantedLeaves,
  getAssignmentByDutyType,
  getAssignmentByBranch,
};
