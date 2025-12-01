// controllers/reportController.js
const mongoose = require("mongoose");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const exceljs = require("exceljs");

// ----------------------------
// 1. GET REPORT DATA
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

      // ✅ FIX: Implement Strict Branch Filtering Logic in Aggregation
      if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
        // Match the branch ID against EITHER the new stored field OR the old teacher's campus field
        const branchObjectId = new mongoose.Types.ObjectId(branchId);

        pipeline.push({
          $match: {
            $or: [
              // 1. New data: Match directly on the assignment document
              { teacherCampus: branchObjectId },
              // 2. Old data: Match on the campus referenced in the teacherDetails
              { "teacherDetails.campus": branchObjectId },
            ],
          },
        });
      }

      // --- SUMMARY REPORTS: CAMPUS & CLASS ---

      if (reportType === "CAMPUS_SUMMARY") {
        pipeline.push(
          // Look up Branch Name directly using the stored teacherCampus field (or teacherDetails.campus for old data)
          {
            $lookup: {
              from: "branches",
              localField: {
                $ifNull: ["$teacherCampus", "$teacherDetails.campus"],
              }, // Use direct campus or teacher's campus
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
        // This path doesn't rely on campus filtering or lookup, but maintains the base teacher lookup

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

      // If reportType is DETAILED_ASSIGNMENT AND branchId was present, we continue the aggregation.

      pipeline.push(
        // Look up Branch Name
        {
          $lookup: {
            from: "branches",
            localField: {
              $ifNull: ["$teacherCampus", "$teacherDetails.campus"],
            }, // Use direct campus or teacher's campus
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
            ID: { $literal: 0 }, // Placeholder for frontend-generated ID
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

      // Add the sequential ID in the final step (since it was a placeholder above)
      const formatted = data.map((item, idx) => ({ ...item, ID: idx + 1 }));

      return res.json(formatted);
    } else {
      // --- Simple DETAILED_ASSIGNMENT (No branch filter, use efficient find().populate()) ---
      // filter only contains year/type/class filters (branchId is NOT present here)

      // NOTE: We only use the find().populate() path if NO branch filter is applied,
      // as the find() query logic is simpler and faster when not dealing with legacy data issues.

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
    return res.status(500).json({
      message:
        "An internal server error occurred during report generation. Check server logs.",
    });
  }
};

// ----------------------------
// 2. EXPORT TO EXCEL (Requires the core data function)
// ----------------------------
const exportToExcel = async (req, res) => {
  const { year, typeId, classId, reportType, branchId } = req.query;

  const pseudoReq = {
    query: { year, typeId, classId, reportType, branchId, status: "Assigned" },
  };
  const pseudoRes = {
    json: (data) => data,
    status: () => pseudoRes,
    send: () => {},
  };

  const data = await getReportData(pseudoReq, pseudoRes);

  if (!Array.isArray(data) || data.length === 0)
    return res.status(404).send({ message: "No data found to export." });

  try {
    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet("Responsibility Report");

    worksheet.columns = Object.keys(data[0]).map((key) => ({
      header: key.replace(/([A-Z])/g, " $1").trim(),
      key,
      width:
        key.includes("Responsibility") || key.includes("Teacher") ? 25 : 15,
    }));

    worksheet.addRows(data);

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "1E3A8A" },
      };
      cell.alignment = { horizontal: "center" };
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${reportType || "Detailed"}_Report_${
        year || "All"
      }.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).send({ message: "Excel export error: " + error.message });
  }
};

// ----------------------------
// 3. PDF DATA (Used for client-side PDF generation)
// ----------------------------
const getPDFDataForClient = async (req, res) => {
  const { year, typeId, classId, status, reportType, branchId } = req.query;

  const pseudoReq = {
    query: { year, typeId, classId, status, reportType, branchId },
  };
  const pseudoRes = {
    json: (data) => data,
    status: () => pseudoRes,
    send: () => {},
  };

  try {
    const data = await getReportData(pseudoReq, pseudoRes);
    return res.json(data);
  } catch (error) {
    console.error("PDF Fetch Error:", error);
    return res
      .status(500)
      .json({ message: "Error fetching PDF data: " + error.message });
  }
};

module.exports = {
  getReportData,
  exportToExcel,
  getPDFDataForClient,
};
