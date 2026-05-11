const Leave = require("../models/LeaveModel");
const Teacher = require("../models/TeacherModel");
const ResponsibilityType = require("../models/ResponsibilityTypeModel");
const Branch = require("../models/BranchModel");
const exceljs = require("exceljs");

const buildScopedLeaveQuery = async (req, baseQuery = {}) => {
  const query = { ...baseQuery };

  if (req.query.year) query.year = parseInt(req.query.year, 10);
  if (req.query.teacher) query.teacher = req.query.teacher;

  if (req.user.role === "incharge") {
    const campusTeachers = await Teacher.find({ campus: req.user.campus })
      .select("_id")
      .lean();
    const teacherIds = campusTeachers.map((teacher) => teacher._id);

    if (query.teacher) {
      const isOwnCampusTeacher = teacherIds.some(
        (id) => String(id) === String(query.teacher)
      );
      if (!isOwnCampusTeacher) {
        query.teacher = { $in: [] };
      }
    } else {
      query.teacher = { $in: teacherIds };
    }
  }

  return query;
};

// ***************************************
// 🔹 Helper Function for Base Leave Query
// ***************************************
const getBaseLeavesData = async (query) => {
  return await Leave.find(query)
    .populate({
      path: "teacher",
      select: "name teacherId campus",
      populate: {
        path: "campus",
        select: "name",
      },
    })
    .populate("responsibilityType", "name")
    .sort({ createdAt: -1 });
};

// ***************************************
// 🔹 GET ALL LEAVE REQUESTS
// ***************************************
const getAllLeaveRequests = async (req, res) => {
  const { status = "Granted" } = req.query;

  try {
    const query = await buildScopedLeaveQuery(req, { status });
    const leaves = await getBaseLeavesData(query);
    res.json(leaves);
  } catch (error) {
    console.error("Error in getAllLeaveRequests:", error);
    res.status(500).json({
      message: "Failed to fetch leave requests due to a server error.",
    });
  }
};

// ***************************************
// 🔹 CREATE NEW LEAVE REQUEST
// ***************************************
const createLeaveRequest = async (req, res) => {
  const {
    teacher,
    responsibilityType,
    year,
    startDate,
    endDate,
    notes,
    reason,
  } = req.body;

  if (!teacher || !responsibilityType || !year) {
    return res.status(400).json({
      message: "Teacher, Responsibility Type, and Year are required.",
    });
  }

  try {
    if (!["admin", "incharge"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Access restricted. Only Admin or Incharge can grant leave.",
      });
    }

    const targetTeacher = await Teacher.findById(teacher);
    if (!targetTeacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }

    if (
      req.user.role === "incharge" &&
      String(targetTeacher.campus) !== String(req.user.campus)
    ) {
      return res.status(403).json({
        message: "Access denied. Teacher belongs to a different campus.",
      });
    }

    const newLeave = await Leave.create({
      teacher,
      responsibilityType,
      year: parseInt(year),
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      notes: notes || "",
      reason: reason || "",
      status: "Granted",
    });

    res.status(201).json(newLeave);
  } catch (error) {
    console.error("Error creating leave:", error);
    res
      .status(500)
      .json({ message: "Failed to create leave request: " + error.message });
  }
};

const updateLeaveRequest = async (req, res) => {
  const { responsibilityType, year, startDate, endDate, reason, status } =
    req.body;

  try {
    const leave = await Leave.findById(req.params.id).populate("teacher");
    if (!leave) {
      return res.status(404).json({ message: "Leave record not found." });
    }

    if (
      req.user.role === "incharge" &&
      String(leave.teacher?.campus) !== String(req.user.campus)
    ) {
      return res.status(403).json({
        message: "Access denied. Leave belongs to a different campus.",
      });
    }

    if (responsibilityType) leave.responsibilityType = responsibilityType;
    if (year) leave.year = parseInt(year, 10);
    if (startDate !== undefined)
      leave.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) leave.endDate = endDate ? new Date(endDate) : null;
    if (reason !== undefined) leave.reason = reason;
    if (status && ["Pending", "Granted", "Rejected"].includes(status)) {
      leave.status = status;
    }

    const updatedLeave = await leave.save();
    res.json({ message: "Leave record updated.", leave: updatedLeave });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update leave record: " + error.message,
    });
  }
};

