const mongoose = require("mongoose");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const Routine = require("../models/RoutineModel");
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

// --- 🚀 Roman Numeral Map and Conversion Logic ---
const ROMAN_MAP = {
  ONE: "I",
  TWO: "II",
  THREE: "III",
  FOUR: "IV",
  FIVE: "V",
  SIX: "VI",
  SEVEN: "VII",
  EIGHT: "VIII",
  NINE: "IX",
  TEN: "X",
};

const applyRomanNumerals = (assignments) => {
  if (!assignments || typeof assignments !== "object") return assignments;

  const newAssignments = {};
  for (const typeCode in assignments) {
    if (Array.isArray(assignments[typeCode])) {
      newAssignments[typeCode] = assignments[typeCode].map((detail) => {
        const parts = detail.split("-");
        if (parts.length >= 2) {
          const className = parts[0].toUpperCase();
          const subjectName = parts.slice(1).join("-");
          const romanClass = ROMAN_MAP[className] || className;
          return `${romanClass}-${subjectName}`;
        }
        return detail;
      });
    } else {
      newAssignments[typeCode] = assignments[typeCode];
    }
  }
  return newAssignments;
};

// ----------------------------
// helper: safely convert to ObjectId
// ----------------------------
const maybeObjectId = (val) => {
  if (!val) return null;
  try {
    if (mongoose.Types.ObjectId.isValid(val))
      return new mongoose.Types.ObjectId(val);
  } catch (e) {}
  return null;
};

