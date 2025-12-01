// arifurrahman-io/frii-examiner-back/frii-examiner-back-aa5325b910a695d44cb8fa1be2371493fec60e67/controllers/reportController.js

const mongoose = require("mongoose");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
// Removed: exceljs import as it's no longer used

// ----------------------------
// 1. GET REPORT DATA (Data Filtering Core Logic)
// ----------------------------
const getReportData = async (req, res) => {
  try {
    const { year, typeId, classId, status, reportType, branchId } = req.query;

    // Base filter
    let filter = {};
    if (year) filter.year = parseInt(year);

    // Explicitly cast typeId, classId to ObjectId if valid (used in base filter for all queries)
    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
      filter.responsibilityType = new mongoose.Types.ObjectId(typeId);
    }
    // Added safety check for ObjectId validity
    if (classId && mongoose.Types.ObjectId.isValid(classId)) {
      filter.targetClass = new mongoose.Types.ObjectId(classId);
    }

    if (status) filter.status = status;
    if (!status) filter.status = { $ne: "Cancelled" };

    // Aggregation is required if it's a summary OR if we need to filter by BranchID (due to legacy data issues)
    const requiresAggregation =
      reportType !== "DETAILED_ASSIGNMENT" ||
      (branchId && mongoose.Types.ObjectId.isValid(branchId));

    if (requiresAggregation) {
      let pipeline = [{ $match: filter }];

      // Look up Teacher details (required for name/ID and legacy campus lookup)
      pipeline.push({
        $lookup: {
          from: "teachers",
          localField: "teacher",
          foreignField: "_id",
          as: "teacherDetails",
        },
      });
      pipeline.push({
        $unwind: { path: "$teacherDetails", preserveNullAndEmptyArrays: false },
      });

      // Implement Strict Branch Filtering Logic in Aggregation
      if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
        const branchObjectId = new mongoose.Types.ObjectId(branchId);

        pipeline.push({
          $match: {
            $or: [
              { teacherCampus: branchObjectId },
              { "teacherDetails.campus": branchObjectId },
            ],
          },
        });
      }

      // --- SUMMARY REPORTS: CAMPUS & CLASS ---

      if (reportType === "CAMPUS_SUMMARY") {
        pipeline.push(
          // FIX: Add a new field 'effectiveCampus' using $ifNull
          {
            $addFields: {
              effectiveCampus: {
                $ifNull: ["$teacherCampus", "$teacherDetails.campus"],
              },
            },
          },
          // FIX: Look up Branch Name using the new 'effectiveCampus' field
          {
            $lookup: {
              from: "branches",
              localField: "effectiveCampus",
              foreignField: "_id",
              as: "branchDetails",
            },
          },
          {
            $unwind: {
              path: "$branchDetails",
              preserveNullAndEmptyArrays: true,
            },
          },
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
              _id: {
                branch: { $ifNull: ["$branchDetails.name", "N/A"] },
                type: "$responsibilityType",
              },
              totalAssignments: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              Branch: "$_id.branch",
              ResponsibilityType: "$typeDetails.name",
              TotalAssignments: "$totalAssignments",
            },
          },
          { $sort: { Branch: 1, ResponsibilityType: 1 } }
        );

        const data = await ResponsibilityAssignment.aggregate(pipeline);
        return res.json(data);
      }

      if (reportType === "CLASS_SUMMARY") {
        // Look up Class details
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

        // Look up Responsibility Type details
        pipeline.push({
          $lookup: {
            from: "responsibilitytypes",
            localField: "responsibilityType",
            foreignField: "_id",
            as: "typeDetails",
          },
        });
        pipeline.push({ $unwind: "$typeDetails" });

        // Grouping
        pipeline.push({
          $group: {
            _id: {
              class: { $ifNull: ["$classDetails.name", "N/A"] },
              type: "$responsibilityType",
            },
            totalAssignments: { $sum: 1 },
          },
        });

        // Projection and Sort
        pipeline.push({
          $project: {
            _id: 0,
            Class: "$_id.class",
            ResponsibilityType: "$typeDetails.name",
            TotalAssignments: "$totalAssignments",
          },
        });
        pipeline.push({ $sort: { Class: 1, ResponsibilityType: 1 } });

        const data = await ResponsibilityAssignment.aggregate(pipeline);
        return res.json(data);
      }

      // --- DETAILED ASSIGNMENT LIST (Forced Aggregation Path) ---
      pipeline.push(
        // FIX: Apply the same $addFields transformation for the Detailed Report
        {
          $addFields: {
            effectiveCampus: {
              $ifNull: ["$teacherCampus", "$teacherDetails.campus"],
            },
          },
        },
        // FIX: Look up Branch Name using the new 'effectiveCampus' field
        {
          $lookup: {
            from: "branches",
            localField: "effectiveCampus",
            foreignField: "_id",
            as: "branchDetails",
          },
        },
        {
          $unwind: { path: "$branchDetails", preserveNullAndEmptyArrays: true },
        },
        // Look up Responsibility Type
        {
          $lookup: {
            from: "responsibilitytypes",
            localField: "responsibilityType",
            foreignField: "_id",
            as: "typeDetails",
          },
        },
        { $unwind: "$typeDetails" },
        // Look up Class
        {
          $lookup: {
            from: "classes",
            localField: "targetClass",
            foreignField: "_id",
            as: "classDetails",
          },
        },
        {
          $unwind: { path: "$classDetails", preserveNullAndEmptyArrays: true },
        },
        // Look up Subject
        {
          $lookup: {
            from: "subjects",
            localField: "targetSubject",
            foreignField: "_id",
            as: "subjectDetails",
          },
        },
        {
          $unwind: {
            path: "$subjectDetails",
            preserveNullAndEmptyArrays: true,
          },
        },

        // Final Projection to match the find().populate() output keys
        {
          $project: {
            ID: { $literal: 0 },
            TEACHER: "$teacherDetails.name",
            CAMPUS: { $ifNull: ["$branchDetails.name", "N/A"] },
            RESPONSIBILITY_TYPE: "$typeDetails.name",
            YEAR: "$year",
            CLASS: { $ifNull: ["$classDetails.name", "N/A"] },
            SUBJECT: { $ifNull: ["$subjectDetails.name", "N/A"] },
            STATUS: "$status",
            _ID: "$_id",
            TEACHERID: "$teacherDetails.teacherId",
            "CREATED AT": "$createdAt",
            "UPDATED AT": "$updatedAt",
          },
        },
        { $sort: { CLASS: 1, TEACHER: 1 } }
      );

      const data = await ResponsibilityAssignment.aggregate(pipeline);

      const formatted = data.map((item, idx) => ({ ...item, ID: idx + 1 }));

      return res.json(formatted);
    } else {
      // --- Simple DETAILED_ASSIGNMENT (No branch filter, use efficient find().populate()) ---

      const assignments = await ResponsibilityAssignment.find(filter)
        .populate("teacher", "name teacherId")
        .populate("teacherCampus", "name")
        .populate("responsibilityType", "name")
        .populate("targetClass", "name")
        .populate("targetSubject", "name")
        .sort({ "targetClass.level": 1, "teacher.name": 1 });

      const formatted = assignments.map((a, idx) => ({
        ID: idx + 1,
        TEACHER: a.teacher ? a.teacher.name : "N/A",
        CAMPUS: a.teacherCampus ? a.teacherCampus.name : "N/A",
        RESPONSIBILITY_TYPE: a.responsibilityType
          ? a.responsibilityType.name
          : "N/A",
        YEAR: a.year,
        CLASS: a.targetClass ? a.targetClass.name : "N/A",
        SUBJECT: a.targetSubject ? a.targetSubject.name : "N/A",
        STATUS: a.status,
        _ID: a._id,
        TEACHERID: a.teacher ? a.teacher.teacherId : "N/A",
      }));

      return res.json(formatted);
    }
  } catch (error) {
    console.error("CRITICAL REPORT FETCH ERROR:", error);
    // Returning a clearer message to the frontend when a hard failure occurs
    return res.status(500).json({
      message:
        "An internal server error occurred during report data retrieval. Please check the server logs for the full stack trace.",
    });
  }
};

module.exports = {
  getReportData,
};
