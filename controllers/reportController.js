const mongoose = require("mongoose");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const ExaminerExchangeDate = require("../models/ExaminerExchangeDateModel");
const Routine = require("../models/RoutineModel");
const Branch = require("../models/BranchModel");
const Class = require("../models/ClassModel");
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

const parseObjectIdList = (value) =>
  (value || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

const getReportGeneratedAt = () =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
    timeZone: "Asia/Dhaka",
  }).format(new Date());

const drawReportFooter = (doc, pageNumber) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 24;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.6);
  doc.line(40, footerY - 12, pageWidth - 40, footerY - 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${getReportGeneratedAt()}`, 40, footerY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(30, 58, 138);
  doc.text("FRII Exam Management Platform", pageWidth / 2, footerY, {
    align: "center",
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Page ${pageNumber}`, pageWidth - 40, footerY, { align: "right" });
};

const isQuestionResponsibilityType = (name = "") =>
  name.trim().toUpperCase().startsWith("Q");

const getQuestionTerm = (name = "") => {
  const term = name.trim().replace(/^Q[\s_-]*/i, "").trim();
  return term || name.trim();
};

const formatSubmissionDeadline = (date) => {
  if (!date) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Asia/Dhaka",
  }).format(new Date(date));
};

const getQuestionReportMeta = (types = [], year) => {
  const selectedTypes = types.filter((type) => type?.name);
  if (
    selectedTypes.length === 0 ||
    !selectedTypes.every((type) => isQuestionResponsibilityType(type.name))
  ) {
    return { title: null, submissionMessage: null };
  }

  const terms = [
    ...new Set(selectedTypes.map((type) => getQuestionTerm(type.name))),
  ];
  const deadlineParts = selectedTypes.map((type) => {
    const deadline = formatSubmissionDeadline(type.submissionDeadline);
    if (selectedTypes.length === 1) return deadline;
    return `${getQuestionTerm(type.name)} - ${deadline}`;
  });

  return {
    title: `Question Setters' List - ${terms.join(", ")} - ${year}`,
    submissionMessage: `Last date of submission: ${[
      ...new Set(deadlineParts),
    ].join("; ")}`,
  };
};

const isExaminerResponsibilityType = (name = "") =>
  name.trim().toUpperCase().startsWith("E");

const getExaminerTerm = (name = "") => {
  const term = name.trim().replace(/^E[\s_-]*/i, "").trim().toUpperCase();
  const labels = {
    HY: "Half Yearly",
    "PRE-TEST": "Pre-Test",
    ANNUAL: "Annual",
    TEST: "Test",
  };
  return labels[term] || term || name.trim();
};

const getExaminerExamName = (types = [], year) => {
  const examinerTerms = [
    ...new Set(types.map((type) => getExaminerTerm(type.name))),
  ].filter(Boolean);
  return examinerTerms.length
    ? `${examinerTerms.join(" / ")} Examination-${year}`
    : `Examination-${year}`;
};

const getClassDisplayName = (className = "") => {
  const normalized = className.trim().toUpperCase();
  return ROMAN_MAP[normalized] || className || "N/A";
};

const normalizeReportLabel = (value = "") =>
  value
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s*&\s*/g, " & ");

const subjectAliases = {
  BANGLA: "BENGALI",
  "BANGLA-I": "BENGALI-I",
  "BANGLA-II": "BENGALI-II",
  MATHEMATICS: "MATH",
  "GENERAL MATH": "G.MATH",
  "GENERAL MATHEMATICS": "G.MATH",
  "G. MATH": "G.MATH",
  "G. SCIENCE": "G.SCIENCE",
  "GENERAL SCIENCE": "G.SCIENCE",
  REDN: "R.EDN",
  "R.EDN.": "R.EDN",
  "R. EDN": "R.EDN",
  "R. EDN.": "R.EDN",
  "B. ENT": "B.ENT",
  "B. ENT.": "B.ENT",
  "BUSINESS ENTREPRENEURSHIP": "B.ENT",
  "H. MATH": "H.MATH",
  "HIGHER MATH": "H.MATH",
  "H. SCIENCE": "H.SCIENCE",
  "HOME SCIENCE": "H.SCIENCE",
};

const normalizeSubjectName = (value = "") => {
  const normalized = normalizeReportLabel(value);
  return subjectAliases[normalized] || normalized;
};

