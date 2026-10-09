const mongoose = require("mongoose");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const ExaminerExchangeDate = require("../models/ExaminerExchangeDateModel");
const ExaminerPairOrder = require("../models/ExaminerPairOrderModel");
const Routine = require("../models/RoutineModel");
const Branch = require("../models/BranchModel");
const Class = require("../models/ClassModel");
const Subject = require("../models/SubjectModel");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");

// Ensure Teacher model exists
const Teacher = require("../models/TeacherModel"); // adjust path if needed
const {
  getUniformBodyStyles,
  getUniformTableStyles,
  withUniformHeadStyles,
  createUniformRowDidParseCell,
} = require("../utils/pdfTableRows");
const {
  BRAND,
  INSTITUTE_NAME,
  drawProfessionalReportHeader,
} = require("../utils/reportBranding");

const ArrayOfData = (data) => Array.isArray(data) && data.length > 0;

const formatPhoneWithLeadingZero = (phone) => {
  if (phone === null || phone === undefined || phone === "") return "N/A";
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return "N/A";
  return digits.startsWith("0") ? digits : `0${digits}`;
};

// Responsibility type labels expected in yearly pivot (must match responsibility-types.name)
const RESPONSIBILITY_TYPES = [
  "Q-HY",
  "E-HY",
  "Q-Pre-Test",
  "E-Pre-Test",
  "Q-Test",
  "E-Test",
  "Q-Annual",
  "E-Annual",
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
  } catch (e) { }
  return null;
};

const parseObjectIdList = (value) =>
  (value || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

const parseYearList = (value) =>
  [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((part) => parseInt(String(part).trim(), 10))
        .filter((year) => Number.isFinite(year) && year >= 2000 && year <= 2100)
    ),
  ].sort((a, b) => a - b);

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

/** E-Test → S-Test, E-Pre-Test → S-Pre-Test, etc. */
const getPairedScrutinizerDutyName = (examinerDutyName = "") => {
  const name = String(examinerDutyName || "").trim();
  if (!/^E[\s_-]*/i.test(name)) return null;
  return name.replace(/^E/i, "S");
};

const getClassSubjectNameKey = (className = "", subjectName = "") =>
  `${normalizeReportLabel(className)}|||${normalizeSubjectName(subjectName)}`;

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
  PRIMARY: [
    "BENGALI",
    "ENGLISH",
    "G.MATH",
    "MATH",
    "R.EDN",
    "BGS",
    "G.SCIENCE",
    "SCIENCE",
  ],
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
    "MATH",
    "R.EDN",
    "BGS",
    "PHYSICS",
    "CHEMISTRY",
    "H.MATH",
    "BIOLOGY",
    "ACCOUNTING",
    "B.ENT",
    "FINANCE & BANKING",
    "SCIENCE",
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

/** Nine/Ten ICT, Agriculture, H.Science: Examiner + Scrutinizer only (no senior/junior). */
const isExaminerScrutinizerPair = (className = "", subjectName = "") =>
  isSeniorExaminerClass(className) && isSeniorScrutinizerSubject(subjectName);

const getJoiningDateValue = (row = {}) => {
  if (!row.JOINING_DATE) return null;
  const date = new Date(row.JOINING_DATE);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const compareExaminerTeachersNeutral = (a = {}, b = {}) => {
  const idCompare = String(a.TEACHERID || "").localeCompare(
    String(b.TEACHERID || ""),
    undefined,
    { numeric: true, sensitivity: "base" }
  );
  if (idCompare !== 0) return idCompare;
  return (a.TEACHER || "").localeCompare(b.TEACHER || "");
};

/** Senior first via joiningDate — skipped for Examiner/Scrutinizer subjects. */
const compareExaminerTeachers = (a = {}, b = {}, { skipSeniority = false } = {}) => {
  if (!skipSeniority) {
    const aJoin = getJoiningDateValue(a);
    const bJoin = getJoiningDateValue(b);
    if (aJoin !== null && bJoin !== null && aJoin !== bJoin) return aJoin - bJoin;
    if (aJoin !== null && bJoin === null) return -1;
    if (aJoin === null && bJoin !== null) return 1;
  }
  return compareExaminerTeachersNeutral(a, b);
};

const sortSubjectExaminerRows = (
  rows = [],
  teacherOrder = [],
  { className = "", subjectName = "" } = {}
) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const skipSeniority = isExaminerScrutinizerPair(className, subjectName);
  const compare = (a, b) =>
    compareExaminerTeachers(a, b, { skipSeniority });

  const ordered = [...rows];
  if (Array.isArray(teacherOrder) && teacherOrder.length > 0) {
    const rank = new Map(
      teacherOrder.map((id, index) => [String(id), index])
    );
    ordered.sort((a, b) => {
      const aRank = rank.has(String(a.TEACHER_REF_ID))
        ? rank.get(String(a.TEACHER_REF_ID))
        : Number.MAX_SAFE_INTEGER;
      const bRank = rank.has(String(b.TEACHER_REF_ID))
        ? rank.get(String(b.TEACHER_REF_ID))
        : Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return compare(a, b);
    });
    return ordered;
  }

  ordered.sort(compare);
  return ordered;
};

const compareAssignmentReportRows = (a, b) => {
  const aClassIdx = CLASS_ORDER.indexOf(normalizeReportLabel(a.CLASS));
  const bClassIdx = CLASS_ORDER.indexOf(normalizeReportLabel(b.CLASS));
  if (aClassIdx !== bClassIdx) {
    return (
      (aClassIdx === -1 ? 999 : aClassIdx) -
      (bClassIdx === -1 ? 999 : bClassIdx)
    );
  }

  const aSubIdx = getExaminerSubjectRank(a.CLASS, a.SUBJECT);
  const bSubIdx = getExaminerSubjectRank(b.CLASS, b.SUBJECT);
  if (aSubIdx !== bSubIdx) return aSubIdx - bSubIdx;

  const subjectCompare = (a.SUBJECT || "").localeCompare(b.SUBJECT || "");
  if (subjectCompare !== 0) return subjectCompare;

  return compareExaminerTeachers(a, b, {
    skipSeniority: isExaminerScrutinizerPair(a.CLASS, a.SUBJECT),
  });
};

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

