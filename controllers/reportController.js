// controllers/reportController.js
const mongoose = require("mongoose");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");

// Ensure Teacher model exists
const Teacher = require("../models/TeacherModel"); // adjust path if needed

const ArrayOfData = (data) => Array.isArray(data) && data.length > 0;

// Responsibility type labels expected in yearly pivot (must match responsibility-types.name)
const RESPONSIBILITY_TYPES = [
  "Q-HY",
  "E-HY",
  "Q-Pre-Test",
  "E-Pre-Test",
  "Q-Annual",
  "E-Annual",
  "Q-Test",
  "E-Test",
];

// ----------------------------
// helper: safely convert to ObjectId if string looks like one
// ----------------------------
const maybeObjectId = (val) => {
  if (!val) return null;
  try {
    if (mongoose.Types.ObjectId.isValid(val))
      return new mongoose.Types.ObjectId(val);
  } catch (e) {
    // ignore
  }
  return null;
};

// ----------------------------
// 1️⃣ GET REPORT DATA (Detailed/Summary Reports)
// ----------------------------
const getReportData = async (req, res) => {
  try {
    const {
      year,
      typeId,
      classId,
      status,
      reportType,
      branchId, // note: frontend sends branchId
      subjectId,
    } = req.query;

    const filter = {};

    if (year) filter.year = parseInt(year, 10);

    // Accept ObjectId filters if provided
    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
      filter.responsibilityType = new mongoose.Types.ObjectId(typeId);
    }

    if (classId && mongoose.Types.ObjectId.isValid(classId)) {
      filter.targetClass = new mongoose.Types.ObjectId(classId);
    }

    if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
      filter.targetSubject = new mongoose.Types.ObjectId(subjectId);
    }

    if (status) filter.status = status;
    if (!status) filter.status = { $ne: "Cancelled" };

    const requiresAggregation =
      reportType !== "DETAILED_ASSIGNMENT" ||
      (branchId && mongoose.Types.ObjectId.isValid(branchId));

    if (requiresAggregation) {
      const pipeline = [{ $match: filter }];

      // join teacher details
      pipeline.push({
        $lookup: {
          from: "teachers",
          localField: "teacher",
          foreignField: "_id",
          as: "teacherDetails",
        },
      });
      pipeline.push({
        $unwind: { path: "$teacherDetails", preserveNullAndEmptyArrays: true },
      });

      // If branchId filter present, filter by either assignment.teacherCampus or teacherDetails.campus
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

      // Common lookups for branch/class/type/subject
      pipeline.push(
        {
          $addFields: {
            effectiveCampus: {
              $ifNull: ["$teacherCampus", "$teacherDetails.campus"],
            },
          },
        },
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
        {
          $lookup: {
            from: "responsibilitytypes",
            localField: "responsibilityType",
            foreignField: "_id",
            as: "typeDetails",
          },
        },
        { $unwind: { path: "$typeDetails", preserveNullAndEmptyArrays: true } },
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
        }
      );

      // Different projections depending on reportType
      if (reportType === "CAMPUS_SUMMARY") {
        pipeline.push(
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

        const data = await ResponsibilityAssignment.aggregate(
          pipeline
        ).allowDiskUse(true);
        return res.json(data);
      }

      if (reportType === "CLASS_SUMMARY") {
        pipeline.push(
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

        const data = await ResponsibilityAssignment.aggregate(
          pipeline
        ).allowDiskUse(true);
        return res.json(data);
      }

      // Default: detailed assignment aggregation that flattens important fields
      pipeline.push({
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
      });
      pipeline.push({ $sort: { CLASS: 1, TEACHER: 1 } });

      const data = await ResponsibilityAssignment.aggregate(
        pipeline
      ).allowDiskUse(true);
      const formatted = data.map((item, idx) => ({ ...item, ID: idx + 1 }));
      return res.json(formatted);
    } else {
      // Simple find path (no aggregation)
      const assignments = await ResponsibilityAssignment.find(filter)
        .populate("teacher", "name teacherId campus")
        .populate("teacherCampus", "name")
        .populate("responsibilityType", "name")
        .populate("targetClass", "name level")
        .populate("targetSubject", "name")
        .sort({ "targetClass.level": 1, "teacher.name": 1 });

      const formatted = assignments.map((a, idx) => ({
        ID: idx + 1,
        TEACHER: a.teacher?.name || "N/A",
        CAMPUS: a.teacherCampus?.name || a.teacher?.campus?.toString() || "N/A",
        RESPONSIBILITY_TYPE: a.responsibilityType?.name || "N/A",
        YEAR: a.year,
        CLASS: a.targetClass?.name || "N/A",
        SUBJECT: a.targetSubject?.name || "N/A",
        STATUS: a.status,
        _ID: a._id,
        TEACHERID: a.teacher?.teacherId || "N/A",
      }));

      return res.json(formatted);
    }
  } catch (error) {
    console.error("CRITICAL REPORT FETCH ERROR:", error);
    return res.status(500).json({
      message:
        "An internal server error occurred during report data retrieval. Please check the server logs for the full stack trace.",
    });
  }
};