const EXAMINER_SUBJECT_ORDER = {
  PRIMARY: ["BENGALI", "ENGLISH", "G.MATH", "R.EDN", "BGS", "G.SCIENCE"],
  JUNIOR: [
    "BENGALI-I",
    "BENGALI-II",
    "ENGLISH-I",
    "ENGLISH-II",
    "MATH",
    "SCIENCE",
    "BGS",
    "R.EDN",
    "ICT",
  ],
  SENIOR: [
    "BENGALI-I",
    "BENGALI-II",
    "ENGLISH-I",
    "ENGLISH-II",
    "G.MATH",
    "R.EDN",
    "BGS",
    "PHYSICS",
    "CHEMISTRY",
    "H.MATH",
    "BIOLOGY",
    "ACCOUNTING",
    "B.ENT",
    "FINANCE & BANKING",
    "G.SCIENCE",
    "ICT",
    "AGRICULTURE",
    "H.SCIENCE",
  ],
};

const getExaminerSubjectOrderGroup = (className = "") => {
  const normalizedClass = normalizeReportLabel(className);
  if (["NINE", "TEN", "IX", "X"].includes(normalizedClass)) return "SENIOR";
  if (["SIX", "SEVEN", "EIGHT", "VI", "VII", "VIII"].includes(normalizedClass)) {
    return "JUNIOR";
  }
  return "PRIMARY";
};

const getExaminerSubjectRank = (className = "", subjectName = "") => {
  const group = getExaminerSubjectOrderGroup(className);
  const order = EXAMINER_SUBJECT_ORDER[group];
  const index = order.indexOf(normalizeSubjectName(subjectName));
  return index === -1 ? 999 : index;
};

const isSeniorExaminerClass = (className = "") =>
  getExaminerSubjectOrderGroup(className) === "SENIOR";

const isSeniorScrutinizerSubject = (subjectName = "") =>
  ["ICT", "AGRICULTURE", "H.SCIENCE"].includes(
    normalizeSubjectName(subjectName)
  );

const formatExchangeDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const day = `${date.getDate()}`.padStart(2, "0");
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const year = `${date.getFullYear()}`.slice(-2);
  return `${day}.${month}.${year}`;
};

const getExchangeDateKey = (className = "", subjectName = "") =>
  `${className}`.trim().toUpperCase() + "|||" + `${subjectName}`.trim().toUpperCase();

const getExchangeDateIdKey = ({
  responsibilityType,
  targetClass,
  targetSubject,
}) =>
  [responsibilityType, targetClass, targetSubject]
    .map((value) => (value ? String(value) : ""))
    .join("|||");

const parseExchangeDateMap = (value) => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch (error) {
    return {};
  }
};

const getSavedExchangeDateMap = async ({ year, rows = [] }) => {
  const selectedYear = parseInt(year, 10);
  if (!selectedYear || rows.length === 0) return {};

  const keys = rows
    .map((row) => ({
      responsibilityType: row.RESPONSIBILITY_TYPE_ID,
      targetClass: row.CLASS_ID,
      targetSubject: row.SUBJECT_ID,
    }))
    .filter(
      (item) =>
        mongoose.Types.ObjectId.isValid(item.responsibilityType) &&
        mongoose.Types.ObjectId.isValid(item.targetClass) &&
        mongoose.Types.ObjectId.isValid(item.targetSubject)
    );

  if (keys.length === 0) return {};

  const records = await ExaminerExchangeDate.find({
    year: selectedYear,
    $or: keys.map((item) => ({
      responsibilityType: new mongoose.Types.ObjectId(item.responsibilityType),
      targetClass: new mongoose.Types.ObjectId(item.targetClass),
      targetSubject: new mongoose.Types.ObjectId(item.targetSubject),
    })),
  }).lean();

  return Object.fromEntries(
    records.map((record) => [
      getExchangeDateIdKey(record),
      record.lastDateOfExchange,
    ])
  );
};

const buildExaminerReportBody = ({
  rows = [],
  lastDateOfExchange = "",
  exchangeDateMap = {},
}) => {
  const grouped = new Map();
  rows.forEach((row) => {
    const className = row.CLASS || "N/A";
    const subjectName = row.SUBJECT || "N/A";

    if (!grouped.has(className)) grouped.set(className, new Map());
    const subjectMap = grouped.get(className);
    if (!subjectMap.has(subjectName)) subjectMap.set(subjectName, []);
    subjectMap.get(subjectName).push(row);
  });

  const sections = [];

  grouped.forEach((subjectMap, className) => {
    const body = [];
    subjectMap.forEach((subjectRows, subjectName) => {
      const first = subjectRows[0] || {};
      const second = subjectRows[1] || {};
      const exchangeDate =
        exchangeDateMap[
          getExchangeDateIdKey({
            responsibilityType: first.RESPONSIBILITY_TYPE_ID,
            targetClass: first.CLASS_ID,
            targetSubject: first.SUBJECT_ID,
          })
        ] ||
        exchangeDateMap[getExchangeDateKey(className, subjectName)] ||
        lastDateOfExchange;
      body.push([
        subjectName,
        first.TEACHER?.toUpperCase?.() || first.TEACHER || "",
        first.CAMPUS || "",
        "",
        formatExchangeDate(exchangeDate),
        second.TEACHER?.toUpperCase?.() || second.TEACHER || "",
        second.CAMPUS || "",
        "",
      ]);
    });

    sections.push({ className, body });
  });

  return sections;
};

