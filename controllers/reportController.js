const mongoose = require("mongoose");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const jsPDF = require("jspdf").jsPDF;
require("jspdf-autotable");

const ArrayOfData = (data) => Array.isArray(data) && data.length > 0;

// ----------------------------
// 1️⃣ GET REPORT DATA
// ----------------------------
const getReportData = async (req, res) => {
  try {
    const { year, typeId, classId, status, reportType, branchId } = req.query;

    let filter = {};
    if (year) filter.year = parseInt(year);

    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) {
      filter.responsibilityType = new mongoose.Types.ObjectId(typeId);
    }
    if (classId && mongoose.Types.ObjectId.isValid(classId)) {
      filter.targetClass = new mongoose.Types.ObjectId(classId);
    }

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

      if (reportType === "CLASS_SUMMARY") {
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

        pipeline.push({
          $lookup: {
            from: "responsibilitytypes",
            localField: "responsibilityType",
            foreignField: "_id",
            as: "typeDetails",
          },
        });
        pipeline.push({ $unwind: "$typeDetails" });

        pipeline.push({
          $group: {
            _id: {
              class: { $ifNull: ["$classDetails.name", "N/A"] },
              type: "$responsibilityType",
            },
            totalAssignments: { $sum: 1 },
          },
        });

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
      } // --- DETAILED ASSIGNMENT REPORT (Aggregation Path) ---

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
// 2️⃣ EXPORT CUSTOM PDF REPORT (CUSTOM jsPDF Implementation)
// ----------------------------
const exportCustomReportToPDF = async (req, res) => {
  const { year, typeId } = req.query;

  try {
    // --- 1. Fetch Report Data & Setup Metadata ---
    let responsibilityName = "N/A";
    if (mongoose.Types.ObjectId.isValid(typeId)) {
      const responsibilityType = await ResponsibilityType.findById(
        typeId
      ).select("name");
      responsibilityName = responsibilityType
        ? responsibilityType.name
        : typeId;
    } else if (typeId) responsibilityName = typeId;

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

    // --- 2. Prepare Data for Custom Table ---

    const columnHeaders = [
      "S.L.",
      "CLASS",
      "SUBJECT",
      "TEACHER",
      "CAMPUS",
      "NOTE",
    ];
    const columnWidths = [35, 50, 50, 180, 80, 90]; // pt units
    const rowHeight = 18;
    const headerHeight = 20;
    const MARGIN = 50;
    const PADDING = 4;

    // 💡 ফিক্স: হেডার ও টেবিলের দূরত্ব কমাতে মান পরিবর্তন করা হলো
    const TABLE_START_Y = MARGIN + 40; // নতুন মান (90pt)

    const PAGE_END_Y_SAFE = 595.28 * 0.75 - 50; // A4 height, safe zone at 50pt from bottom

    // Map data rows, filling in the blank 'NOTE' field and converting to array of cell values
    const rows = rawData.map((item) => [
      item.ID.toString(),
      item.CLASS || "N/A",
      item.SUBJECT || "N/A",
      item.TEACHER || "N/A",
      item.CAMPUS || "N/A",
      "",
    ]);

    // --- 3. Initialize PDF ---
    const doc = new jsPDF({
      unit: "pt",
      format: "a4",
      orientation: "p",
    });

    const pageWidth = doc.internal.pageSize.width;
    const availableWidth = pageWidth - 2 * MARGIN;

    // --- 4. Helper Functions for Page Elements ---

    const drawHeader = (doc, y) => {
      let currentX = MARGIN;

      // Draw Header Background (Fill Color: #1E3A8A)
      doc
        .setFillColor(30, 58, 138)
        .rect(MARGIN, y, availableWidth, headerHeight, "F");

      doc.setFontSize(8);
      doc.setTextColor(255); // White text

      // Draw header text and vertical lines
      columnHeaders.forEach((header, i) => {
        const width = columnWidths[i];
        // Text alignment in cell
        doc.text(header, currentX + PADDING, y + headerHeight / 2 + 3);

        // Draw vertical line on the right side of the column
        doc
          .setDrawColor(160, 174, 192)
          .setLineWidth(0.5)
          .line(currentX, y, currentX, y + headerHeight);
        currentX += width;
      });
      // Draw final right border
      doc
        .setDrawColor(160, 174, 192)
        .setLineWidth(0.5)
        .line(
          MARGIN + availableWidth,
          y,
          MARGIN + availableWidth,
          y + headerHeight
        );

      // Draw bottom horizontal line
      doc
        .setDrawColor(160, 174, 192)
        .setLineWidth(0.5)
        .line(
          MARGIN,
          y + headerHeight,
          MARGIN + availableWidth,
          y + headerHeight
        );

      return y + headerHeight;
    };

    const drawTitleBlock = (doc) => {
      doc.setFontSize(16);
      doc.setTextColor(30, 58, 138); // #1E3A8A
      doc.text(reportTitle, pageWidth / 2, MARGIN, { align: "center" });

      doc.setFontSize(9);
      doc.setTextColor(75, 85, 99); // #4B5563
      doc.text(
        `Year: ${year} | Responsibility Type: ${responsibilityName}`,
        pageWidth / 2,
        MARGIN + 18,
        { align: "center" }
      );
    };

    const drawFooter = (doc, pageNumber) => {
      doc.setFontSize(7);
      doc.setTextColor(96, 96, 96); // #606060
      const footerY = doc.internal.pageSize.height - 30;

      // Footer Text (Left)
      doc.text(footerText, MARGIN, footerY);

      // Page Number (Right)
      doc.text(`Page ${pageNumber}`, pageWidth - MARGIN, footerY, {
        align: "right",
      });
    };

    // --- 5. Drawing Execution ---

    let currentY = 0;

    // 💡 ফিক্স: isFirstPage প্যারামিটার যোগ করা হলো
    const startNewPage = (isFirstPage = false) => {
      if (!isFirstPage) {
        drawFooter(doc, doc.internal.getNumberOfPages());
        doc.addPage();
      }
      drawTitleBlock(doc);
      currentY = drawHeader(doc, TABLE_START_Y);
    };

    // প্রথম পেজ শুরু করা
    startNewPage(true);

    // Loop through all data rows
    rows.forEach((row, rowIdx) => {
      // --- Page Break Check ---
      // যদি পরের রো সেফ জোন অতিক্রম করে, নতুন পেজ শুরু করুন
      if (currentY + rowHeight > doc.internal.pageSize.height - 50) {
        startNewPage();
      }

      let currentX = MARGIN;

      // Draw Row Background (Alternate Row Color: #F3F4F6)
      if (rowIdx % 2 !== 0) {
        doc
          .setFillColor(243, 244, 246)
          .rect(MARGIN, currentY, availableWidth, rowHeight, "F");
      }

      doc.setFontSize(7);
      doc.setTextColor(0); // Black text

      // Draw cells and borders
      row.forEach((cellData, i) => {
        const width = columnWidths[i];

        // Draw Cell Content (Text is clipped by column width)
        doc.text(cellData, currentX + PADDING, currentY + rowHeight / 2 + 2, {
          maxWidth: width - 2 * PADDING,
        });

        // Draw Vertical Lines
        doc.setDrawColor(160, 174, 192).setLineWidth(0.5);
        doc.line(currentX, currentY, currentX, currentY + rowHeight);

        currentX += width;
      });

      // Draw final vertical border on the right
      doc.line(
        MARGIN + availableWidth,
        currentY,
        MARGIN + availableWidth,
        currentY + rowHeight
      );

      // Draw horizontal bottom line for the row
      doc.line(
        MARGIN,
        currentY + rowHeight,
        MARGIN + availableWidth,
        currentY + rowHeight
      );

      currentY += rowHeight;
    });

    // Add footer to the last page (since it wasn't triggered by a page break)
    drawFooter(doc, doc.internal.getNumberOfPages());

    // --- 6. Send PDF Stream ---
    const buffer = doc.output("arraybuffer");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=Custom_Assignment_Report_${year || "All"}.pdf`
    );
    res.setHeader("Content-Length", buffer.byteLength);
    res.setHeader("Cache-Control", "no-cache");

    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Custom PDF Export Failed (jsPDF - Custom):", error);

    if (!res.headersSent) {
      return res.status(500).json({
        message: `PDF Generation Failed: ${
          error.message || "An unknown error occurred during PDF streaming."
        }. Check server console for details.`,
      });
    }
  }
};

module.exports = {
  getReportData,
  exportCustomReportToPDF,
};
