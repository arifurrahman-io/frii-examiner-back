// reportController.js
const mongoose = require("mongoose");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const PDFDocument = require("pdfkit");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");

// Helper to check if data is a valid array
const ArrayOfData = (data) => Array.isArray(data) && data.length > 0;

// ----------------------------
// 1️⃣ GET REPORT DATA
// ----------------------------
const getReportData = async (req, res) => {
  try {
    const { year, typeId, classId, status, reportType, branchId } = req.query;

    let filter = {};
    if (year) filter.year = parseInt(year);
    if (typeId && mongoose.Types.ObjectId.isValid(typeId))
      filter.responsibilityType = new mongoose.Types.ObjectId(typeId);
    if (classId && mongoose.Types.ObjectId.isValid(classId))
      filter.targetClass = new mongoose.Types.ObjectId(classId);
    if (status) filter.status = status;
    if (!status) filter.status = { $ne: "Cancelled" };

    const requiresAggregation =
      reportType !== "DETAILED_ASSIGNMENT" ||
      (branchId && mongoose.Types.ObjectId.isValid(branchId));

    if (requiresAggregation) {
      let pipeline = [{ $match: filter }];

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

      // --- CAMPUS SUMMARY REPORT ---
      if (reportType === "CAMPUS_SUMMARY") {
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

      // --- CLASS SUMMARY REPORT ---
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

      // --- DETAILED ASSIGNMENT REPORT (Aggregation Path) ---
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
        { $unwind: "$typeDetails" },
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
        },
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
      // --- Simple DETAILED_ASSIGNMENT (No aggregation needed) ---
      const assignments = await ResponsibilityAssignment.find(filter)
        .populate("teacher", "name teacherId")
        .populate("teacherCampus", "name")
        .populate("responsibilityType", "name")
        .populate("targetClass", "name")
        .populate("targetSubject", "name")
        .sort({ "targetClass.level": 1, "teacher.name": 1 });

      const formatted = assignments.map((a, idx) => ({
        ID: idx + 1,
        TEACHER: a.teacher?.name || "N/A",
        CAMPUS: a.teacherCampus?.name || "N/A",
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
// 2️⃣ EXPORT CUSTOM PDF REPORT
// ----------------------------
const exportCustomReportToPDF = async (req, res) => {
  const { year, typeId } = req.query;

  try {
    // Fetch responsibility name
    let responsibilityName = "N/A";
    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
      const respType = await ResponsibilityType.findById(typeId).select("name");
      responsibilityName = respType ? respType.name : typeId;
    } else if (typeId) responsibilityName = typeId;

    // Determine report title
    const questionSetterPrefixes = ["Q-HY", "Q-Pre-Test", "Q-Annual", "Q-Test"];
    const isQuestionSetter =
      questionSetterPrefixes.some((p) =>
        responsibilityName.toUpperCase().startsWith(p.toUpperCase())
      ) || responsibilityName.toUpperCase().startsWith("Q-");
    const reportTitle = isQuestionSetter
      ? "Question Setters' List"
      : "Examiners' List";

    // Footer text
    const now = new Date();
    const footerText = `Report generated by FRII Exam Management Software on ${now.toLocaleDateString(
      "en-GB"
    )} ${now.toLocaleTimeString("en-GB", { hour12: false })}`;

    // Fetch detailed report data
    const pseudoReq = {
      query: {
        ...req.query,
        reportType: "DETAILED_ASSIGNMENT",
        status: "Assigned",
      },
    };
    const pseudoRes = {
      json: (data) => data,
      status: () => pseudoRes,
      send: () => {},
    };
    const rawData = await getReportData(pseudoReq, pseudoRes);

    if (!ArrayOfData(rawData))
      return res.status(404).json({ message: "No data found to export." });

    const FINAL_COLUMNS = [
      "ID",
      "CLASS",
      "SUBJECT",
      "TEACHER",
      "CAMPUS",
      "NOTE",
    ];
    const mappedData = rawData.map((item) => [
      item.ID,
      item.CLASS,
      item.SUBJECT,
      item.TEACHER,
      item.CAMPUS,
      "",
    ]);

    // PDF setup
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      autoFirstPage: false,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=Custom_Assignment_Report_${year || "All"}.pdf`
    );
    res.setHeader("Cache-Control", "no-cache");
    doc.pipe(res);

    // Constants
    const MARGIN = 50;
    const rowHeight = 18;
    const headerHeight = 20;
    const headerColor = "#1E3A8A";
    const cellPadding = 5;
    const fontSizeBody = 7;
    const fontSizeHeader = 8;
    const lineColor = "#A0AEC0";
    const widthMap = [0.08, 0.1, 0.1, 0.35, 0.17, 0.2];
    let pageNumber = 0;

    // Header/Footer functions
    const drawHeader = () => {
      if (!doc.page) return;
      const availableWidth = doc.page.width - 2 * MARGIN;
      doc.font("Helvetica-Bold").fontSize(16).fillColor("#1E3A8A");
      doc.text(reportTitle, MARGIN, MARGIN - 10, {
        align: "center",
        width: availableWidth,
      });
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(9).fillColor("#4B5563");
      doc.text(
        `Year: ${year || "All"} | Responsibility Type: ${responsibilityName}`,
        {
          align: "center",
          width: availableWidth,
        }
      );
      doc.moveDown(1.2);
    };

    const drawTableHeader = (y) => {
      if (!doc.page) return y;
      const availableWidth = doc.page.width - 2 * MARGIN;
      const finalY = y + headerHeight;
      let x = MARGIN;
      doc.save();
      doc.rect(MARGIN, y, availableWidth, headerHeight).fill(headerColor);
      doc.fillColor("#FFFFFF").fontSize(fontSizeHeader).font("Helvetica-Bold");
      for (let i = 0; i < FINAL_COLUMNS.length; i++) {
        const width = widthMap[i] * availableWidth;
        doc.text(FINAL_COLUMNS[i], x + cellPadding, y + cellPadding, {
          width: width - 2 * cellPadding,
          align: "left",
          ellipsis: true,
        });
        doc
          .moveTo(x + width, y)
          .lineTo(x + width, finalY)
          .strokeColor(lineColor)
          .stroke();
        x += width;
      }
      doc
        .moveTo(MARGIN, y)
        .lineTo(MARGIN + availableWidth, y)
        .strokeColor(lineColor)
        .stroke();
      doc
        .moveTo(MARGIN, finalY)
        .lineTo(MARGIN + availableWidth, finalY)
        .strokeColor(lineColor)
        .stroke();
      doc.restore();
      return finalY;
    };

    const drawFooter = () => {
      if (!doc.page) return;
      const availableWidth = doc.page.width - 2 * MARGIN;
      const bottomY = doc.page.height - 40;
      doc.save();
      doc.font("Helvetica").fontSize(7).fillColor("#606060");
      doc.text(footerText, MARGIN, bottomY, {
        width: availableWidth * 0.7,
        lineBreak: false,
      });
      doc.text(`Page ${pageNumber}`, MARGIN + availableWidth * 0.7, bottomY, {
        width: availableWidth * 0.3,
        align: "right",
        lineBreak: false,
      });
      doc.restore();
    };

    const addNewPage = () => {
      doc.addPage();
      pageNumber++;
      drawHeader();
      return doc.y;
    };

    // DRAW TABLE
    let currentY = addNewPage();
    currentY = drawTableHeader(currentY) + 4;

    const bottomLimit = () => (doc.page ? doc.page.height - 50 : 700);

    mappedData.forEach((row, i) => {
      if (currentY + rowHeight > bottomLimit()) {
        drawFooter();
        currentY = addNewPage();
        currentY = drawTableHeader(currentY) + 4;
      }

      if (i % 2 === 1) {
        doc
          .save()
          .rect(MARGIN, currentY, doc.page.width - 2 * MARGIN, rowHeight)
          .fill("#F3F4F6")
          .restore();
      }

      let x = MARGIN;
      for (let j = 0; j < row.length; j++) {
        const text = row[j] == null ? "N/A" : String(row[j]);
        const width = widthMap[j] * (doc.page.width - 2 * MARGIN);
        doc.text(text, x + cellPadding, currentY + cellPadding, {
          width: Math.max(width - 2 * cellPadding, 10),
          align: "left",
          ellipsis: true,
          lineBreak: false,
        });
        doc
          .moveTo(x + width, currentY)
          .lineTo(x + width, currentY + rowHeight)
          .strokeColor(lineColor)
          .lineWidth(0.5)
          .stroke();
        x += width;
      }
      doc
        .moveTo(MARGIN, currentY + rowHeight)
        .lineTo(doc.page.width - MARGIN, currentY + rowHeight)
        .strokeColor(lineColor)
        .lineWidth(0.5)
        .stroke();
      currentY += rowHeight;
    });

    drawFooter();
    doc.end();
  } catch (err) {
    console.error("Custom PDF Export Failed:", err);
    if (!res.headersSent)
      res
        .status(500)
        .json({ message: "PDF Generation Failed. See server logs." });
  }
};

module.exports = {
  getReportData,
  exportCustomReportToPDF,
};