const getSavedPairOrderMap = async ({ year, rows = [] }) => {
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

  const uniqueKeys = [
    ...new Map(
      keys.map((item) => [
        getExchangeDateIdKey(item),
        item,
      ])
    ).values(),
  ];

  const records = await ExaminerPairOrder.find({
    year: selectedYear,
    $or: uniqueKeys.map((item) => ({
      responsibilityType: new mongoose.Types.ObjectId(item.responsibilityType),
      targetClass: new mongoose.Types.ObjectId(item.targetClass),
      targetSubject: new mongoose.Types.ObjectId(item.targetSubject),
    })),
  }).lean();

  return Object.fromEntries(
    records.map((record) => [
      getExchangeDateIdKey(record),
      (record.teacherOrder || []).map((id) => String(id)),
    ])
  );
};

const indexRowsByClassSubject = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = getClassSubjectNameKey(row.CLASS, row.SUBJECT);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
};

const buildExaminerPairRow = ({
  subjectName,
  first = {},
  second = {},
  exchangeDate = "",
  rowSpan = 1,
  isFirstRow = true,
}) => {
  let rowArray;
  if (isFirstRow) {
    rowArray = [
      { content: subjectName, rowSpan, styles: { valign: "middle" } },
      first.TEACHER?.toUpperCase?.() || first.TEACHER || "",
      first.CAMPUS || "",
      "",
      formatExchangeDate(exchangeDate),
      second.TEACHER?.toUpperCase?.() || second.TEACHER || "",
      second.CAMPUS || "",
      "",
    ];
  } else {
    rowArray = [
      first.TEACHER?.toUpperCase?.() || first.TEACHER || "",
      first.CAMPUS || "",
      "",
      "",
      second.TEACHER?.toUpperCase?.() || second.TEACHER || "",
      second.CAMPUS || "",
      "",
    ];
  }
  rowArray._subjectName = subjectName;
  return rowArray;
};

