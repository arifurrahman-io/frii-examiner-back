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

    // FIX 1: Explicitly cast typeId to ObjectId if valid
    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
      filter.responsibilityType = new mongoose.Types.ObjectId(typeId);
    }
    // FIX 1: Explicitly cast classId to ObjectId if valid
    if (classId && mongoose.Types.ObjectId.isValid(classId)) {
      filter.targetClass = new mongoose.Types.ObjectId(classId);
    }

    if (status) filter.status = status;
    if (!status) filter.status = { $ne: "Cancelled" };

    // Decide if we need aggregation
    const useAggregation = reportType !== "DETAILED_ASSIGNMENT" || branchId;

    if (useAggregation) {
      let pipeline = [{ $match: filter }];

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

      // Branch filter
      if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
        pipeline.push({
          $match: {
            "teacherDetails.campus": new mongoose.Types.ObjectId(branchId),
          },
        });
      }

      if (reportType === "CAMPUS_SUMMARY") {
        pipeline.push(
          {
            $lookup: {
              from: "branches",
              localField: "teacherDetails.campus",
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
            $group: {
              _id: {
                branch: { $ifNull: ["$branchDetails.name", "N/A"] },
                type: "$responsibilityType",
              },
              totalAssignments: { $sum: 1 },
            },
          },
          {
            $lookup: {
              from: "responsibilitytypes",
              localField: "_id.type",
              foreignField: "_id",
              as: "typeDetails",
            },
          },
          { $unwind: "$typeDetails" },
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
        pipeline.push(
          {
            $lookup: {
              from: "classes",
              localField: "targetClass",
              foreignField: "_id",
              as: "classDetails",
            },
          },
          {
            $unwind: {
              path: "$classDetails",
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
                class: { $ifNull: ["$classDetails.name", "N/A"] },
                type: "$responsibilityType",
              },
              totalAssignments: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              Class: "$_id.class",
              ResponsibilityType: "$typeDetails.name",
              TotalAssignments: "$totalAssignments",
            },
          },
          { $sort: { Class: 1, ResponsibilityType: 1 } }
        );

        const data = await ResponsibilityAssignment.aggregate(pipeline);
        return res.json(data);
      }

      // DETAILED_ASSIGNMENT with branch filter
      const assignmentIdsAgg = await ResponsibilityAssignment.aggregate([
        ...pipeline,
        { $project: { _id: 1 } },
      ]);
      const ids = assignmentIdsAgg.map((a) => a._id);

      const assignments = await ResponsibilityAssignment.find({
        _id: { $in: ids },
      })
        .populate({
          path: "teacher",
          select: "name teacherId campus",
          populate: { path: "campus", select: "name" },
        })
        .populate("responsibilityType", "name")
        .populate("targetClass", "name")
        .populate("targetSubject", "name")
        .sort({ "targetClass.level": 1, "teacher.name": 1 });

      const formatted = assignments.map((a, idx) => ({
        ID: idx + 1,
        TeacherName: a.teacher.name,
        TeacherID: a.teacher.teacherId,
        Campus: a.teacher.campus ? a.teacher.campus.name : "N/A",
        ResponsibilityType: a.responsibilityType.name,
        Year: a.year,
        Class: a.targetClass ? a.targetClass.name : "N/A",
        Subject: a.targetSubject ? a.targetSubject.name : "N/A",
      }));

      return res.json(formatted);
    } else {
      // Simple DETAILED_ASSIGNMENT without branch filter
      const assignments = await ResponsibilityAssignment.find(filter)
        .populate({
          path: "teacher",
          select: "name teacherId campus",
          populate: { path: "campus", select: "name" },
        })
        .populate("responsibilityType", "name")
        .populate("targetClass", "name")
        .populate("targetSubject", "name")
        .sort({ "targetClass.level": 1, "teacher.name": 1 });

      const formatted = assignments.map((a, idx) => ({
        ID: idx + 1,
        TeacherName: a.teacher.name,
        TeacherID: a.teacher.teacherId,
        Campus: a.teacher.campus ? a.teacher.campus.name : "N/A",
        ResponsibilityType: a.responsibilityType.name,
        Year: a.year,
        Class: a.targetClass ? a.targetClass.name : "N/A",
        Subject: a.targetSubject ? a.targetSubject.name : "N/A",
      }));

      return res.json(formatted);
    }
  } catch (error) {
    console.error("Error fetching report:", error);
    return res.status(500).json({ message: error.message });
  }
};

// ----------------------------
// 2. EXPORT TO EXCEL
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
// 3. PDF DATA
// ----------------------------
const getPDFDataForClient = async (req, res) => {
  try {
    // FIX 2: Corrected parameter name from 'campusId' to 'branchId' to match frontend/convention
    const { year, typeId, classId, status, branchId } = req.query;

    // Base filter for ResponsibilityAssignment
    let matchQuery = {};
    if (year) matchQuery.year = parseInt(year);

    // FIX 3: Explicitly cast typeId and classId to ObjectId if valid
    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
      matchQuery.responsibilityType = new mongoose.Types.ObjectId(typeId);
    }
    if (classId && mongoose.Types.ObjectId.isValid(classId)) {
      matchQuery.targetClass = new mongoose.Types.ObjectId(classId);
    }

    if (status) matchQuery.status = status;
    if (!matchQuery.status) matchQuery.status = { $ne: "Cancelled" };

    // Start pipeline
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

    // --- Apply campus filter immediately after teacher lookup ---
    // FIX 4: Use branchId for matching and ensure casting
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      pipeline.push({
        $match: {
          "teacherDetails.campus": new mongoose.Types.ObjectId(branchId),
        },
      });
    }

    // Lookup campus/branch name
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

    // Final projection for PDF
    pipeline.push({
      $project: {
        _id: 1,
        Teacher: "$teacherDetails.name",
        Campus: { $ifNull: ["$branchDetails.name", "N/A"] },
        "Responsibility Type": "$typeDetails.name",
        Year: "$year",
        Class: { $ifNull: ["$classDetails.name", "N/A"] },
        Subject: { $ifNull: ["$subjectDetails.name", "N/A"] },
        Status: "$status",
      },
    });

    // Sort by class and teacher
    pipeline.push({ $sort: { Class: 1, Teacher: 1 } });

    // Execute
    const pdfData = await ResponsibilityAssignment.aggregate(pipeline);

    return res.json(pdfData);
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