const drawExaminerClassWiseReport = ({
  doc,
  rawData,
  selectedTypeDetails,
  year,
  lastDateOfExchange,
  exchangeDateMap,
}) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const examName = getExaminerExamName(selectedTypeDetails, year);
  const sections = buildExaminerReportBody({
    rows: rawData,
    lastDateOfExchange,
    exchangeDateMap,
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("List of Examiner & Scrutinizer", pageWidth / 2, 34, {
    align: "center",
  });
  doc.setFontSize(11);
  doc.text(examName, pageWidth / 2, 50, { align: "center" });

  const renderExaminerTable = ({
    startY,
    rows,
    firstPersonLabel = "Examiner-1",
    secondPersonLabel,
  }) => {
    if (rows.length === 0) return startY;

    doc.autoTable({
      startY,
      head: [
        [
          "Subject",
          firstPersonLabel,
          "Campus / Shift",
          "Signature",
          "Last Date of Exchange",
          secondPersonLabel,
          "Campus / Shift",
          "Signature",
        ],
      ],
      body: rows,
      theme: "grid",
      tableWidth: pageWidth - 80,
      styles: {
        fontSize: 7.5,
        textColor: [15, 23, 42],
        lineColor: [71, 85, 105],
        lineWidth: 0.4,
        overflow: "linebreak",
        cellPadding: 3,
        valign: "middle",
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [15, 23, 42],
        lineColor: [71, 85, 105],
        lineWidth: 0.5,
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { cellWidth: 78 },
        2: { cellWidth: 56 },
        3: { cellWidth: 48 },
        4: { cellWidth: 72, halign: "left" },
        5: { cellWidth: 78 },
        6: { cellWidth: 56 },
        7: { cellWidth: 48 },
      },
      margin: { left: 40, right: 40, bottom: 46 },
      didDrawPage: (data) => {
        drawReportFooter(doc, data.pageNumber);
      },
    });

    return (doc.lastAutoTable?.finalY || startY) + 12;
  };

  let startY = 74;
  sections.forEach((section, index) => {
    if (index > 0 && startY > 640) {
      doc.addPage();
      startY = 48;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`Class: ${getClassDisplayName(section.className)}`, 40, startY);

    if (isSeniorExaminerClass(section.className)) {
      const examinerRows = section.body.filter(
        (row) => !isSeniorScrutinizerSubject(row[0])
      );
      const scrutinizerRows = section.body.filter((row) =>
        isSeniorScrutinizerSubject(row[0])
      );

      startY = renderExaminerTable({
        startY: startY + 8,
        rows: examinerRows,
        secondPersonLabel: "Examiner-2",
      });

      if (scrutinizerRows.length > 0) {
        if (startY > 660) {
          doc.addPage();
          startY = 48;
        }
        startY = renderExaminerTable({
          startY,
          rows: scrutinizerRows,
          firstPersonLabel: "Examiner",
          secondPersonLabel: "Scrutinizer",
        });
      }
    } else {
      startY = renderExaminerTable({
        startY: startY + 8,
        rows: section.body,
        secondPersonLabel: "Examiner-2",
      });
    }

    startY += 12;
  });
};

const drawSubmissionMessage = (doc, message) => {
  if (!message) return;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = (doc.lastAutoTable?.finalY || 80) + 16;

  if (y > pageHeight - 76) {
    doc.addPage();
    drawReportFooter(doc, doc.getNumberOfPages());
    y = 48;
  }

  const x = 40;
  const width = pageWidth - 80;
  const height = 28;
  const iconX = x + 12;
  const iconY = y + 7;

  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(147, 197, 253);
  doc.setLineWidth(0.8);
  doc.roundedRect(x, y, width, height, 6, 6, "FD");

  doc.setDrawColor(30, 58, 138);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(iconX, iconY, 13, 13, 2, 2, "FD");
  doc.setFillColor(30, 58, 138);
  doc.rect(iconX, iconY, 13, 4, "F");
  doc.setDrawColor(30, 58, 138);
  doc.line(iconX + 3, iconY - 2, iconX + 3, iconY + 2);
  doc.line(iconX + 10, iconY - 2, iconX + 10, iconY + 2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 58, 138);
  doc.text(message, iconX + 22, y + 18);
};

const getDetailedReportHeaderLine = async ({ reportType, branchId, classId }) => {
  if (
    reportType === "EXPORT_BRANCH_DETAILED" &&
    branchId &&
    mongoose.Types.ObjectId.isValid(branchId)
  ) {
    const branch = await Branch.findById(branchId).select("name").lean();
    return branch?.name ? `Branch/Shift: ${branch.name}` : "";
  }

  if (
    reportType === "EXPORT_CLASS_DETAILED" &&
    classId &&
    mongoose.Types.ObjectId.isValid(classId)
  ) {
    const classDoc = await Class.findById(classId).select("name").lean();
    return classDoc?.name ? `Class: ${classDoc.name}` : "";
  }

  return "";
};

// ----------------------------
// 1️⃣ GET REPORT DATA (Detailed/Summary Reports)
// ----------------------------
const getReportData = async (req, res) => {
  try {
    const {
      year,
      typeId,
      typeIds,
      classId,
      classIds,
      status,
      reportType,
      branchId,
      subjectId,
    } = req.query;

    if (reportType === "INACTIVE_NO_ROUTINE") {
      if (!year) {
        return res.status(400).json({
          message: "Year is required for no-routine teacher report.",
        });
      }

      const selectedYear = parseInt(year, 10);
      const teacherMatch = {};

      if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
        teacherMatch.campus = new mongoose.Types.ObjectId(branchId);
      }

      const pipeline = [
        { $match: teacherMatch },
        {
          $lookup: {
            from: "routines",
            let: { teacherId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$teacher", "$$teacherId"] },
                },
              },
              {
                $match: {
                  years: {
                    $elemMatch: {
                      year: selectedYear,
                      "assignments.0": { $exists: true },
                    },
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "activeRoutine",
          },
        },
        { $match: { "activeRoutine.0": { $exists: false } } },
        {
          $lookup: {
            from: "branches",
            localField: "campus",
            foreignField: "_id",
            as: "campusDetails",
          },
        },
        {
          $unwind: { path: "$campusDetails", preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            _id: 0,
            ID: { $literal: 0 },
            TEACHERID: "$teacherId",
            TEACHER: "$name",
            CAMPUS: { $ifNull: ["$campusDetails.name", "N/A"] },
            YEAR: { $literal: selectedYear },
            STATUS: {
              $cond: [{ $eq: ["$isActive", false] }, "Inactive", "Active"],
            },
            ROUTINE_STATUS: { $literal: "No routine" },
          },
        },
        { $sort: { CAMPUS: 1, TEACHER: 1 } },
      ];

      const data = await Teacher.aggregate(pipeline).allowDiskUse(true);
      const formatted = data.map((item, idx) => ({ ...item, ID: idx + 1 }));
      return res.json(formatted);
    }

    if (reportType === "UNASSIGNED_TEACHERS") {
      const selectedTypeIds = parseObjectIdList(typeIds || typeId);
      const selectedClassIds = parseObjectIdList(classIds || classId);

      if (!year || selectedTypeIds.length === 0) {
        return res.status(400).json({
          message:
            "Year and at least one duty type are required for unassigned report.",
        });
      }

      const selectedYear = parseInt(year, 10);
      const selectedTypes = await ResponsibilityType.find({
        _id: { $in: selectedTypeIds },
      })
        .select("name requiresClassSubject")
        .sort({ name: 1 })
        .lean();

      if (selectedTypes.length === 0) {
        return res.status(400).json({
          message: "No valid duty types were found for unassigned report.",
        });
      }

      const selectedTypeMeta = selectedTypes.map((type) => ({
        id: String(type._id),
        name: type.name,
        requiresClassSubject: type.requiresClassSubject !== false,
      }));
      const teacherMatch = { isActive: { $ne: false } };

      if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
        teacherMatch.campus = new mongoose.Types.ObjectId(branchId);
      }

      const routineLookupPipeline = [
        {
          $match: {
            $expr: { $eq: ["$teacher", "$$teacherId"] },
          },
        },
        { $unwind: "$years" },
        { $match: { "years.year": selectedYear } },
        { $unwind: "$years.assignments" },
      ];

      if (selectedClassIds.length > 0) {
        routineLookupPipeline.push({
          $match: {
            "years.assignments.className": { $in: selectedClassIds },
          },
        });
      }

      routineLookupPipeline.push({
        $group: {
          _id: "$teacher",
          classIds: { $addToSet: "$years.assignments.className" },
        },
      });

      const pipeline = [
        { $match: teacherMatch },
        {
          $lookup: {
            from: "routines",
            let: { teacherId: "$_id" },
            pipeline: routineLookupPipeline,
            as: "activeRoutine",
          },
        },
        { $match: { "activeRoutine.0": { $exists: true } } },
        {
          $addFields: {
            routineClassIds: {
              $ifNull: [{ $arrayElemAt: ["$activeRoutine.classIds", 0] }, []],
            },
          },
        },
        {
          $lookup: {
            from: "classes",
            localField: "routineClassIds",
            foreignField: "_id",
            as: "routineClassDetails",
          },
        },
        {
          $lookup: {
            from: "responsibilityassignments",
            let: {
              teacherId: "$_id",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$teacher", "$$teacherId"] },
                      { $eq: ["$year", selectedYear] },
                      { $in: ["$responsibilityType", selectedTypeIds] },
                      { $ne: ["$status", "Cancelled"] },
                    ],
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  responsibilityType: 1,
                  targetClass: 1,
                },
              },
            ],
            as: "matchingAssignments",
          },
        },
        {
          $lookup: {
            from: "branches",
            localField: "campus",
            foreignField: "_id",
            as: "campusDetails",
          },
        },
        {
          $unwind: { path: "$campusDetails", preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            _id: 0,
            teacherObjectId: "$_id",
            ID: { $literal: 0 },
            TEACHERID: "$teacherId",
            TEACHER: "$name",
            CAMPUS: { $ifNull: ["$campusDetails.name", "N/A"] },
            YEAR: { $literal: selectedYear },
            routineClasses: {
              $map: {
                input: "$routineClassDetails",
                as: "class",
                in: {
                  id: { $toString: "$$class._id" },
                  name: "$$class.name",
                },
              },
            },
            matchingAssignments: {
              $map: {
                input: "$matchingAssignments",
                as: "assignment",
                in: {
                  responsibilityType: {
                    $toString: "$$assignment.responsibilityType",
                  },
                  targetClass: {
                    $cond: [
                      { $ifNull: ["$$assignment.targetClass", false] },
                      { $toString: "$$assignment.targetClass" },
                      null,
                    ],
                  },
                },
              },
            },
          },
        },
        { $sort: { CAMPUS: 1, TEACHER: 1 } },
      ];

      const data = await Teacher.aggregate(pipeline).allowDiskUse(true);
      const formatted = data
        .flatMap((item) => {
          const routineClasses = item.routineClasses || [];
          const assignments = item.matchingAssignments || [];
          const hasAnySelectedDutyAssignment = assignments.some((assignment) =>
            selectedTypeMeta.some((type) => assignment.responsibilityType === type.id)
          );

          if (hasAnySelectedDutyAssignment) return [];

          return [
            {
              TEACHERID: item.TEACHERID,
              TEACHER: item.TEACHER,
              CAMPUS: item.CAMPUS,
              YEAR: item.YEAR,
              CLASSES: routineClasses.map((routineClass) => routineClass.name).join(", "),
              MISSING_DUTIES: selectedTypeMeta.map((type) => type.name).join(", "),
            },
          ];
        })
        .sort((first, second) => {
          const campusCompare = (first.CAMPUS || "").localeCompare(
            second.CAMPUS || ""
          );
          if (campusCompare !== 0) return campusCompare;
          const classCompare = (first.CLASSES || "").localeCompare(
            second.CLASSES || ""
          );
          if (classCompare !== 0) return classCompare;
          return (first.TEACHER || "").localeCompare(second.TEACHER || "");
        })
        .map((item, idx) => ({ ...item, ID: idx + 1 }));

      return res.json(formatted);
    }

    const filter = {};
    if (year) filter.year = parseInt(year, 10);
    const selectedTypeIds = parseObjectIdList(typeIds);
    if (selectedTypeIds.length > 0) {
      filter.responsibilityType = { $in: selectedTypeIds };
    } else if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
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
          RESPONSIBILITY_TYPE_ID: { $toString: "$responsibilityType" },
          YEAR: "$year",
          CLASS: { $ifNull: ["$classDetails.name", "N/A"] },
          CLASS_ID: {
            $cond: [
              { $ifNull: ["$targetClass", false] },
              { $toString: "$targetClass" },
              "",
            ],
          },
          SUBJECT: { $ifNull: ["$subjectDetails.name", "N/A"] },
          SUBJECT_ID: {
            $cond: [
              { $ifNull: ["$targetSubject", false] },
              { $toString: "$targetSubject" },
              "",
            ],
          },
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
        RESPONSIBILITY_TYPE_ID: a.responsibilityType?._id?.toString() || "",
        YEAR: a.year,
        CLASS: a.targetClass?.name || "N/A",
        CLASS_ID: a.targetClass?._id?.toString() || "",
        SUBJECT: a.targetSubject?.name || "N/A",
        SUBJECT_ID: a.targetSubject?._id?.toString() || "",
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