const buildExaminerReportBody = ({
  rows = [],
  scrutinizerRows = [],
  lastDateOfExchange = "",
  exchangeDateMap = {},
  pairOrderMap = {},
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

  // Also include scrutinizer-only subjects (S-* assigned but no E-* yet)
  scrutinizerRows.forEach((row) => {
    if (!isExaminerScrutinizerPair(row.CLASS, row.SUBJECT)) return;
    const className = row.CLASS || "N/A";
    const subjectName = row.SUBJECT || "N/A";
    if (!grouped.has(className)) grouped.set(className, new Map());
    const subjectMap = grouped.get(className);
    if (!subjectMap.has(subjectName)) subjectMap.set(subjectName, []);
  });

  const scrutinizerBySubject = indexRowsByClassSubject(scrutinizerRows);
  const sections = [];

  grouped.forEach((subjectMap, className) => {
    const body = [];
    subjectMap.forEach((subjectRows, subjectName) => {
      const referenceRow = subjectRows[0] || scrutinizerBySubject.get(
        getClassSubjectNameKey(className, subjectName)
      )?.[0] || {};
      const orderKey = getExchangeDateIdKey({
        responsibilityType: referenceRow.RESPONSIBILITY_TYPE_ID,
        targetClass: referenceRow.CLASS_ID,
        targetSubject: referenceRow.SUBJECT_ID,
      });
      const exchangeDate =
        exchangeDateMap[orderKey] ||
        exchangeDateMap[getExchangeDateKey(className, subjectName)] ||
        lastDateOfExchange;

      // Nine/Ten ICT, Agriculture, H.Science:
      // Examiner from E-*, Scrutinizer from paired S-* (S-Test / S-Pre-Test)
      if (isExaminerScrutinizerPair(className, subjectName)) {
        const examiners = sortSubjectExaminerRows(
          subjectRows,
          pairOrderMap[orderKey] || [],
          { className, subjectName }
        );
        const scrutinizers = sortSubjectExaminerRows(
          scrutinizerBySubject.get(
            getClassSubjectNameKey(className, subjectName)
          ) || [],
          [],
          { className, subjectName }
        );
        const pairCount = Math.max(examiners.length, scrutinizers.length, 1);

        for (let i = 0; i < pairCount; i += 1) {
          body.push(
            buildExaminerPairRow({
              subjectName,
              first: examiners[i] || {},
              second: scrutinizers[i] || {},
              exchangeDate,
              rowSpan: pairCount,
              isFirstRow: i === 0,
            })
          );
        }
        return;
      }

      const orderedRows = sortSubjectExaminerRows(
        subjectRows,
        pairOrderMap[orderKey] || [],
        { className, subjectName }
      );
      const rowSpan = Math.ceil(orderedRows.length / 2) || 1;

      for (let i = 0; i < orderedRows.length; i += 2) {
        body.push(
          buildExaminerPairRow({
            subjectName,
            first: orderedRows[i] || {},
            second: orderedRows[i + 1] || {},
            exchangeDate,
            rowSpan,
            isFirstRow: i === 0,
          })
        );
      }
    });

    sections.push({ className, body });
  });

  return sections;
};

const EXAMINER_TABLE_COLUMN_WIDTHS = [58, 92, 54, 46, 68, 92, 54, 46];

const drawExaminerClassWiseReport = ({
  doc,
  rawData,
  scrutinizerData = [],
  selectedTypeDetails,
  year,
  lastDateOfExchange,
  exchangeDateMap,
  pairOrderMap = {},
}) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const examName = getExaminerExamName(selectedTypeDetails, year);
  const sections = buildExaminerReportBody({
    rows: rawData,
    scrutinizerRows: scrutinizerData,
    lastDateOfExchange,
    exchangeDateMap,
    pairOrderMap,
  });

  const contentStartY = drawProfessionalReportHeader(doc, {
    title: "List of Examiner & Scrutinizer",
    subtitle: examName,
    y: 14,
    preferredWidth: 250,
  });

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
          "Campus /\nShift",
          "Signature",
          "Last Date of\nExchange",
          secondPersonLabel,
          "Campus /\nShift",
          "Signature",
        ],
      ],
      body: rows,
      theme: "grid",
      tableWidth: pageWidth - 80,
      styles: getUniformTableStyles({
        fontSize: 9,
        textColor: [15, 23, 42],
        lineColor: [71, 85, 105],
        lineWidth: 0.4,
      }),
      bodyStyles: getUniformBodyStyles(),
      headStyles: withUniformHeadStyles({
        fillColor: [255, 255, 255],
        textColor: [15, 23, 42],
        lineColor: [71, 85, 105],
        lineWidth: 0.5,
        fontStyle: "bold",
        fontSize: 8.5,
      }),
      columnStyles: {
        0: { cellWidth: EXAMINER_TABLE_COLUMN_WIDTHS[0], fontSize: 8.5 },
        1: { cellWidth: EXAMINER_TABLE_COLUMN_WIDTHS[1] },
        2: { cellWidth: EXAMINER_TABLE_COLUMN_WIDTHS[2], fontSize: 8.5 },
        3: { cellWidth: EXAMINER_TABLE_COLUMN_WIDTHS[3] },
        4: {
          cellWidth: EXAMINER_TABLE_COLUMN_WIDTHS[4],
          halign: "left",
        },
        5: { cellWidth: EXAMINER_TABLE_COLUMN_WIDTHS[5] },
        6: { cellWidth: EXAMINER_TABLE_COLUMN_WIDTHS[6], fontSize: 8.5 },
        7: { cellWidth: EXAMINER_TABLE_COLUMN_WIDTHS[7] },
      },
      margin: { top: 48, left: 40, right: 40, bottom: 46 },
      didParseCell: createUniformRowDidParseCell(doc, {
        fontSize: 9,
        columnWidths: EXAMINER_TABLE_COLUMN_WIDTHS,
        columnMaxLines: { 1: 2, 2: 2, 4: 2, 5: 2, 6: 2 },
        fitHead: true,
        maxLines: 2,
      }),
      didDrawPage: (data) => {
        drawReportFooter(doc, data.pageNumber);
      },
    });

    return (doc.lastAutoTable?.finalY || startY) + 12;
  };

  let startY = contentStartY + 6;
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
        (row) => !isSeniorScrutinizerSubject(row._subjectName)
      );
      const scrutinizerRows = section.body.filter((row) =>
        isSeniorScrutinizerSubject(row._subjectName)
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
    return branch?.name ? `Campus/Shift: ${branch.name}` : "";
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
      years,
      typeId,
      typeIds,
      classId,
      classIds,
      status,
      reportType,
      branchId,
      subjectId,
      subjectIds,
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
      const selectedYears = parseYearList(years || year);

      if (
        selectedYears.length === 0 ||
        selectedTypeIds.length === 0 ||
        selectedClassIds.length === 0
      ) {
        return res.status(400).json({
          message:
            "At least one year, one duty type, and one class are required for unassigned report.",
        });
      }

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

      // Candidates: teachers with routine in selected classes in ANY selected year.
      // A year with no data is treated as unassigned.
      // Keep only teachers who are unassigned in EVERY selected year (AND).
      const selectedClassIdSet = new Set(
        selectedClassIds.map((id) => String(id))
      );
      const assignedByYear = new Map(
        selectedYears.map((selectedYear) => [selectedYear, new Set()])
      );
      const candidateTeachers = new Map();

      for (const selectedYear of selectedYears) {
        const routineLookupPipeline = [
          {
            $match: {
              $expr: { $eq: ["$teacher", "$$teacherId"] },
            },
          },
          { $unwind: "$years" },
          { $match: { "years.year": selectedYear } },
          { $unwind: "$years.assignments" },
          {
            $match: {
              "years.assignments.className": { $in: selectedClassIds },
            },
          },
          {
            $group: {
              _id: "$teacher",
              classIds: { $addToSet: "$years.assignments.className" },
            },
          },
        ];

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
            $unwind: {
              path: "$campusDetails",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 0,
              teacherKey: { $toString: "$_id" },
              TEACHERID: "$teacherId",
              TEACHER: "$name",
              CAMPUS: { $ifNull: ["$campusDetails.name", "N/A"] },
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
        ];

        const data = await Teacher.aggregate(pipeline).allowDiskUse(true);
        const yearAssigned = assignedByYear.get(selectedYear);

        data.forEach((item) => {
          const routineClasses = (item.routineClasses || []).filter(
            (routineClass) => selectedClassIdSet.has(routineClass.id)
          );
          if (routineClasses.length === 0) return;

          const existing = candidateTeachers.get(item.teacherKey) || {
            TEACHERID: item.TEACHERID,
            TEACHER: item.TEACHER,
            CAMPUS: item.CAMPUS,
            classNames: new Set(),
          };
          routineClasses.forEach((routineClass) =>
            existing.classNames.add(routineClass.name)
          );
          candidateTeachers.set(item.teacherKey, existing);

          const assignments = item.matchingAssignments || [];
          const isAssignedThisYear = selectedTypeMeta.some((type) => {
            if (!type.requiresClassSubject) {
              return assignments.some(
                (assignment) => assignment.responsibilityType === type.id
              );
            }

            return assignments.some(
              (assignment) =>
                assignment.responsibilityType === type.id &&
                assignment.targetClass &&
                selectedClassIdSet.has(assignment.targetClass)
            );
          });

          if (isAssignedThisYear) {
            yearAssigned.add(item.teacherKey);
          }
        });
      }

      // Also mark teachers assigned in a year even if they have no routine that year
      // (assignment alone counts as assigned data for that year).
      const assignmentOnlyRows = await ResponsibilityAssignment.find({
        year: { $in: selectedYears },
        responsibilityType: { $in: selectedTypeIds },
        status: { $ne: "Cancelled" },
        $or: [
          { targetClass: { $in: selectedClassIds } },
          { targetClass: null },
          { targetClass: { $exists: false } },
        ],
      })
        .select("teacher year responsibilityType targetClass")
        .lean();

      const classRequiredTypeIds = new Set(
        selectedTypeMeta
          .filter((type) => type.requiresClassSubject)
          .map((type) => type.id)
      );
      const nonClassTypeIds = new Set(
        selectedTypeMeta
          .filter((type) => !type.requiresClassSubject)
          .map((type) => type.id)
      );

      assignmentOnlyRows.forEach((assignment) => {
        const teacherKey = String(assignment.teacher);
        const typeId = String(assignment.responsibilityType);
        const targetClassId = assignment.targetClass
          ? String(assignment.targetClass)
          : null;
        const yearAssigned = assignedByYear.get(assignment.year);
        if (!yearAssigned) return;

        const matchesClassDuty =
          classRequiredTypeIds.has(typeId) &&
          targetClassId &&
          selectedClassIdSet.has(targetClassId);
        const matchesNonClassDuty = nonClassTypeIds.has(typeId);

        if (matchesClassDuty || matchesNonClassDuty) {
          yearAssigned.add(teacherKey);
        }
      });

      const yearLabel = selectedYears.join(", ");
      const missingDutiesLabel = selectedTypeMeta
        .map((type) => type.name)
        .sort((a, b) => a.localeCompare(b))
        .join(", ");

      const mergedRows = [];
      candidateTeachers.forEach((teacherRow, teacherKey) => {
        // Missing year data => unassigned for that year.
        const isUnassignedInAllYears = selectedYears.every(
          (selectedYear) => !assignedByYear.get(selectedYear).has(teacherKey)
        );
        if (!isUnassignedInAllYears) return;

        mergedRows.push({
          TEACHERID: teacherRow.TEACHERID,
          TEACHER: teacherRow.TEACHER,
          CAMPUS: teacherRow.CAMPUS,
          YEAR: yearLabel,
          CLASSES: [...teacherRow.classNames]
            .sort((a, b) => a.localeCompare(b))
            .join(", "),
          MISSING_DUTIES: missingDutiesLabel,
        });
      });

      const formatted = mergedRows
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

    if (reportType === "SUBJECT_WISE_TEACHERS") {
      const selectedSubjectIds = parseObjectIdList(subjectIds || subjectId);
      const selectedTypeIds = parseObjectIdList(typeIds || typeId);

      if (!year || selectedSubjectIds.length === 0) {
        return res.status(400).json({
          message:
            "Year and at least one subject are required for subject-wise teacher report.",
        });
      }

      const selectedYear = parseInt(year, 10);
      const match = {
        year: selectedYear,
        targetSubject: { $in: selectedSubjectIds },
        status: status || "Assigned",
      };

      if (selectedTypeIds.length > 0) {
        match.responsibilityType = { $in: selectedTypeIds };
      }

      if (classId && mongoose.Types.ObjectId.isValid(classId)) {
        match.targetClass = new mongoose.Types.ObjectId(classId);
      }

      const pipeline = [
        { $match: match },
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
      ];

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
          $unwind: { path: "$subjectDetails", preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            _id: 0,
            ID: { $literal: 0 },
            SUBJECT: { $ifNull: ["$subjectDetails.name", "N/A"] },
            CLASS: { $ifNull: ["$classDetails.name", "N/A"] },
            CLASS_LEVEL: { $ifNull: ["$classDetails.level", 999] },
            RESPONSIBILITY_TYPE: { $ifNull: ["$typeDetails.name", "N/A"] },
            TEACHER: { $ifNull: ["$teacherDetails.name", "N/A"] },
            TEACHERID: { $ifNull: ["$teacherDetails.teacherId", "N/A"] },
            PHONE: { $ifNull: ["$teacherDetails.phone", "N/A"] },
            CAMPUS: { $ifNull: ["$branchDetails.name", "N/A"] },
            YEAR: { $literal: selectedYear },
          },
        },
        {
          $sort: {
            CLASS_LEVEL: 1,
            CLASS: 1,
            SUBJECT: 1,
            RESPONSIBILITY_TYPE: 1,
            TEACHER: 1,
          },
        }
      );

      const data = await ResponsibilityAssignment.aggregate(pipeline).allowDiskUse(
        true
      );
      const formatted = data.map((item, idx) => {
        const { CLASS_LEVEL, ...row } = item;
        return {
          ...row,
          ID: idx + 1,
          PHONE: formatPhoneWithLeadingZero(item.PHONE),
        };
      });
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
    const selectedSubjectIds = parseObjectIdList(subjectIds);
    if (selectedSubjectIds.length > 0) {
      filter.targetSubject = { $in: selectedSubjectIds };
    } else if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
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
          TEACHER_REF_ID: {
            $cond: [
              { $ifNull: ["$teacherDetails._id", false] },
              { $toString: "$teacherDetails._id" },
              "",
            ],
          },
          JOINING_DATE: "$teacherDetails.joiningDate",
        },
      });
      pipeline.push({ $sort: { CLASS: 1, TEACHER: 1 } });

      const data = await ResponsibilityAssignment.aggregate(
        pipeline
      ).allowDiskUse(true);
      const formatted = data
        .sort(compareAssignmentReportRows)
        .map((item, idx) => ({ ...item, ID: idx + 1 }));
      return res.json(formatted);
    } else {
      const assignments = await ResponsibilityAssignment.find(filter)
        .populate("teacher", "name teacherId campus joiningDate")
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
        TEACHER_REF_ID: a.teacher?._id?.toString() || "",
        JOINING_DATE: a.teacher?.joiningDate || null,
      }))
        .sort(compareAssignmentReportRows)
        .map((item, idx) => ({ ...item, ID: idx + 1 }));
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