// ***************************************
// 🔹 GRANT / REJECT LEAVE REQUEST
// ***************************************
const grantLeaveRequest = async (req, res) => {
  const { status } = req.body;

  if (!status || !["Granted", "Rejected"].includes(status)) {
    return res.status(400).json({ message: "Invalid status provided." });
  }

  try {
    const updatedLeave = await Leave.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate("teacher", "name teacherId");

    if (!updatedLeave) {
      return res.status(404).json({ message: "Leave request not found." });
    }

    res.json({
      message: `Leave request updated to ${status}.`,
      leave: updatedLeave,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to update leave status: " + error.message });
  }
};

// ***************************************
// 🔹 PERMANENT DELETE LEAVE REQUEST
// ***************************************
const deleteLeaveRequestPermanently = async (req, res) => {
  try {
    const deletedLeave = await Leave.findByIdAndDelete(req.params.id);

    if (!deletedLeave) {
      return res.status(404).json({ message: "Leave record not found." });
    }

    res.json({ message: "Leave record permanently deleted." });
  } catch (error) {
    res.status(500).json({
      message: "Failed to permanently delete leave record: " + error.message,
    });
  }
};

// ***************************************
// 🔹 EXPORT GRANTED LEAVES TO EXCEL
// ***************************************
const exportLeavesToExcel = async (req, res) => {
  try {
    const leaveRecords = await getBaseLeavesData({ status: "Granted" });

    if (leaveRecords.length === 0) {
      return res.status(404).send("No granted leave data found to export.");
    }

    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet("Granted Leaves Report");

    worksheet.columns = [
      { header: "Teacher Name", key: "TeacherName", width: 25 },
      { header: "ID", key: "TeacherID", width: 15 },
      { header: "Campus", key: "Campus", width: 15 },
      { header: "Responsibility", key: "ResponsibilityType", width: 20 },
      { header: "Year", key: "Year", width: 10 },
      { header: "Reason", key: "Reason", width: 40 },
      { header: "Date Granted", key: "DateGranted", width: 20 },
    ];

    const formattedData = leaveRecords.map((leave) => ({
      TeacherName: leave.teacher?.name || "N/A",
      TeacherID: leave.teacher?.teacherId || "N/A",
      Campus: leave.teacher?.campus?.name || "N/A",
      ResponsibilityType: leave.responsibilityType?.name || "N/A",
      Year: leave.year || "",
      Reason: leave.reason || "N/A",
      DateGranted: new Date(leave.createdAt).toLocaleDateString("en-GB"),
    }));

    worksheet.addRows(formattedData);

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
      `attachment; filename=Granted_Leaves_Report_${new Date().getFullYear()}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error exporting Excel:", error);
    res.status(500).json({
      message: "Error generating Excel file: " + error.message,
    });
  }
};

const checkLeaveConflict = async (req, res) => {
  const { teacherId, responsibilityTypeId, year } = req.query;

  if (!teacherId || !responsibilityTypeId || !year) {
    return res
      .status(400)
      .json({ message: "Missing required query parameters." });
  }

  try {
    const leaveConflict = await Leave.findOne({
      teacher: teacherId,
      responsibilityType: responsibilityTypeId,
      year: parseInt(year),
      status: "Granted",
    });

    res.json({
      hasConflict: !!leaveConflict,
    });
  } catch (error) {
    res.status(500).json({ message: "Error checking leave conflict." });
  }
};

// ***************************************
module.exports = {
  getAllLeaveRequests,
  createLeaveRequest,
  updateLeaveRequest,
  grantLeaveRequest,
  deleteLeaveRequestPermanently,
  exportLeavesToExcel,
  checkLeaveConflict,
};