const getExaminerExchangeDates = async (req, res) => {
  try {
    const { year, typeIds, classIds, subjectIds } = req.query;
    const selectedYear = parseInt(year, 10);
    const selectedTypeIds = parseObjectIdList(typeIds);
    const selectedClassIds = parseObjectIdList(classIds);
    const selectedSubjectIds = parseObjectIdList(subjectIds);

    if (!selectedYear || selectedTypeIds.length === 0) {
      return res.status(400).json({
        message: "Year and at least one duty type are required.",
      });
    }

    const filter = {
      year: selectedYear,
      responsibilityType: { $in: selectedTypeIds },
    };
    if (selectedClassIds.length > 0) filter.targetClass = { $in: selectedClassIds };
    if (selectedSubjectIds.length > 0)
      filter.targetSubject = { $in: selectedSubjectIds };

    const records = await ExaminerExchangeDate.find(filter).lean();
    return res.json(
      records.map((record) => ({
        key: getExchangeDateIdKey(record),
        year: record.year,
        responsibilityType: record.responsibilityType,
        targetClass: record.targetClass,
        targetSubject: record.targetSubject,
        lastDateOfExchange: record.lastDateOfExchange
          ? record.lastDateOfExchange.toISOString().slice(0, 10)
          : "",
      }))
    );
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch exchange dates.",
    });
  }
};