// ----------------------------
// helper: fetchYearlyReportData updated to use typeDetails.name and proper ObjectId handling
// ----------------------------
const fetchYearlyReportData = async (
  currentYear,
  previousYear,
  branchIdRaw
) => {
  try {
    const branchObjectId = maybeObjectId(branchIdRaw);
    const initialMatchFilter = {
      $or: [{ year: currentYear }, { year: previousYear }],
      status: { $ne: "Cancelled" },
    };

    const pipeline = [
      { $match: initialMatchFilter },
      // Lookup teacher details so we can filter on teacher.campus
      {
        $lookup: {
          from: "teachers",
          localField: "teacher",
          foreignField: "_id",
          as: "teacherDetails",
        },
      },
      {
        $unwind: { path: "$teacherDetails", preserveNullAndEmptyArrays: true },
      },
      // If branchId filter present - apply it now using teacherDetails.campus or teacherCampus
      ...(branchObjectId
        ? [
            {
              $match: {
                $or: [
                  { teacherCampus: branchObjectId },
                  { "teacherDetails.campus": branchObjectId },
                ],
              },
            },
          ]
        : []),
      // Lookup type details (we'll use typeDetails.name)
      {
        $lookup: {
          from: "responsibilitytypes",
          localField: "responsibilityType",
          foreignField: "_id",
          as: "typeDetails",
        },
      },
      { $unwind: { path: "$typeDetails", preserveNullAndEmptyArrays: true } },

      // Filter out records without a type name (defensive)
      { $match: { "typeDetails.name": { $ne: null } } },

      // other lookups
      {
        $lookup: {
          from: "subjects",
          localField: "targetSubject",
          foreignField: "_id",
          as: "subjectDetails",
        },
      },
      {
        $unwind: { path: "$subjectDetails", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "classes",
          localField: "targetClass",
          foreignField: "_id",
          as: "classDetails",
        },
      },
      { $unwind: { path: "$classDetails", preserveNullAndEmptyArrays: true } },

      // assembly of a display string for each assignment
      {
        $addFields: {
          assignmentDetail: {
            $concat: [
              { $ifNull: ["$subjectDetails.name", "Sub-N/A"] },
              "-",
              { $ifNull: ["$classDetails.name", "Class-N/A"] },
            ],
          },
          typeName: "$typeDetails.name", // e.g., "Q-HY"
          teacherName: "$teacherDetails.name",
          teacherCampus: {
            $ifNull: ["$teacherCampus", "$teacherDetails.campus"],
          },
        },
      },

      // Group by teacher/year/typeName to combine multiple assignmentDetail into an array
      {
        $group: {
          _id: {
            teacherId: "$teacherDetails._id",
            year: "$year",
            typeName: "$typeName",
            teacherName: "$teacherName",
            campus: "$teacherCampus",
          },
          detailArray: { $push: "$assignmentDetail" },
        },
      },

      // Group by teacher+year to build array of { k: typeName, v: detailArray }
      {
        $group: {
          _id: {
            teacherId: "$_id.teacherId",
            teacherName: "$_id.teacherName",
            campus: "$_id.campus",
            year: "$_id.year",
          },
          assignmentsByType: {
            $push: {
              k: "$_id.typeName",
              v: "$detailArray",
            },
          },
        },
      },

      // Group by teacher to get an array of yearly assignments (each has year + assignments object)
      {
        $group: {
          _id: "$_id.teacherId",
          teacherName: { $first: "$_id.teacherName" },
          campus: { $first: "$_id.campus" },
          yearlyAssignments: {
            $push: {
              year: "$_id.year",
              assignments: { $arrayToObject: "$assignmentsByType" },
            },
          },
        },
      },
      {
        $sort: { teacherName: 1 },
      },
    ];

    let results = await ResponsibilityAssignment.aggregate(
      pipeline
    ).allowDiskUse(true);

    // Lookup branch names for campus ids found
    const branchIds = [
      ...new Set(results.map((r) => r.campus).filter((id) => id)),
    ];
    const BranchModel =
      mongoose.models.Branch ||
      mongoose.model(
        "Branch",
        new mongoose.Schema({ name: String }),
        "branches"
      );

    const campuses = branchIds.length
      ? await BranchModel.find({ _id: { $in: branchIds } })
          .select("name")
          .lean()
      : [];
    const campusMap = new Map(campuses.map((c) => [c._id.toString(), c.name]));

    // Attach campusName
    results = results.map((r) => ({
      ...r,
      campusName: campusMap.get(String(r.campus)) || "N/A",
    }));

    return results;
  } catch (error) {
    console.error("Aggregation Failed:", error);
    throw error;
  }
};