// ----------------------------
// 1️⃣ GET REPORT DATA (Detailed/Summary Reports)
// ----------------------------
const getReportData = async (req, res) => {
  try {
    const { year, typeId, classId, status, reportType, branchId, subjectId } =
      req.query;

    const filter = {};
    if (year) filter.year = parseInt(year, 10);
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

      if (reportType === "CAMPUS_SUMMARY") {
        pipeline.push(
          {
            $group: {
              _id: {
                branch: { $ifNull: ["$branchDetails.name", "N/A"] },
                type: "$responsibilityType",
              },
              totalAssignments: { $sum: 1 },
              typeName: { $first: "$typeDetails.name" },
            },
          },
          {
            $project: {
              _id: 0,
              Branch: "$_id.branch",
              ResponsibilityType: "$typeName",
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
              typeName: { $first: "$typeDetails.name" },
            },
          },
          {
            $project: {
              _id: 0,
              Class: "$_id.class",
              ResponsibilityType: "$typeName",
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
        },
      });
      pipeline.push({ $sort: { CLASS: 1, TEACHER: 1 } });

      const data = await ResponsibilityAssignment.aggregate(
        pipeline
      ).allowDiskUse(true);
      const formatted = data.map((item, idx) => ({ ...item, ID: idx + 1 }));
      return res.json(formatted);
    } else {
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
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ----------------------------
// helper: fetchYearlyReportData updated for Dynamic Year Filter
// ----------------------------
const fetchYearlyReportData = async (
  currentYear,
  previousYear,
  branchIdRaw,
  includePrevious = "true" // 🚀 NEW PARAMETER
) => {
  try {
    const branchObjectId = maybeObjectId(branchIdRaw);

    // Construct year filter based on checkbox
    const yearMatch =
      includePrevious === "true"
        ? { $or: [{ year: currentYear }, { year: previousYear }] }
        : { year: currentYear };

    const pipeline = [
      { $match: { ...yearMatch, status: { $ne: "Cancelled" } } },
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
      {
        $lookup: {
          from: "responsibilitytypes",
          localField: "responsibilityType",
          foreignField: "_id",
          as: "typeDetails",
        },
      },
      { $unwind: { path: "$typeDetails", preserveNullAndEmptyArrays: true } },
      { $match: { "typeDetails.name": { $ne: null } } },
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
      {
        $addFields: {
          assignmentDetail: {
            $concat: [
              { $ifNull: ["$classDetails.name", "Class-N/A"] },
              "-",
              { $ifNull: ["$subjectDetails.name", "Sub-N/A"] },
            ],
          },
          typeName: "$typeDetails.name",
          teacherName: "$teacherDetails.name",
          teacherCampus: {
            $ifNull: ["$teacherCampus", "$teacherDetails.campus"],
          },
        },
      },
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
      {
        $group: {
          _id: {
            teacherId: "$_id.teacherId",
            teacherName: "$_id.teacherName",
            campus: "$_id.campus",
            year: "$_id.year",
          },
          assignmentsByType: {
            $push: { k: "$_id.typeName", v: "$detailArray" },
          },
        },
      },
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
      { $sort: { teacherName: 1 } },
    ];

    let results = await ResponsibilityAssignment.aggregate(
      pipeline
    ).allowDiskUse(true);

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

    results = results.map((r) => ({
      ...r,
      campusName: campusMap.get(String(r.campus)) || "N/A",
      yearlyAssignments: r.yearlyAssignments.map((ya) => ({
        ...ya,
        assignments: applyRomanNumerals(ya.assignments),
      })),
    }));

    return results;
  } catch (error) {
    console.error("Aggregation Failed:", error);
    throw error;
  }
};

// ----------------------------
// 2️⃣ YEARLY REPORT PDF (Updated with Dynamic Rows)
// ----------------------------
const exportCampusWiseYearlyPDF = async (req, res) => {
  const { year, branchId, includePrevious, selectedTypes } = req.query;
  if (!year) return res.status(400).json({ message: "Year is required." });

  const currentYear = parseInt(year, 10);
  const previousYear = currentYear - 1;
  const isComparing = includePrevious === "true";

  // 🚀 DYNAMIC COLUMNS: Use selected types from frontend or fallback to global RESPONSIBILITY_TYPES
  const ACTIVE_TYPES = selectedTypes
    ? selectedTypes.split(",")
    : RESPONSIBILITY_TYPES;

  try {
    // 1. Fetch the data using aggregation
    const aggregatedData = await fetchYearlyReportData(
      currentYear,
      previousYear,
      branchId,
      includePrevious
    );

    if (!ArrayOfData(aggregatedData))
      return res.status(404).json({ message: "No data found." });

    // 2. Logic for Dynamic Subheadings (Campus & Year)
    let displayCampus = "All Campuses";
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      const BranchModel = mongoose.models.Branch || mongoose.model("Branch");
      const branch = await BranchModel.findById(branchId).select("name");
      if (branch) displayCampus = branch.name;
    }

    const displayYear = isComparing
      ? `${previousYear} - ${currentYear}`
      : `${currentYear}`;

    // 3. Prepare the rows for the table
    const flatReport = [];
    let serial = 1;

    for (const teacherResult of aggregatedData) {
      const assignmentData = {};
      teacherResult.yearlyAssignments.forEach((ya) => {
        assignmentData[ya.year] = ya.assignments || {};
      });

      const currentYearRow = {
        SL: serial,
        Campus: teacherResult.campusName || "N/A",
        Teacher: (teacherResult.teacherName || "N/A").toUpperCase(),
        Year: currentYear,
      };

      // Apply assignments for active responsibility types
      ACTIVE_TYPES.forEach((type) => {
        currentYearRow[type] = Array.isArray(
          assignmentData[currentYear]?.[type]
        )
          ? assignmentData[currentYear][type].join(" | ")
          : "-";
      });
      flatReport.push(currentYearRow);

      if (isComparing) {
        const previousYearRow = {
          SL: "",
          Campus: "",
          Teacher: "",
          Year: previousYear,
        };
        ACTIVE_TYPES.forEach((type) => {
          previousYearRow[type] = Array.isArray(
            assignmentData[previousYear]?.[type]
          )
            ? assignmentData[previousYear][type].join(" | ")
            : "-";
        });
        flatReport.push(previousYearRow);
      }
      serial++;
    }

    // Dynamic Header Array
    const head = [["Sl", "Campus", "Teacher's Name", "Year", ...ACTIVE_TYPES]];

    const body = flatReport.map((r) => [
      r.SL,
      r.Campus,
      r.Teacher,
      r.Year,
      ...ACTIVE_TYPES.map((t) => r[t]),
    ]);

    // 4. Generate PDF
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "l" });
    const pageWidth = doc.internal.pageSize.getWidth();

    // --- Header Section ---
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Yearly Responsibility Report", pageWidth / 2, 30, {
      align: "center",
    });

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Campus: ${displayCampus}`, pageWidth / 2, 45, {
      align: "center",
    });
    doc.text(`Academic Year: ${displayYear}`, pageWidth / 2, 60, {
      align: "center",
    });

    // 5. Render Table
    doc.autoTable({
      startY: 75,
      head,
      body,
      theme: "grid",
      // 🚀 FONT ADJUSTMENT: Shrink font if many columns are selected to prevent overlap
      styles: {
        fontSize: ACTIVE_TYPES.length > 8 ? 6 : 7.5,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [245, 205, 121],
        textColor: 20,
        fontStyle: "bold",
        halign: "center",
      },
      columnStyles: {
        0: { cellWidth: 28, halign: "center" },
        1: { cellWidth: 70 },
        2: { cellWidth: 100 },
        3: { cellWidth: 35, halign: "center" },
      },
      didParseCell: function (data) {
        if (data.section === "body" && isComparing) {
          if (data.row.index % 2 === 0 && data.column.index <= 2) {
            data.cell.rowSpan = 2;
          }
        }
      },
      didDrawPage: (data) => {
        const page = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(7);
        doc.setTextColor(100);
        doc.text(
          `Page ${page}`,
          pageWidth - 40,
          doc.internal.pageSize.getHeight() - 18,
          { align: "right" }
        );
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=Yearly_Report_${displayCampus}_${currentYear}.pdf`
    );
    return res.send(Buffer.from(doc.output("arraybuffer")));
  } catch (error) {
    console.error("Yearly PDF Error:", error);
    return res.status(500).json({ message: "Export failed." });
  }
};