const saveExaminerExchangeDates = async (req, res) => {
  try {
    const { year, entries = [] } = req.body;
    const selectedYear = parseInt(year, 10);

    if (!selectedYear || !Array.isArray(entries)) {
      return res.status(400).json({ message: "Invalid exchange date payload." });
    }

    const operations = entries
      .filter(
        (entry) =>
          mongoose.Types.ObjectId.isValid(entry.responsibilityType) &&
          mongoose.Types.ObjectId.isValid(entry.targetClass) &&
          mongoose.Types.ObjectId.isValid(entry.targetSubject)
      )
      .map((entry) => {
        const filter = {
          year: selectedYear,
          responsibilityType: new mongoose.Types.ObjectId(entry.responsibilityType),
          targetClass: new mongoose.Types.ObjectId(entry.targetClass),
          targetSubject: new mongoose.Types.ObjectId(entry.targetSubject),
        };
        const lastDateOfExchange = entry.lastDateOfExchange
          ? new Date(entry.lastDateOfExchange)
          : null;

        return {
          updateOne: {
            filter,
            update: {
              $set: {
                ...filter,
                lastDateOfExchange,
              },
            },
            upsert: true,
          },
        };
      });

    if (operations.length > 0) {
      await ExaminerExchangeDate.bulkWrite(operations);
    }

    return res.json({ message: "Exchange dates saved.", count: operations.length });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to save exchange dates.",
    });
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
    const activeTypeDetails = await ResponsibilityType.find({
      name: { $in: ACTIVE_TYPES },
    })
      .select("name submissionDeadline")
      .lean();
    const activeTypeMap = new Map(
      activeTypeDetails.map((type) => [type.name, type])
    );
    const questionMeta = getQuestionReportMeta(
      ACTIVE_TYPES.map((name) => activeTypeMap.get(name) || { name }),
      displayYear
    );

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
    doc.text(questionMeta.title || "Yearly Responsibility Report", pageWidth / 2, 30, {
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
        textColor: [15, 23, 42],
        lineColor: [71, 85, 105],
        lineWidth: 0.4,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [245, 205, 121],
        textColor: 20,
        lineColor: [71, 85, 105],
        lineWidth: 0.5,
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
        drawReportFooter(doc, data.pageNumber);
      },
      margin: { bottom: 46 },
    });
    drawSubmissionMessage(doc, questionMeta.submissionMessage);

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
  const {
    year,
    typeId,
    typeIds,
    reportType,
    branchId,
    classId,
    classIds,
    lastDateOfExchange,
    exchangeDateMap,
  } = req.query;
  if (reportType === "YEARLY_SUMMARY")
    return exportCampusWiseYearlyPDF(req, res);

  try {
    const selectedTypeIds = parseObjectIdList(typeIds || typeId);
    const selectedClassIds = parseObjectIdList(classIds || classId);
    const selectedTypeDetails = selectedTypeIds.length
      ? (
          await ResponsibilityType.find({ _id: { $in: selectedTypeIds } })
            .select("name submissionDeadline")
            .sort({ name: 1 })
            .lean()
        )
      : [];
    const selectedTypeNames = selectedTypeDetails.map((type) => type.name);
    const responsibilityName = selectedTypeNames.length
      ? selectedTypeNames.join(", ")
      : "All Duty Types";
    const parsedExchangeDateMap = parseExchangeDateMap(exchangeDateMap);
    const questionMeta = getQuestionReportMeta(selectedTypeDetails, year);

    if (reportType === "UNASSIGNED_TEACHERS") {
      const selectedClassDetails = selectedClassIds.length
        ? await Class.find({ _id: { $in: selectedClassIds } })
            .select("name")
            .sort({ level: 1, name: 1 })
            .lean()
        : [];
      const classLabel = selectedClassDetails.length
        ? selectedClassDetails.map((item) => item.name).join(", ")
        : "All routine classes";
      const pseudoReq = {
        user: req.user,
        query: {
          ...req.query,
          reportType: "UNASSIGNED_TEACHERS",
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

      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.text("Unassigned Teachers Report", pageWidth / 2, 36, {
        align: "center",
      });
      doc.setFontSize(10);
      const reportTypes = [
        ...new Set(
          rawData
            .flatMap((item) => (item.MISSING_DUTIES || "").split(","))
            .map((item) => item.trim())
            .filter(Boolean)
        ),
      ];
      doc.text(
        `Year: ${year} | Type: ${
          reportTypes.length ? reportTypes.join(", ") : responsibilityName
        } | Class: ${classLabel}`,
        pageWidth / 2,
        52,
        { align: "center" }
      );

      doc.autoTable({
        startY: 70,
        head: [
          [
            "S.L.",
            "Teacher ID",
            "Teacher",
            "Campus",
            "Year",
            "Class",
            "Missing Duties",
          ],
        ],
        body: rawData.map((item, index) => [
          index + 1,
          item.TEACHERID,
          item.TEACHER?.toUpperCase?.() || item.TEACHER || "N/A",
          item.CAMPUS,
          item.YEAR,
          item.CLASSES || "N/A",
          item.MISSING_DUTIES,
        ]),
        theme: "grid",
        headStyles: {
          fillColor: [30, 58, 138],
          textColor: 255,
          lineColor: [71, 85, 105],
          lineWidth: 0.5,
        },
        styles: {
          fontSize: 8,
          overflow: "linebreak",
          textColor: [15, 23, 42],
          lineColor: [71, 85, 105],
          lineWidth: 0.4,
        },
        margin: { bottom: 46 },
        didDrawPage: (data) => {
          drawReportFooter(doc, data.pageNumber);
        },
      });

      res.setHeader("Content-Type", "application/pdf");
      return res.send(Buffer.from(doc.output("arraybuffer")));
    }

    if (reportType === "INACTIVE_NO_ROUTINE") {
      const pseudoReq = {
        user: req.user,
        query: {
          ...req.query,
          reportType: "INACTIVE_NO_ROUTINE",
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

      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.text("Teachers Without Routine", pageWidth / 2, 36, {
        align: "center",
      });
      doc.setFontSize(10);
      doc.text(`Year: ${year}`, pageWidth / 2, 52, { align: "center" });

      doc.autoTable({
        startY: 70,
        head: [
          [
            "S.L.",
            "Teacher ID",
            "Teacher",
            "Campus",
            "Year",
            "Status",
            "Routine",
          ],
        ],
        body: ArrayOfData(rawData)
          ? rawData.map((item, index) => [
              index + 1,
              item.TEACHERID,
              item.TEACHER?.toUpperCase?.() || item.TEACHER || "N/A",
              item.CAMPUS,
              item.YEAR,
              item.STATUS,
              item.ROUTINE_STATUS,
            ])
          : [
              [
                "-",
                "-",
                "No teachers without routine found",
                "-",
                year,
                "-",
                "-",
              ],
            ],
        theme: "grid",
        headStyles: {
          fillColor: [30, 58, 138],
          textColor: 255,
          lineColor: [71, 85, 105],
          lineWidth: 0.5,
        },
        styles: {
          fontSize: 8,
          overflow: "linebreak",
          textColor: [15, 23, 42],
          lineColor: [71, 85, 105],
          lineWidth: 0.4,
        },
        margin: { bottom: 46 },
        didDrawPage: (data) => {
          drawReportFooter(doc, data.pageNumber);
        },
      });

      res.setHeader("Content-Type", "application/pdf");
      return res.send(Buffer.from(doc.output("arraybuffer")));
    }

    const pseudoReq = {
      user: req.user,
      query: {
        ...req.query,
        reportType: "DETAILED_ASSIGNMENT",
        status: "Assigned",
        typeId: selectedTypeIds.length > 0 ? "" : typeId,
        typeIds: selectedTypeIds.length > 0 ? selectedTypeIds.join(",") : "",
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
    rawData.sort((a, b) => {
      const aClassIdx = CLASS_ORDER.indexOf(a.CLASS?.toUpperCase());
      const bClassIdx = CLASS_ORDER.indexOf(b.CLASS?.toUpperCase());
      if (aClassIdx !== bClassIdx)
        return (
          (aClassIdx === -1 ? 999 : aClassIdx) -
          (bClassIdx === -1 ? 999 : bClassIdx)
        );

      const aSubIdx = getExaminerSubjectRank(a.CLASS, a.SUBJECT);
      const bSubIdx = getExaminerSubjectRank(b.CLASS, b.SUBJECT);
      if (aSubIdx !== bSubIdx)
        return aSubIdx - bSubIdx;

      return a.TEACHER.localeCompare(b.TEACHER);
    });

    const shouldUseExaminerClassReport =
      reportType === "EXPORT_CLASS_DETAILED" &&
      selectedTypeDetails.length > 0 &&
      selectedTypeDetails.every((type) =>
        isExaminerResponsibilityType(type.name)
      );
    const shouldUseExaminerCampusHeading =
      reportType === "EXPORT_BRANCH_DETAILED" &&
      selectedTypeDetails.length > 0 &&
      selectedTypeDetails.every((type) =>
        isExaminerResponsibilityType(type.name)
      );

    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
    if (shouldUseExaminerClassReport) {
      const savedExchangeDateMap = await getSavedExchangeDateMap({
        year,
        rows: rawData,
      });
      drawExaminerClassWiseReport({
        doc,
        rawData,
        selectedTypeDetails,
        year,
        lastDateOfExchange,
        exchangeDateMap: {
          ...savedExchangeDateMap,
          ...parsedExchangeDateMap,
        },
      });

      res.setHeader("Content-Type", "application/pdf");
      return res.send(Buffer.from(doc.output("arraybuffer")));
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const reportHeaderLine = await getDetailedReportHeaderLine({
      reportType,
      branchId,
      classId,
    });
    doc.setFontSize(14);
    doc.text(
      shouldUseExaminerCampusHeading
        ? "List of Examiner & Scrutinizer"
        : questionMeta.title || "Detailed Report",
      pageWidth / 2,
      36,
      { align: "center" }
    );
    doc.setFontSize(10);
    const subtitleText = shouldUseExaminerCampusHeading
      ? [getExaminerExamName(selectedTypeDetails, year), reportHeaderLine]
          .filter(Boolean)
          .join("\n")
      : reportHeaderLine || `Year: ${year} | Type: ${responsibilityName}`;
    const subtitleLines = doc.splitTextToSize(subtitleText, pageWidth - 80);
    doc.text(subtitleLines, pageWidth / 2, 52, { align: "center" });

    doc.autoTable({
      startY: 58 + subtitleLines.length * 10,
      head: [["S.L.", "DUTY TYPE", "CLASS", "SUBJECT", "TEACHER", "CAMPUS"]],
      body: rawData.map((item, index) => [
        index + 1,
        item.RESPONSIBILITY_TYPE,
        item.CLASS,
        item.SUBJECT,
        item.TEACHER.toUpperCase(),
        item.CAMPUS,
      ]),
      theme: "grid",
      headStyles: {
        fillColor: [30, 58, 138],
        textColor: 255,
        lineColor: [71, 85, 105],
        lineWidth: 0.5,
      },
      styles: {
        textColor: [15, 23, 42],
        lineColor: [71, 85, 105],
        lineWidth: 0.4,
      },
      margin: { bottom: 46 },
      didDrawPage: (data) => {
        drawReportFooter(doc, data.pageNumber);
      },
    });
    drawSubmissionMessage(doc, questionMeta.submissionMessage);

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
        drawReportFooter(doc, data.pageNumber);
      },
      margin: { bottom: 46 }, // ফুটারের জন্য জায়গা রাখা
    });

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
  getExaminerExchangeDates,
  saveExaminerExchangeDates,
  exportCustomReportToPDF,
  exportCampusWiseYearlyPDF,
  exportCampusRoutinePDF,
};