// ----------------------------
// 2️⃣ YEARLY REPORT PDF (Modern jsPDF + autoTable Implementation)
// ----------------------------
const exportCampusWiseYearlyPDF = async (req, res) => {
  const { year, branchId } = req.query;
  if (!year) return res.status(400).json({ message: "Year is required." });

  const currentYear = parseInt(year, 10);
  const previousYear = currentYear - 1;

  try {
    const aggregatedData = await fetchYearlyReportData(
      currentYear,
      previousYear,
      branchId
    );

    if (!ArrayOfData(aggregatedData)) {
      return res
        .status(404)
        .json({ message: "No dynamic data found to export." });
    }

    // Build flatReport rows (two rows per teacher: current year + previous year)
    const flatReport = [];
    let serial = 1;

    for (const teacherResult of aggregatedData) {
      const assignmentData = {};
      if (Array.isArray(teacherResult.yearlyAssignments)) {
        teacherResult.yearlyAssignments.forEach((ya) => {
          assignmentData[ya.year] = ya.assignments || {};
        });
      }

      const currentYearRow = {
        SL: serial,
        Campus: teacherResult.campusName || "N/A",
        Teacher: teacherResult.teacherName || "N/A",
        Year: currentYear,
      };

      const previousYearRow = {
        SL: "",
        Campus: "",
        Teacher: "",
        Year: previousYear,
      };

      for (const type of RESPONSIBILITY_TYPES) {
        const currentAssignments = assignmentData[currentYear]?.[type];
        const previousAssignments = assignmentData[previousYear]?.[type];

        currentYearRow[type] = Array.isArray(currentAssignments)
          ? currentAssignments.join(" | ")
          : "-";
        previousYearRow[type] = Array.isArray(previousAssignments)
          ? previousAssignments.join(" | ")
          : "-";
      }

      flatReport.push(currentYearRow, previousYearRow);
      serial++;
    }

    if (!ArrayOfData(flatReport)) {
      return res
        .status(404)
        .json({ message: "No dynamic data found to export." });
    }

    // Prepare head (column names)
    const head = [
      ["Sl", "Campus", "Teacher's Name", "Year", ...RESPONSIBILITY_TYPES],
    ];

    // Prepare body rows (only numbers in Year)
    const body = flatReport.map((r) => [
      r.SL,
      r.Campus,
      r.Teacher,
      r.Year,
      ...RESPONSIBILITY_TYPES.map((t) => r[t] || "-"),
    ]);

    // Create PDF with autoTable for consistent layout/padding
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "l" });

    // Document metadata and title
    doc.setProperties({ title: `Yearly Assignment Report ${currentYear}` });
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setTextColor(40);
    doc.text("Yearly Report", pageWidth / 2, 30, { align: "center" });

    // Define theme/spacing
    const margin = { top: 50, right: 18, bottom: 40, left: 18 };
    const styles = {
      fontSize: 9,
      cellPadding: { top: 6, right: 6, bottom: 6, left: 6 }, // horizontal + vertical padding
      overflow: "linebreak",
      valign: "middle",
      halign: "left",
      textColor: 30,
      lineColor: [200, 200, 200],
      lineWidth: 0.3,
    };

    const headStyles = {
      fillColor: [245, 205, 121], // soft yellow
      textColor: 20,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      fontSize: 10,
    };

    // Column widths: compress SL and Campus
    // We'll set columnStyles by index
    const columnStyles = {
      0: { cellWidth: 28 }, // Sl.
      1: { cellWidth: 70 }, // Campus
      2: { cellWidth: 100 }, // Teacher's name
      3: { cellWidth: 35 }, // Year
    };

    // For responsibility columns, assign uniform smaller widths
    const respWidth = 72;
    for (let i = 0; i < RESPONSIBILITY_TYPES.length; i++) {
      columnStyles[4 + i] = { cellWidth: respWidth };
    }

    // Add autoTable
    doc.autoTable({
      startY: margin.top,
      head,
      body,
      styles,
      headStyles,
      columnStyles,
      theme: "grid",
      margin,
      didDrawPage: (data) => {
        // Footer: page number and generated date
        const pageCount = doc.internal.getNumberOfPages();
        const page = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setTextColor(120);
        const footerText = `Generated on: ${new Date().toLocaleDateString(
          "en-GB"
        )}`;
        doc.text(
          footerText,
          margin.left,
          doc.internal.pageSize.getHeight() - 18
        );
        doc.text(
          `Page ${page} of ${pageCount}`,
          doc.internal.pageSize.getWidth() - margin.right,
          doc.internal.pageSize.getHeight() - 18,
          { align: "right" }
        );
      },
      // optional: alternate row background for readability (zebra)
      didParseCell: function (data) {
        if (data.section === "body") {
          // every two rows belong to a teacher block; data.row.index starts at 0
          const blockIndex = Math.floor(data.row.index / 2);
          if (blockIndex % 2 === 1) {
            data.cell.styles.fillColor = [250, 250, 250]; // very light gray
          }
        }
      },
      // Ensure long text wraps inside a cell
      bodyStyles: { valign: "top" },
    });

    // Send PDF
    const pdfBuffer = doc.output("arraybuffer");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=Yearly_Assignment_Report_${currentYear}.pdf`
    );
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    return res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error("Yearly PDF Export Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Yearly export failed." });
  }
};

// ----------------------------
// 3️⃣ EXPORT CUSTOM PDF REPORT (jsPDF Implementation w/ sorting, modernized)
// ----------------------------
const exportCustomReportToPDF = async (req, res) => {
  const { year, typeId } = req.query;

  try {
    // Resolve responsibility type display name
    let responsibilityName = "N/A";
    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
      const responsibilityType = await ResponsibilityType.findById(
        typeId
      ).select("name");
      responsibilityName = responsibilityType
        ? responsibilityType.name
        : typeId;
    } else if (typeId) {
      responsibilityName = typeId;
    }

    let reportTitle = "Examiners' List";
    const questionSetterPrefixes = ["Q-HY", "Q-Pre-Test", "Q-Annual", "Q-Test"];
    if (
      questionSetterPrefixes.some((prefix) =>
        responsibilityName.toUpperCase().startsWith(prefix.toUpperCase())
      )
    ) {
      reportTitle = "Question Setters' List";
    }

    const now = new Date();
    const datePart = now.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const timePart = now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const footerText = `The report generated by FRII Exam Management Software | ${datePart} | ${timePart}`;

    // Reuse getReportData path (simulate request)
    const pseudoReq = {
      query: {
        ...req.query,
        reportType: "DETAILED_ASSIGNMENT",
        status: "Assigned",
      },
    };

    let rawData = [];
    const pseudoRes = {
      json: (data) => {
        rawData = data;
        return data;
      },
      status: (code) => pseudoRes,
      send: () => {},
    };
    await getReportData(pseudoReq, pseudoRes);

    if (!ArrayOfData(rawData))
      return res.status(404).json({ message: "No data found to export." });

    // Sorting arrays (class & subject)
    const CLASS_ORDER = [
      "ONE",
      "TWO",
      "THREE",
      "FOUR",
      "FIVE",
      "SIX",
      "SEVEN",
      "EIGHT",
      "NINE",
      "TEN",
    ];
    const SUBJECT_ORDER = [
      "BANGLA",
      "BANGLA-I",
      "BANGLA-II",
      "ENGLISH",
      "ENGLISH-I",
      "ENGLISH-II",
      "MATHEMATICS",
      "R.EDN",
      "BGS",
      "PHYSICS",
      "CHEMISTRY",
      "BIOLOGY",
      "H.MATH",
      "ACCOUNTING",
      "B.ENT",
      "FINANCE & BANKING",
      "SCIENCE",
      "ICT",
      "H.SCIENCE",
      "AGRICULTURE",
    ];

    rawData.sort((a, b) => {
      const aClass = (a.CLASS || "").toString().trim().toUpperCase();
      const bClass = (b.CLASS || "").toString().trim().toUpperCase();
      const aClassIndex = CLASS_ORDER.indexOf(aClass);
      const bClassIndex = CLASS_ORDER.indexOf(bClass);
      if (aClassIndex !== bClassIndex)
        return (
          (aClassIndex === -1 ? 999 : aClassIndex) -
          (bClassIndex === -1 ? 999 : bClassIndex)
        );

      const aSub = (a.SUBJECT || "").toString().trim().toUpperCase();
      const bSub = (b.SUBJECT || "").toString().trim().toUpperCase();
      const aSubIndex = SUBJECT_ORDER.indexOf(aSub);
      const bSubIndex = SUBJECT_ORDER.indexOf(bSub);
      if (aSubIndex !== bSubIndex)
        return (
          (aSubIndex === -1 ? 999 : aSubIndex) -
          (bSubIndex === -1 ? 999 : bSubIndex)
        );

      const aTeacher = (a.TEACHER || "").toString().trim().toUpperCase();
      const bTeacher = (b.TEACHER || "").toString().trim().toUpperCase();
      return aTeacher.localeCompare(bTeacher);
    });

    // Build columns and rows for autoTable
    const head = [["S.L.", "CLASS", "SUBJECT", "TEACHER", "CAMPUS", "NOTE"]];
    const body = rawData.map((item) => [
      item.ID || "",
      item.CLASS || "N/A",
      item.SUBJECT || "N/A",
      item.TEACHER || "N/A",
      item.CAMPUS || "N/A",
      "",
    ]);

    // PDF creation
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(14);
    doc.setTextColor(30);
    doc.text(reportTitle, pageWidth / 2, 36, { align: "center" });
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(
      `Year: ${year || "All"} | Responsibility Type: ${responsibilityName}`,
      pageWidth / 2,
      52,
      { align: "center" }
    );

    // Styles
    const margin = { top: 70, left: 40, right: 40, bottom: 30 };
    const styles = {
      fontSize: 9,
      cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
      overflow: "linebreak",
      valign: "middle",
      halign: "left",
      lineColor: [210, 210, 210],
      lineWidth: 0.3,
    };

    const headStyles = {
      fillColor: [30, 58, 138],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
    };

    const columnStyles = {
      0: { cellWidth: 30 },
      1: { cellWidth: 60 },
      2: { cellWidth: 80 },
      3: { cellWidth: 180 },
      4: { cellWidth: 100 },
      5: { cellWidth: 80 },
    };

    doc.autoTable({
      startY: margin.top,
      head,
      body,
      styles,
      headStyles,
      columnStyles,
      margin,
      theme: "grid",
      didDrawPage: function (data) {
        // footer
        const pageCount = doc.internal.getNumberOfPages();
        const page = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          footerText,
          margin.left,
          doc.internal.pageSize.getHeight() - 12
        );
        doc.text(
          `Page ${page} of ${pageCount}`,
          doc.internal.pageSize.getWidth() - margin.right,
          doc.internal.pageSize.getHeight() - 12,
          { align: "right" }
        );
      },
    });

    const pdfBuffer = doc.output("arraybuffer");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=Custom_Assignment_Report_${year || "All"}.pdf`
    );
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.setHeader("Cache-Control", "no-cache");
    return res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error("Custom PDF Export Failed (jsPDF - Custom):", error);
    if (!res.headersSent) {
      return res.status(500).json({
        message: `PDF Generation Failed: ${
          error.message || "An unknown error occurred during PDF streaming."
        }`,
      });
    }
  }
};

module.exports = {
  getReportData,
  exportCustomReportToPDF,
  exportCampusWiseYearlyPDF,
};