// ----------------------------
// 3️⃣ EXPORT CUSTOM PDF REPORT (Restored Sorting & Logic)
// ----------------------------
const exportCustomReportToPDF = async (req, res) => {
  const { year, typeId, reportType } = req.query;
  if (reportType === "YEARLY_SUMMARY")
    return exportCampusWiseYearlyPDF(req, res);

  try {
    let responsibilityName = "N/A";
    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
      const respType = await ResponsibilityType.findById(typeId).select("name");
      responsibilityName = respType ? respType.name : "N/A";
    }

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
      },
      status: () => pseudoRes,
      send: () => {},
    };
    await getReportData(pseudoReq, pseudoRes);

    if (!ArrayOfData(rawData))
      return res.status(404).json({ message: "No data found." });

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
      "PHYSICS",
      "CHEMISTRY",
      "H.MATH",
      "BIOLOGY",
      "BGS",
      "ACCOUNTING",
      "FINANCE & BANKING",
      "B.ENT",
      "SCIENCE",
      "ICT",
      "AGRICULTURE",
      "H.SCIENCE",
    ];

    rawData.sort((a, b) => {
      const aClassIdx = CLASS_ORDER.indexOf(a.CLASS?.toUpperCase());
      const bClassIdx = CLASS_ORDER.indexOf(b.CLASS?.toUpperCase());
      if (aClassIdx !== bClassIdx)
        return (
          (aClassIdx === -1 ? 999 : aClassIdx) -
          (bClassIdx === -1 ? 999 : bClassIdx)
        );

      const aSubIdx = SUBJECT_ORDER.indexOf(a.SUBJECT?.toUpperCase());
      const bSubIdx = SUBJECT_ORDER.indexOf(b.SUBJECT?.toUpperCase());
      if (aSubIdx !== bSubIdx)
        return (
          (aSubIdx === -1 ? 999 : aSubIdx) - (bSubIdx === -1 ? 999 : bSubIdx)
        );

      return a.TEACHER.localeCompare(b.TEACHER);
    });

    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.text("Detailed Report", pageWidth / 2, 36, {
      align: "center",
    });
    doc.setFontSize(10);
    doc.text(`Year: ${year} | Type: ${responsibilityName}`, pageWidth / 2, 52, {
      align: "center",
    });

    doc.autoTable({
      startY: 70,
      head: [["S.L.", "CLASS", "SUBJECT", "TEACHER", "CAMPUS"]],
      body: rawData.map((item, index) => [
        index + 1,
        item.CLASS,
        item.SUBJECT,
        item.TEACHER.toUpperCase(),
        item.CAMPUS,
      ]),
      theme: "grid",
      headStyles: { fillColor: [30, 58, 138], textColor: 255 },
    });

    res.setHeader("Content-Type", "application/pdf");
    return res.send(Buffer.from(doc.output("arraybuffer")));
  } catch (error) {
    console.error("Custom Export Error:", error);
    return res.status(500).json({ message: "Export failed." });
  }
};

