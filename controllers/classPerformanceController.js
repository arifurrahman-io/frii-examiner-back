const mongoose = require("mongoose");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");

const ClassPerformanceObservation = require("../models/ClassPerformanceObservationModel");
const Teacher = require("../models/TeacherModel");
const Branch = require("../models/BranchModel");
const {
  getUniformBodyStyles,
  getUniformTableStyles,
  withUniformHeadStyles,
  createUniformRowDidParseCell,
} = require("../utils/pdfTableRows");
const { drawInstituteHeader } = require("../utils/reportBranding");

const fullAccessRoles = ["admin", "head_teacher"];

const isFullAccess = (user) => fullAccessRoles.includes(user?.role);

const toObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;

const roundRating = (value) =>
  Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;

const parseRating = (value) => {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null;
};

const buildDateFilter = ({ from, to }) => {
  const filter = {};
  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) filter.$gte = fromDate;
  }

  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      filter.$lte = toDate;
    }
  }

  return Object.keys(filter).length ? filter : null;
};

const formatPdfDate = (value) => {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const formatPdfTimestamp = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);

const getPeriodLabel = (filters = {}) => {
  const from = formatPdfDate(filters.from);
  const to = formatPdfDate(filters.to);

  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Up to ${to}`;
  return "All available dates";
};

const getShiftReportStats = (rows = []) => {
  const totalObservations = rows.reduce(
    (total, row) => total + Number(row.totalObservations || 0),
    0
  );
  const scoredRows = rows.filter((row) => Number(row.overallAverage) > 0);
  const averageOverall = scoredRows.length
    ? (
        scoredRows.reduce(
          (total, row) => total + Number(row.overallAverage || 0),
          0
        ) / scoredRows.length
      ).toFixed(2)
    : "-";

  return {
    averageOverall,
    teacherCount: rows.length,
    totalObservations,
  };
};

const sanitizeFilename = (value) =>
  String(value || "performance-report")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);

const getTeacherForAccess = async (teacherId, user) => {
  if (!mongoose.Types.ObjectId.isValid(teacherId)) {
    const error = new Error("Invalid teacher ID.");
    error.statusCode = 400;
    throw error;
  }

  const teacher = await Teacher.findById(teacherId).populate("campus", "name");
  if (!teacher) {
    const error = new Error("Teacher not found.");
    error.statusCode = 404;
    throw error;
  }

  if (
    user?.role === "incharge" &&
    String(teacher.campus?._id || teacher.campus) !== String(user.campus)
  ) {
    const error = new Error("Access denied for this Campus/Shift.");
    error.statusCode = 403;
    throw error;
  }

  return teacher;
};

const sendControllerError = (res, error) =>
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "Performance operation failed.",
  });

const buildObservationPayload = ({ body, teacher, user }) => {
  const criteria = {
    presentation: parseRating(body.criteria?.presentation ?? body.presentation),
    discipline: parseRating(body.criteria?.discipline ?? body.discipline),
    subjectDepth: parseRating(body.criteria?.subjectDepth ?? body.subjectDepth),
  };

  const invalidCriteria = Object.entries(criteria)
    .filter(([, value]) => value === null)
    .map(([key]) => key);

  if (invalidCriteria.length > 0) {
    const error = new Error(
      `Rating must be between 1 and 5 for: ${invalidCriteria.join(", ")}.`
    );
    error.statusCode = 400;
    throw error;
  }

  const classDate = body.classDate ? new Date(body.classDate) : new Date();
  if (Number.isNaN(classDate.getTime())) {
    const error = new Error("Invalid class date.");
    error.statusCode = 400;
    throw error;
  }

  const optionalRefs = {};
  if (body.className || body.classId) {
    const classId = toObjectId(body.className || body.classId);
    if (!classId) {
      const error = new Error("Invalid class ID.");
      error.statusCode = 400;
      throw error;
    }
    optionalRefs.className = classId;
  }

  if (body.subject || body.subjectId) {
    const subjectId = toObjectId(body.subject || body.subjectId);
    if (!subjectId) {
      const error = new Error("Invalid subject ID.");
      error.statusCode = 400;
      throw error;
    }
    optionalRefs.subject = subjectId;
  }

  const overallRating = parseRating(body.overallRating);

  return {
    teacher: teacher._id,
    campus: teacher.campus?._id || teacher.campus,
    observer: user._id,
    observerRole: user.role,
    ...optionalRefs,
    classDate,
    topic: body.topic,
    durationMinutes: body.durationMinutes
      ? Number(body.durationMinutes)
      : undefined,
    criteria,
    overallRating:
      overallRating ||
      roundRating(
        (criteria.presentation + criteria.discipline + criteria.subjectDepth) /
          3
      ),
    comments: body.comments,
  };
};

const getTeacherPerformanceSummaryData = async (teacherId, user) => {
  const teacher = await getTeacherForAccess(teacherId, user);

  const aggregate = await ClassPerformanceObservation.aggregate([
    { $match: { teacher: teacher._id } },
    {
      $group: {
        _id: "$teacher",
        totalObservations: { $sum: 1 },
        presentationAverage: { $avg: "$criteria.presentation" },
        disciplineAverage: { $avg: "$criteria.discipline" },
        subjectDepthAverage: { $avg: "$criteria.subjectDepth" },
        overallAverage: { $avg: "$overallRating" },
        latestObservationAt: { $max: "$classDate" },
      },
    },
  ]);

  const summary = aggregate[0] || {
    totalObservations: 0,
    presentationAverage: 0,
    disciplineAverage: 0,
    subjectDepthAverage: 0,
    overallAverage: 0,
    latestObservationAt: null,
  };

  return {
    teacher: {
      _id: teacher._id,
      teacherId: teacher.teacherId,
      name: teacher.name,
      campus: teacher.campus,
    },
    totalObservations: summary.totalObservations,
    averages: {
      presentation: roundRating(summary.presentationAverage),
      discipline: roundRating(summary.disciplineAverage),
      subjectDepth: roundRating(summary.subjectDepthAverage),
      overall: roundRating(summary.overallAverage),
    },
    latestObservationAt: summary.latestObservationAt,
  };
};

const addClassPerformanceObservation = async (req, res) => {
  try {
    const teacher = await getTeacherForAccess(req.params.teacherId, req.user);
    const payload = buildObservationPayload({
      body: req.body,
      teacher,
      user: req.user,
    });

    const observation = await ClassPerformanceObservation.create(payload);
    const populatedObservation = await ClassPerformanceObservation.findById(
      observation._id
    )
      .populate("teacher", "teacherId name")
      .populate("campus", "name")
      .populate("observer", "name role")
      .populate("className", "name")
      .populate("subject", "name");

    res.status(201).json({
      success: true,
      message: "Class performance observation recorded.",
      data: populatedObservation,
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

const getTeacherPerformanceObservations = async (req, res) => {
  try {
    const teacher = await getTeacherForAccess(req.params.teacherId, req.user);
    const { page = 1, limit = 20, from, to } = req.query;
    const pageInt = Math.max(parseInt(page, 10) || 1, 1);
    const limitInt = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageInt - 1) * limitInt;
    const query = { teacher: teacher._id };
    const dateFilter = buildDateFilter({ from, to });
    if (dateFilter) query.classDate = dateFilter;

    const [observations, totalObservations, summary] = await Promise.all([
      ClassPerformanceObservation.find(query)
        .sort({ classDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitInt)
        .populate("teacher", "teacherId name")
        .populate("campus", "name")
        .populate("observer", "name role")
        .populate("className", "name")
        .populate("subject", "name")
        .lean(),
      ClassPerformanceObservation.countDocuments(query),
      getTeacherPerformanceSummaryData(req.params.teacherId, req.user),
    ]);

    res.json({
      observations,
      summary,
      page: pageInt,
      totalPages: Math.ceil(totalObservations / limitInt),
      totalObservations,
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

const getTeacherPerformanceSummary = async (req, res) => {
  try {
    const summary = await getTeacherPerformanceSummaryData(
      req.params.teacherId,
      req.user
    );
    res.json(summary);
  } catch (error) {
    sendControllerError(res, error);
  }
};

const getShiftReportRows = async (req) => {
  const { campusId, from, to } = req.query;
  let targetCampusId = null;

  if (req.user.role === "incharge") {
    targetCampusId = req.user.campus;
  } else if (campusId) {
    targetCampusId = campusId;
  }

  if (!targetCampusId) {
    const error = new Error("Campus/Shift is required for this report.");
    error.statusCode = 400;
    throw error;
  }

  const campusObjectId = toObjectId(targetCampusId);
  if (!campusObjectId) {
    const error = new Error("Invalid Campus/Shift ID.");
    error.statusCode = 400;
    throw error;
  }

  if (!isFullAccess(req.user) && String(campusObjectId) !== String(req.user.campus)) {
    const error = new Error("Access denied for this Campus/Shift.");
    error.statusCode = 403;
    throw error;
  }

  const campus = await Branch.findById(campusObjectId).select("name location");
  if (!campus) {
    const error = new Error("Campus/Shift not found.");
    error.statusCode = 404;
    throw error;
  }

  const match = { campus: campusObjectId };
  const dateFilter = buildDateFilter({ from, to });
  if (dateFilter) match.classDate = dateFilter;

  const rows = await ClassPerformanceObservation.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$teacher",
        totalObservations: { $sum: 1 },
        presentationAverage: { $avg: "$criteria.presentation" },
        disciplineAverage: { $avg: "$criteria.discipline" },
        subjectDepthAverage: { $avg: "$criteria.subjectDepth" },
        overallAverage: { $avg: "$overallRating" },
        latestObservationAt: { $max: "$classDate" },
      },
    },
    {
      $lookup: {
        from: "teachers",
        localField: "_id",
        foreignField: "_id",
        as: "teacher",
      },
    },
    { $unwind: "$teacher" },
    {
      $project: {
        _id: 0,
        teacherId: "$teacher.teacherId",
        teacherObjectId: "$teacher._id",
        teacherName: "$teacher.name",
        totalObservations: 1,
        presentationAverage: 1,
        disciplineAverage: 1,
        subjectDepthAverage: 1,
        overallAverage: 1,
        latestObservationAt: 1,
      },
    },
    { $sort: { overallAverage: -1, teacherName: 1 } },
  ]);

  return {
    campus,
    filters: {
      from: from || null,
      to: to || null,
    },
    rows: rows.map((row) => ({
      ...row,
      presentationAverage: roundRating(row.presentationAverage),
      disciplineAverage: roundRating(row.disciplineAverage),
      subjectDepthAverage: roundRating(row.subjectDepthAverage),
      overallAverage: roundRating(row.overallAverage),
    })),
  };
};

const getShiftPerformanceReport = async (req, res) => {
  try {
    const report = await getShiftReportRows(req);
    res.json(report);
  } catch (error) {
    sendControllerError(res, error);
  }
};

const exportShiftPerformanceReportPDF = async (req, res) => {
  try {
    const report = await getShiftReportRows(req);
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "p" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 34;
    const teal = [15, 118, 110];
    const slate = [15, 23, 42];
    const muted = [100, 116, 139];
    const line = [203, 213, 225];
    const generatedAt = new Date();
    const preparedBy = req.user?.name || "System User";
    const periodLabel = getPeriodLabel(report.filters);
    const stats = getShiftReportStats(report.rows);
    const drawFooter = (pageNumber) => {
      doc.setDrawColor(...line);
      doc.setLineWidth(0.4);
      doc.line(marginX, pageHeight - 34, pageWidth - marginX, pageHeight - 34);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      doc.text("FRII Teacher Platform", marginX, pageHeight - 21);
      doc.text(`Page ${pageNumber}`, pageWidth - marginX, pageHeight - 21, {
        align: "right",
      });
    };

    const instituteBaselineY = 18;
    const dividerY = drawInstituteHeader(doc, {
      y: instituteBaselineY,
      fontSize: 17,
      withDivider: true,
    });
    const headerBlockY = dividerY + 12;

    doc.setFillColor(...teal);
    doc.roundedRect(marginX, headerBlockY, 42, 42, 6, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("FRII", marginX + 21, headerBlockY + 26, { align: "center" });

    doc.setTextColor(...slate);
    doc.setFontSize(18);
    doc.text("Class Performance Report", marginX + 54, headerBlockY + 18);

    doc.setTextColor(51, 65, 85);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Campus/Shift: ${report.campus.name}`, marginX + 54, headerBlockY + 36);

    const metaWidth = 176;
    const metaX = pageWidth - marginX - metaWidth;
    doc.setDrawColor(...line);
    doc.setLineWidth(0.6);
    doc.roundedRect(metaX, headerBlockY + 2, metaWidth, 60, 4, 4, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text("Generated", metaX + metaWidth - 12, headerBlockY + 15, {
      align: "right",
    });
    doc.text("Prepared by", metaX + metaWidth - 12, headerBlockY + 41, {
      align: "right",
    });

    doc.setFontSize(9);
    doc.setTextColor(...slate);
    doc.text(formatPdfTimestamp(generatedAt), metaX + metaWidth - 12, headerBlockY + 27, {
      align: "right",
    });
    doc.text(preparedBy, metaX + metaWidth - 12, headerBlockY + 53, {
      align: "right",
    });

    doc.setDrawColor(...teal);
    doc.setLineWidth(1.4);
    doc.line(marginX, headerBlockY + 68, pageWidth - marginX, headerBlockY + 68);

    const cardGap = 8;
    const cardY = headerBlockY + 84;
    const cardHeight = 44;
    const cardWidth = (pageWidth - marginX * 2 - cardGap * 3) / 4;
    const summaryCards = [
      ["Reporting period", periodLabel],
      ["Teachers", String(stats.teacherCount)],
      ["Total observations", String(stats.totalObservations)],
      ["Average overall", stats.averageOverall],
    ];

    summaryCards.forEach(([label, value], index) => {
      const x = marginX + index * (cardWidth + cardGap);
      doc.setDrawColor(...line);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, cardY, cardWidth, cardHeight, 4, 4, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      doc.text(label, x + 10, cardY + 14);
      doc.setFontSize(index === 0 ? 9 : 12);
      doc.setTextColor(...slate);
      doc.text(String(value), x + 10, cardY + 32, {
        maxWidth: cardWidth - 20,
      });
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...slate);
    doc.text("Teacher Performance Averages", marginX, cardY + 68);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(
      "Scores are calculated from recorded class observations.",
      pageWidth - marginX,
      cardY + 68,
      { align: "right" }
    );

    const performanceColumnWidths = {
      0: 28,
      1: 132,
      2: 78,
      3: 48,
      4: 48,
      5: 48,
      6: 48,
      7: 48,
    };

    doc.autoTable({
      startY: cardY + 78,
      head: [
        [
          "SL",
          "Teacher",
          "ID",
          "Classes",
          "Presentation",
          "Discipline",
          "Depth",
          "Overall",
        ],
      ],
      body: report.rows.length
        ? report.rows.map((row, index) => [
            index + 1,
            row.teacherName,
            row.teacherId,
            row.totalObservations,
            row.presentationAverage || "-",
            row.disciplineAverage || "-",
            row.subjectDepthAverage || "-",
            row.overallAverage || "-",
          ])
        : [
            [
              {
                content: "No class performance data found for this selection.",
                colSpan: 8,
                styles: {
                  halign: "center",
                  fontStyle: "bold",
                  textColor: muted,
                },
              },
            ],
          ],
      theme: "grid",
      headStyles: withUniformHeadStyles({
        fillColor: teal,
        textColor: 255,
        fontStyle: "bold",
        fontSize: 8,
        halign: "left",
        lineColor: teal,
      }),
      styles: getUniformTableStyles({
        cellPadding: { top: 6, right: 7, bottom: 6, left: 7 },
        fontSize: 8.5,
        lineColor: line,
        lineWidth: 0.4,
        textColor: slate,
      }),
      columnStyles: {
        0: { cellWidth: performanceColumnWidths[0], halign: "center" },
        1: { cellWidth: performanceColumnWidths[1] },
        2: { cellWidth: performanceColumnWidths[2] },
        3: { cellWidth: performanceColumnWidths[3], halign: "center" },
        4: { cellWidth: performanceColumnWidths[4], halign: "center" },
        5: { cellWidth: performanceColumnWidths[5], halign: "center" },
        6: { cellWidth: performanceColumnWidths[6], halign: "center" },
        7: {
          cellWidth: performanceColumnWidths[7],
          halign: "center",
          fontStyle: "bold",
          textColor: [6, 95, 70],
        },
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      bodyStyles: getUniformBodyStyles(),
      didParseCell: createUniformRowDidParseCell(doc, {
        fontSize: 8.5,
        cellPadding: 7,
        columnWidths: performanceColumnWidths,
        columnMaxLines: { 1: 2 },
        afterParse: (data) => {
          if (data.section === "body" && data.column.index === 7) {
            data.cell.styles.fillColor = [236, 253, 245];
            data.cell.styles.fontStyle = "bold";
          }
        },
      }),
      margin: { left: marginX, right: marginX, bottom: 46 },
      didDrawPage: (data) => {
        drawFooter(data.pageNumber);
      },
    });

    let signatureY = (doc.lastAutoTable?.finalY || 220) + 56;
    if (signatureY > pageHeight - 88) {
      doc.addPage();
      signatureY = 110;
      drawFooter(doc.internal.getNumberOfPages());
    }

    const signatureGap = 28;
    const signatureWidth = (pageWidth - marginX * 2 - signatureGap * 2) / 3;
    ["Prepared by", "Reviewed by", "Approved by"].forEach((label, index) => {
      const x = marginX + index * (signatureWidth + signatureGap);
      doc.setDrawColor(51, 65, 85);
      doc.setLineWidth(0.6);
      doc.line(x, signatureY, x + signatureWidth, signatureY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(label, x, signatureY + 14);
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=Class_Performance_${sanitizeFilename(
        report.campus.name
      )}.pdf`
    );
    return res.send(Buffer.from(doc.output("arraybuffer")));
  } catch (error) {
    sendControllerError(res, error);
  }
};

module.exports = {
  addClassPerformanceObservation,
  getTeacherPerformanceObservations,
  getTeacherPerformanceSummary,
  getShiftPerformanceReport,
  exportShiftPerformanceReportPDF,
};