const getExaminerPairOrders = async (req, res) => {
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

    const records = await ExaminerPairOrder.find(filter).lean();
    return res.json(
      records.map((record) => ({
        key: getExchangeDateIdKey(record),
        year: record.year,
        responsibilityType: record.responsibilityType,
        targetClass: record.targetClass,
        targetSubject: record.targetSubject,
        teacherOrder: (record.teacherOrder || []).map((id) => String(id)),
      }))
    );
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch examiner pair orders.",
    });
  }
};

const saveExaminerPairOrders = async (req, res) => {
  try {
    const { year, entries = [] } = req.body;
    const selectedYear = parseInt(year, 10);

    if (!selectedYear || !Array.isArray(entries)) {
      return res.status(400).json({ message: "Invalid pair order payload." });
    }

    const operations = entries
      .filter(
        (entry) =>
          mongoose.Types.ObjectId.isValid(entry.responsibilityType) &&
          mongoose.Types.ObjectId.isValid(entry.targetClass) &&
          mongoose.Types.ObjectId.isValid(entry.targetSubject) &&
          Array.isArray(entry.teacherOrder) &&
          entry.teacherOrder.length > 0 &&
          entry.teacherOrder.every((id) => mongoose.Types.ObjectId.isValid(id))
      )
      .map((entry) => {
        const filter = {
          year: selectedYear,
          responsibilityType: new mongoose.Types.ObjectId(
            entry.responsibilityType
          ),
          targetClass: new mongoose.Types.ObjectId(entry.targetClass),
          targetSubject: new mongoose.Types.ObjectId(entry.targetSubject),
        };
        const teacherOrder = entry.teacherOrder.map(
          (id) => new mongoose.Types.ObjectId(id)
        );

        return {
          updateOne: {
            filter,
            update: {
              $set: {
                ...filter,
                teacherOrder,
              },
            },
            upsert: true,
          },
        };
      });

    if (operations.length > 0) {
      await ExaminerPairOrder.bulkWrite(operations);
    }

    return res.json({
      message: "Examiner pair orders saved.",
      count: operations.length,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to save examiner pair orders.",
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

  const ACTIVE_TYPES = selectedTypes
    ? selectedTypes.split(",")
    : [...RESPONSIBILITY_TYPES];

  ACTIVE_TYPES.sort((a, b) => {
    let indexA = RESPONSIBILITY_TYPES.indexOf(a);
    let indexB = RESPONSIBILITY_TYPES.indexOf(b);
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    return indexA - indexB;
  });

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
    const head = [["Sl", "Shift", "Teacher's Name", "Year", ...ACTIVE_TYPES]];

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
    const headerStartY = drawProfessionalReportHeader(doc, {
      title: questionMeta.title || "Yearly Responsibility Report",
      subtitleLines: [
        `Campus: ${displayCampus}`,
        `Academic Year: ${displayYear}`,
      ],
      y: 40,
    });

    const yearlyFontSize = ACTIVE_TYPES.length > 8 ? 6 : 7.5;
    const yearlyColumnWidths = {
      0: 28,
      1: 70,
      2: 100,
      3: 35,
    };

    // 5. Render Table
    doc.autoTable({
      startY: headerStartY + 4,
      head,
      body,
      theme: "grid",
      tableWidth: pageWidth - 80,
      styles: getUniformTableStyles({
        fontSize: yearlyFontSize,
        textColor: [15, 23, 42],
        lineColor: [71, 85, 105],
        lineWidth: 0.4,
      }),
      bodyStyles: getUniformBodyStyles(),
      headStyles: withUniformHeadStyles({
        fillColor: [245, 205, 121],
        textColor: 20,
        lineColor: [71, 85, 105],
        lineWidth: 0.5,
        fontStyle: "bold",
        halign: "center",
      }),
      columnStyles: {
        0: { cellWidth: yearlyColumnWidths[0], halign: "center" },
        1: { cellWidth: yearlyColumnWidths[1] },
        2: { cellWidth: yearlyColumnWidths[2] },
        3: { cellWidth: yearlyColumnWidths[3], halign: "center" },
      },
      didParseCell: createUniformRowDidParseCell(doc, {
        fontSize: yearlyFontSize,
        columnWidths: yearlyColumnWidths,
        columnMaxLines: { 2: 2 },
        beforeParse: (data) => {
          if (data.section === "body" && isComparing) {
            if (data.row.index % 2 === 0 && data.column.index <= 2) {
              data.cell.rowSpan = 2;
            }
          }
        },
      }),
      didDrawPage: (data) => {
        drawReportFooter(doc, data.pageNumber);
      },
      margin: { top: 48, left: 40, right: 40, bottom: 46 },
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
        : "Selected classes";
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
        send: () => { },
      };
      await getReportData(pseudoReq, pseudoRes);

      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const reportTypes = [
        ...new Set(
          rawData
            .flatMap((item) => (item.MISSING_DUTIES || "").split(","))
            .map((item) => item.trim())
            .filter(Boolean)
        ),
      ];
      const yearLabel = parseYearList(req.query.years || year).join(", ") || year;
      const headerStartY = drawProfessionalReportHeader(doc, {
        title: "Unassigned Teachers Report",
        subtitle: `Year(s): ${yearLabel} | Type: ${
          reportTypes.length ? reportTypes.join(", ") : responsibilityName
        } | Class: ${classLabel}`,
      });

      doc.autoTable({
        startY: headerStartY + 4,
        head: [
          [
            "S.L.",
            "Teacher ID",
            "Teacher",
            "Shift",
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
        headStyles: withUniformHeadStyles({
          fillColor: [30, 58, 138],
          textColor: 255,
          lineColor: [71, 85, 105],
          lineWidth: 0.5,
        }),
        styles: getUniformTableStyles({
          fontSize: 8,
          textColor: [15, 23, 42],
          lineColor: [71, 85, 105],
          lineWidth: 0.4,
        }),
        bodyStyles: getUniformBodyStyles(),
        columnStyles: {
          0: { cellWidth: 28, halign: "center" },
          1: { cellWidth: 62 },
          2: { cellWidth: 130 },
          3: { cellWidth: 72 },
          4: { cellWidth: 38, halign: "center" },
          5: { cellWidth: 55 },
          6: { cellWidth: 130 },
        },
        didParseCell: createUniformRowDidParseCell(doc, {
          fontSize: 8,
          columnMaxLines: { 2: 2 },
          columnWidths: {
            0: 28,
            1: 62,
            2: 130,
            3: 72,
            4: 38,
            5: 55,
            6: 130,
          },
        }),
        margin: { bottom: 46 },
        didDrawPage: (data) => {
          drawReportFooter(doc, data.pageNumber);
        },
      });

      res.setHeader("Content-Type", "application/pdf");
      return res.send(Buffer.from(doc.output("arraybuffer")));
    }

    if (reportType === "SUBJECT_WISE_TEACHERS") {
      const selectedSubjectIds = parseObjectIdList(
        req.query.subjectIds || req.query.subjectId
      );
      if (!selectedSubjectIds.length) {
        return res.status(400).json({
          message: "Select at least one subject before exporting.",
        });
      }

      const pseudoReq = {
        user: req.user,
        query: {
          ...req.query,
          reportType: "SUBJECT_WISE_TEACHERS",
          subjectIds: selectedSubjectIds.map(String).join(","),
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

      const rows = Array.isArray(rawData) ? rawData : [];
      const selectedSubjectDocs = await Subject.find({
        _id: { $in: selectedSubjectIds },
      })
        .select("name")
        .sort({ name: 1 })
        .lean();

      const subjectsForHeader =
        selectedSubjectDocs.map((item) => item.name).join(", ") ||
        [...new Set(rows.map((item) => item.SUBJECT).filter(Boolean))].join(
          ", "
        ) ||
        "Selected subjects";

      let campusLabel = "All campuses";
      if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
        const branch = await Branch.findById(branchId).select("name").lean();
        if (branch?.name) campusLabel = branch.name;
      }

      const uniqueTeachers = new Set(
        rows
          .map((item) => item.TEACHERID || item.TEACHER)
          .filter((value) => value && value !== "N/A")
      );
      const uniqueSubjects = new Set(
        rows.map((item) => item.SUBJECT).filter(Boolean)
      );
      const classNamesSorted = [
        ...new Set(rows.map((item) => item.CLASS).filter(Boolean)),
      ].sort((a, b) => {
        const aIdx = CLASS_ORDER.indexOf(normalizeReportLabel(a));
        const bIdx = CLASS_ORDER.indexOf(normalizeReportLabel(b));
        const aRank = aIdx === -1 ? 999 : aIdx;
        const bRank = bIdx === -1 ? 999 : bIdx;
        if (aRank !== bRank) return aRank - bRank;
        return String(a).localeCompare(String(b));
      });
      const classesForHeader =
        classNamesSorted.length > 0 ? classNamesSorted.join(", ") : "N/A";
      const dutyTypesForHeader = responsibilityName || "All Duty Types";
      const subjectsLabel = subjectsForHeader || "Selected subjects";
      const teacherCount = uniqueTeachers.size;

      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginX = 36;
      const teal = BRAND.teal;
      const slate = BRAND.navy;
      const muted = BRAND.muted;
      const line = BRAND.line;
      const preparedBy = req.user?.name || "System User";
      const usableWidth = pageWidth - marginX * 2;

      const drawModernFooter = (pageNumber) => {
        doc.setDrawColor(...line);
        doc.setLineWidth(0.5);
        doc.line(marginX, pageHeight - 36, pageWidth - marginX, pageHeight - 36);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...muted);
        doc.text(INSTITUTE_NAME, marginX, pageHeight - 22);
        doc.text(`Page ${pageNumber}`, pageWidth - marginX, pageHeight - 22, {
          align: "right",
        });
      };

      const headerEndY = drawProfessionalReportHeader(doc, {
        y: 14,
        withDivider: true,
        title: "Subject-wise Assigned Teachers",
        subtitleLines: [
          `Academic Year ${year}  ·  ${campusLabel}`,
          "Duty Assignment Register",
        ],
        titleFontSize: 13,
        subtitleFontSize: 9.5,
      });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      doc.text(`Generated: ${getReportGeneratedAt()}`, pageWidth - marginX, 28, {
        align: "right",
      });
      doc.text(`Prepared by: ${preparedBy}`, pageWidth - marginX, 40, {
        align: "right",
      });

      const filterY = headerEndY + 14;
      const filterPadX = 10;
      const filterInnerWidth = usableWidth - filterPadX * 2;
      const colGap = 18;
      const leftColW = filterInnerWidth * 0.48;
      const rightColW = filterInnerWidth - leftColW - colGap;
      const leftX = marginX + filterPadX;
      const rightX = leftX + leftColW + colGap;

      const buildFieldLines = (label, value, maxWidth) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        const labelW = doc.getTextWidth(`${label}: `);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        const valueLines = doc.splitTextToSize(
          String(value),
          Math.max(24, maxWidth - labelW)
        );
        return { labelW, valueLines: valueLines.slice(0, 2) };
      };

      const subjectsField = buildFieldLines("Subjects", subjectsLabel, leftColW);
      const dutyField = buildFieldLines(
        "Duty Type(s)",
        dutyTypesForHeader,
        rightColW
      );
      const teacherField = buildFieldLines(
        "Number of Teachers",
        String(teacherCount),
        leftColW
      );
      const classField = buildFieldLines("Classes", classesForHeader, rightColW);

      const row1H =
        Math.max(subjectsField.valueLines.length, dutyField.valueLines.length) *
        10;
      const row2H =
        Math.max(teacherField.valueLines.length, classField.valueLines.length) *
        10;
      const filterHeight = 22 + row1H + 4 + row2H;

      const drawField = (x, y, label, field) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...muted);
        const labelText = `${label}: `;
        doc.text(labelText, x, y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...slate);
        doc.text(field.valueLines[0] || "", x + field.labelW, y);
        if (field.valueLines.length > 1) {
          doc.text(field.valueLines[1], x, y + 10);
        }
      };

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...line);
      doc.setLineWidth(0.5);
      doc.roundedRect(marginX, filterY, usableWidth, filterHeight, 4, 4, "FD");
      doc.setFillColor(...teal);
      doc.rect(marginX, filterY, 3, filterHeight, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...teal);
      doc.text("FILTERED DATA", leftX, filterY + 10);

      const row1Y = filterY + 21;
      drawField(leftX, row1Y, "Subjects", subjectsField);
      drawField(rightX, row1Y, "Duty Type(s)", dutyField);

      const row2Y = row1Y + row1H + 4;
      drawField(leftX, row2Y, "Number of Teachers", teacherField);
      drawField(rightX, row2Y, "Classes", classField);

      const subjectColumnWidths = {
        0: 26,
        1: 62,
        2: 46,
        3: 62,
        4: 148,
        5: 92,
        6: 87,
      };

      doc.autoTable({
        startY: filterY + filterHeight + 8,
        head: [
          [
            "SL",
            "Subject",
            "Class",
            "Duty Type",
            "Teacher",
            "Phone",
            "Campus",
          ],
        ],
        body: rows.length
          ? rows.map((item, index) => [
              index + 1,
              item.SUBJECT || "N/A",
              item.CLASS || "N/A",
              item.RESPONSIBILITY_TYPE || "N/A",
              item.TEACHER?.toUpperCase?.() || item.TEACHER || "N/A",
              formatPhoneWithLeadingZero(item.PHONE),
              item.CAMPUS || "N/A",
            ])
          : [
              [
                {
                  content: "No assigned teachers found for the selected filters.",
                  colSpan: 7,
                  styles: {
                    halign: "left",
                    fontStyle: "bold",
                    textColor: muted,
                  },
                },
              ],
            ],
        theme: "grid",
        tableWidth: usableWidth,
        margin: { left: marginX, right: marginX, bottom: 48 },
        headStyles: withUniformHeadStyles({
          fillColor: teal,
          textColor: 255,
          fontStyle: "bold",
          fontSize: 8,
          halign: "left",
          lineColor: teal,
          lineWidth: 0.3,
        }),
        styles: getUniformTableStyles({
          fontSize: 8,
          cellPadding: { top: 5, right: 5, bottom: 5, left: 5 },
          textColor: slate,
          lineColor: line,
          lineWidth: 0.35,
          halign: "left",
        }),
        bodyStyles: {
          ...getUniformBodyStyles(28),
          halign: "left",
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: {
            cellWidth: subjectColumnWidths[0],
            halign: "left",
            fontStyle: "bold",
            textColor: teal,
          },
          1: { cellWidth: subjectColumnWidths[1], halign: "left" },
          2: { cellWidth: subjectColumnWidths[2], halign: "left" },
          3: { cellWidth: subjectColumnWidths[3], halign: "left" },
          4: {
            cellWidth: subjectColumnWidths[4],
            fontStyle: "bold",
            halign: "left",
          },
          5: { cellWidth: subjectColumnWidths[5], halign: "left" },
          6: { cellWidth: subjectColumnWidths[6], halign: "left" },
        },
        didParseCell: createUniformRowDidParseCell(doc, {
          rowHeight: 28,
          fontSize: 8,
          cellPadding: 5,
          columnWidths: subjectColumnWidths,
          columnMaxLines: { 1: 2, 3: 2, 4: 2, 5: 1, 6: 2 },
          fitHead: true,
          maxLines: 2,
        }),
        didDrawPage: (data) => {
          drawModernFooter(data.pageNumber);
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
        send: () => { },
      };
      await getReportData(pseudoReq, pseudoRes);

      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const headerStartY = drawProfessionalReportHeader(doc, {
        title: "Teachers Without Routine",
        subtitle: `Year: ${year}`,
      });

      doc.autoTable({
        startY: headerStartY + 4,
        head: [
          [
            "S.L.",
            "Teacher ID",
            "Teacher",
            "Shift",
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
        headStyles: withUniformHeadStyles({
          fillColor: [30, 58, 138],
          textColor: 255,
          lineColor: [71, 85, 105],
          lineWidth: 0.5,
        }),
        styles: getUniformTableStyles({
          fontSize: 8,
          textColor: [15, 23, 42],
          lineColor: [71, 85, 105],
          lineWidth: 0.4,
        }),
        bodyStyles: getUniformBodyStyles(),
        columnStyles: {
          0: { cellWidth: 28, halign: "center" },
          1: { cellWidth: 62 },
          2: { cellWidth: 140 },
          3: { cellWidth: 90 },
          4: { cellWidth: 38, halign: "center" },
          5: { cellWidth: 70 },
          6: { cellWidth: 87 },
        },
        didParseCell: createUniformRowDidParseCell(doc, {
          fontSize: 8,
          columnMaxLines: { 2: 2 },
          columnWidths: {
            0: 28,
            1: 62,
            2: 140,
            3: 90,
            4: 38,
            5: 70,
            6: 87,
          },
        }),
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
      send: () => { },
    };
    await getReportData(pseudoReq, pseudoRes);

    if (!ArrayOfData(rawData))
      return res.status(404).json({ message: "No data found." });

    rawData.sort(compareAssignmentReportRows);

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
      const pairedScrutinizerNames = [
        ...new Set(
          selectedTypeDetails
            .map((type) => getPairedScrutinizerDutyName(type.name))
            .filter(Boolean)
        ),
      ];
      let scrutinizerData = [];
      if (pairedScrutinizerNames.length > 0) {
        const scrutinizerTypes = await ResponsibilityType.find({
          name: { $in: pairedScrutinizerNames },
        })
          .select("_id name")
          .lean();
        const scrutinizerTypeIds = scrutinizerTypes.map((type) =>
          String(type._id)
        );
        if (scrutinizerTypeIds.length > 0) {
          const scrutinizerReq = {
            user: req.user,
            query: {
              ...req.query,
              reportType: "DETAILED_ASSIGNMENT",
              status: "Assigned",
              typeId: "",
              typeIds: scrutinizerTypeIds.join(","),
            },
          };
          const scrutinizerRes = {
            json: (data) => {
              scrutinizerData = Array.isArray(data) ? data : [];
            },
            status: () => scrutinizerRes,
            send: () => {},
          };
          await getReportData(scrutinizerReq, scrutinizerRes);
          scrutinizerData.sort(compareAssignmentReportRows);
        }
      }

      const [savedExchangeDateMap, savedPairOrderMap] = await Promise.all([
        getSavedExchangeDateMap({
          year,
          rows: rawData,
        }),
        getSavedPairOrderMap({
          year,
          rows: rawData,
        }),
      ]);
      drawExaminerClassWiseReport({
        doc,
        rawData,
        scrutinizerData,
        selectedTypeDetails,
        year,
        lastDateOfExchange,
        exchangeDateMap: {
          ...savedExchangeDateMap,
          ...parsedExchangeDateMap,
        },
        pairOrderMap: savedPairOrderMap,
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
    const subtitleText = shouldUseExaminerCampusHeading
      ? [getExaminerExamName(selectedTypeDetails, year), reportHeaderLine]
        .filter(Boolean)
        .join("\n")
      : reportHeaderLine || `Year: ${year} | Type: ${responsibilityName}`;
    const subtitleLines = doc.splitTextToSize(subtitleText, pageWidth - 80);
    const headerStartY = drawProfessionalReportHeader(doc, {
      title: shouldUseExaminerCampusHeading
        ? "List of Examiner & Scrutinizer"
        : questionMeta.title || "Detailed Report",
      subtitleLines,
      y: 40,
    });

    const detailedColumnWidths = {
      0: 28,
      1: 90,
      2: 60,
      3: 80,
      4: 175,
      5: 82,
    };

    doc.autoTable({
      startY: headerStartY + 4,
      head: [["S.L.", "DUTY TYPE", "CLASS", "SUBJECT", "TEACHER", "SHIFT"]],
      body: rawData.map((item, index) => [
        index + 1,
        item.RESPONSIBILITY_TYPE,
        item.CLASS,
        item.SUBJECT,
        item.TEACHER.toUpperCase(),
        item.CAMPUS,
      ]),
      theme: "grid",
      tableWidth: pageWidth - 80,
      headStyles: withUniformHeadStyles({
        fillColor: [30, 58, 138],
        textColor: 255,
        lineColor: [71, 85, 105],
        lineWidth: 0.5,
      }),
      styles: getUniformTableStyles({
        textColor: [15, 23, 42],
        lineColor: [71, 85, 105],
        lineWidth: 0.4,
        fontSize: 8,
      }),
      bodyStyles: getUniformBodyStyles(),
      columnStyles: {
        0: { cellWidth: detailedColumnWidths[0], halign: "center" },
        1: { cellWidth: detailedColumnWidths[1] },
        2: { cellWidth: detailedColumnWidths[2] },
        3: { cellWidth: detailedColumnWidths[3] },
        4: { cellWidth: detailedColumnWidths[4] },
        5: { cellWidth: detailedColumnWidths[5] },
      },
      didParseCell: createUniformRowDidParseCell(doc, {
        fontSize: 8,
        columnWidths: detailedColumnWidths,
        columnMaxLines: { 4: 2 },
      }),
      margin: { top: 48, left: 40, right: 40, bottom: 46 },
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
    const headerStartY = drawProfessionalReportHeader(doc, {
      y: 28,
      title: "Teacher's Academic Routine",
      subtitle: `Campus: ${campusName} | Year: ${selectedYear}`,
      titleFontSize: 14,
    });

    const routineColumnWidths = {
      0: 35,
      1: 72,
      2: 152,
      3: 72,
      4: 108,
    };

    doc.autoTable({
      startY: headerStartY + 4,
      head: [["SL", "Shift", "Name", "Class", "Subject"]],
      body: tableBody,
      theme: "grid",
      headStyles: withUniformHeadStyles({
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineWidth: 1,
        fontStyle: "bold",
        halign: "center",
      }),
      styles: getUniformTableStyles({
        fontSize: 10,
        textColor: [0, 0, 0],
        lineWidth: 0.5,
      }),
      bodyStyles: getUniformBodyStyles(),
      columnStyles: {
        0: { halign: "center", cellWidth: routineColumnWidths[0] },
        1: { halign: "center", cellWidth: routineColumnWidths[1] },
        2: {
          halign: "left",
          fontStyle: "bold",
          cellWidth: routineColumnWidths[2],
        },
        3: { halign: "center", cellWidth: routineColumnWidths[3] },
        4: { halign: "left", cellWidth: routineColumnWidths[4] },
      },
      didParseCell: createUniformRowDidParseCell(doc, {
        fontSize: 10,
        columnWidths: routineColumnWidths,
        columnMaxLines: { 2: 2 },
        beforeParse: (data) => {
          if (data.section === "body" && data.column.index <= 2) {
            const spanInfo = teacherRowSpans.find(
              (s) => s.startIndex === data.row.index
            );
            if (spanInfo) {
              data.cell.rowSpan = spanInfo.span;
            }
          }
        },
      }),
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
  getExaminerPairOrders,
  saveExaminerPairOrders,
  exportCustomReportToPDF,
  exportCampusWiseYearlyPDF,
  exportCampusRoutinePDF,
};