const exportCampusRoutinePDF = async (req, res) => {
  const { branchId, year } = req.query;
  if (!branchId || !year)
    return res.status(400).json({ message: "Branch and Year are required." });

  try {
    const branchObjectId = new mongoose.Types.ObjectId(branchId);
    const selectedYear = parseInt(year, 10);

    const BranchModel = mongoose.models.Branch || mongoose.model("Branch");
    const branch = await BranchModel.findById(branchId);
    const campusName = branch ? branch.name : "N/A";

    const teachers = await Teacher.find({ campus: branchObjectId }).sort({
      name: 1,
    });

    if (!teachers.length)
      return res.status(404).json({ message: "No teachers found." });

    const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const tableBody = [];
    const teacherRowSpans = []; // Row merging ট্র্যাক করার জন্য
    let serial = 1;

    for (const teacher of teachers) {
      const teacherRoutineDoc = await Routine.findOne({ teacher: teacher._id })
        .populate({ path: "years.assignments.className", model: "Class" })
        .populate({ path: "years.assignments.subject", model: "Subject" });

      if (teacherRoutineDoc) {
        const yearData = teacherRoutineDoc.years.find(
          (y) => y.year === selectedYear
        );

        if (yearData && yearData.assignments.length > 0) {
          const uniqueAssignments = [];
          const seen = new Set();

          yearData.assignments.forEach((assign) => {
            const classText = assign.className?.name || "N/A";
            const subjectText = assign.subject?.name || "N/A";
            const combinedKey = `${classText}-${subjectText}`;

            if (!seen.has(combinedKey)) {
              seen.add(combinedKey);
              uniqueAssignments.push({ classText, subjectText });
            }
          });

          if (uniqueAssignments.length > 0) {
            teacherRowSpans.push({
              startIndex: tableBody.length,
              span: uniqueAssignments.length,
            });

            uniqueAssignments.forEach((assign) => {
              tableBody.push([
                serial,
                campusName,
                teacher.name.toUpperCase(),
                assign.classText,
                assign.subjectText,
              ]);
            });
            serial++;
          }
        }
      }
    }

    // PDF হেডার
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Teacher's Academic Routine", pageWidth / 2, 45, {
      align: "center",
    });

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Campus: ${campusName} | Year: ${selectedYear}`,
      pageWidth / 2,
      62,
      { align: "center" }
    );

    // ফুটার ডেটা তৈরি
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB"); // DD/MM/YYYY
    const timeStr = now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const footerTextLeft = `Printed on: ${dateStr} - ${timeStr}`;

    doc.autoTable({
      startY: 80,
      head: [["SL", "Campus", "Name", "Class", "Subject"]],
      body: tableBody,
      theme: "grid",
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineWidth: 1,
        fontStyle: "bold",
        halign: "center",
      },
      styles: {
        fontSize: 10,
        textColor: [0, 0, 0],
        lineWidth: 0.5,
        valign: "middle", // ভার্টিক্যালি সেন্টার
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 35 },
        1: { halign: "center", cellWidth: 80 },
        2: { halign: "left", fontStyle: "bold", cellWidth: 140 }, // 🚀 Name Left Aligned
        3: { halign: "center", cellWidth: 80 },
        4: { halign: "left" },
      },
      didParseCell: function (data) {
        if (data.section === "body" && data.column.index <= 2) {
          const spanInfo = teacherRowSpans.find(
            (s) => s.startIndex === data.row.index
          );
          if (spanInfo) {
            data.cell.rowSpan = spanInfo.span;
          }
        }
      },
      didDrawPage: function (data) {
        // 🚀 Footer Implementation
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(100);

        // বাম পাশে প্রিন্ট ডেট ও টাইম
        doc.text(footerTextLeft, 40, pageHeight - 20);

        // ডান পাশে পেজ নাম্বার
        const pageNumberText = `Page ${data.pageNumber} of ${pageCount}`;
        doc.text(pageNumberText, pageWidth - 40, pageHeight - 20, {
          align: "right",
        });
      },
      margin: { bottom: 40 }, // ফুটারের জন্য জায়গা রাখা
    });

    // সঠিক মোট পেজ সংখ্যা দেখানোর জন্য সেকেন্ড পাস (Optional but recommended)
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - 40, pageHeight - 20, {
        align: "right",
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=Routine_${campusName}.pdf`
    );
    return res.send(Buffer.from(doc.output("arraybuffer")));
  } catch (error) {
    console.error("Routine Export Error:", error);
    res.status(500).json({ message: "Export Failed" });
  }
};

module.exports = {
  getReportData,
  exportCustomReportToPDF,
  exportCampusWiseYearlyPDF,
  exportCampusRoutinePDF,
};
