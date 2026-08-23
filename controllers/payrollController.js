const mongoose = require("mongoose");
const Teacher = require("../models/TeacherModel");
const PayrollAttendance = require("../models/PayrollAttendanceModel");
const { houseRentFromBasic } = require("../utils/salarySplit");
const {
  getUserCampusIds,
  SCHOOL_WIDE_ROLES,
} = require("../utils/incrementAccess");
const {
  toNonNegInt,
  applyClOverflow,
  monthlyPayroll,
  yearClBenefit,
  pfFromBasic,
} = require("../utils/payrollMath");

const PAYROLL_ROLES = ["admin", "head_teacher", "executive"];

const parseYear = (value) => {
  const year = parseInt(value, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: "A valid calendar year is required." };
  }
  return { year };
};

const parseYearMonth = (yearValue, monthValue) => {
  const parsedYear = parseYear(yearValue);
  if (parsedYear.error) return parsedYear;
  const month = parseInt(monthValue, 10);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "Month must be between 1 and 12." };
  }
  return { year: parsedYear.year, month };
};

const resolvePayrollCampuses = (user, requestedCampus) => {
  if (!user || !PAYROLL_ROLES.includes(user.role)) {
    return { status: 403, error: "Payroll access is restricted." };
  }

  if (requestedCampus && !mongoose.Types.ObjectId.isValid(requestedCampus)) {
    return { status: 400, error: "Invalid campus id." };
  }

  if (SCHOOL_WIDE_ROLES.includes(user.role)) {
    return {
      campusIds: requestedCampus ? [String(requestedCampus)] : null,
    };
  }

  const assigned = getUserCampusIds(user);
  if (!assigned.length) {
    return { status: 403, error: "No campus is assigned to this executive." };
  }

  if (requestedCampus) {
    if (!assigned.includes(String(requestedCampus))) {
      return {
        status: 403,
        error: "Campus is outside your assigned branches.",
      };
    }
    return { campusIds: [String(requestedCampus)] };
  }

  return { campusIds: assigned };
};

const teacherQueryForCampuses = (campusIds) => {
  const query = { isActive: { $ne: false } };
  if (campusIds) query.campus = { $in: campusIds };
  return query;
};

const serializeTeacher = (teacher) => ({
  _id: teacher._id,
  teacherId: teacher.teacherId,
  name: teacher.name,
  banglaName: teacher.banglaName || "",
  designation: teacher.designation || "",
  campus: teacher.campus,
  basicSalary: teacher.basicSalary || 0,
  houseRent:
    teacher.houseRent || houseRentFromBasic(teacher.basicSalary || 0),
  salaryBankAccount: teacher.salaryBankAccount || "",
  pfBankAccount: teacher.pfBankAccount || "",
  providentFundEnabled: Boolean(teacher.providentFundEnabled),
});

const attendanceMapKey = (teacherId) => String(teacherId);

const getAttendanceGrid = async (req, res) => {
  const parsed = parseYearMonth(req.query.year, req.query.month);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const campusScope = resolvePayrollCampuses(req.user, req.query.campus);
  if (campusScope.error) {
    return res.status(campusScope.status || 400).json({
      message: campusScope.error,
    });
  }

  try {
    const teachers = await Teacher.find(teacherQueryForCampuses(campusScope.campusIds))
      .select(
        "teacherId name banglaName designation campus basicSalary houseRent salaryBankAccount pfBankAccount providentFundEnabled isActive"
      )
      .populate("campus", "name")
      .sort({ name: 1 })
      .lean();

    const teacherIds = teachers.map((item) => item._id);
    const rows = teacherIds.length
      ? await PayrollAttendance.find({
          teacher: { $in: teacherIds },
          year: parsed.year,
          month: parsed.month,
        }).lean()
      : [];

    const byTeacher = new Map(
      rows.map((item) => [attendanceMapKey(item.teacher), item])
    );

    res.json({
      year: parsed.year,
      month: parsed.month,
      rows: teachers.map((teacher) => {
        const attendance = byTeacher.get(attendanceMapKey(teacher._id));
        return {
          teacher: serializeTeacher(teacher),
          presentDays: attendance?.presentDays || 0,
          clDays: attendance?.clDays || 0,
          lwpDays: attendance?.lwpDays || 0,
          updatedAt: attendance?.updatedAt || null,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load attendance: " + error.message });
  }
};

const saveAttendance = async (req, res) => {
  const parsed = parseYearMonth(req.body.year, req.body.month);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const incoming = Array.isArray(req.body.rows)
    ? req.body.rows
    : req.body.teacher
      ? [req.body]
      : [];

  if (!incoming.length) {
    return res.status(400).json({ message: "No attendance rows were provided." });
  }

  try {
    const saved = [];
    const overflows = [];

    for (const row of incoming) {
      const teacherId = row.teacher || row.teacherId;
      if (!mongoose.Types.ObjectId.isValid(teacherId)) {
        return res.status(400).json({ message: "Each row needs a valid teacher id." });
      }

      const teacher = await Teacher.findById(teacherId).select("campus");
      if (!teacher) {
        return res.status(404).json({ message: `Teacher not found: ${teacherId}` });
      }

      const campusScope = resolvePayrollCampuses(req.user, teacher.campus);
      if (campusScope.error) {
        return res.status(campusScope.status || 403).json({
          message: campusScope.error,
        });
      }

      const otherMonths = await PayrollAttendance.find({
        teacher: teacher._id,
        year: parsed.year,
        month: { $ne: parsed.month },
      })
        .select("clDays")
        .lean();

      const otherYearClDays = otherMonths.reduce(
        (sum, item) => sum + toNonNegInt(item.clDays),
        0
      );
      const normalized = applyClOverflow({
        otherYearClDays,
        clDays: row.clDays,
        lwpDays: row.lwpDays,
      });

      const doc = await PayrollAttendance.findOneAndUpdate(
        {
          teacher: teacher._id,
          year: parsed.year,
          month: parsed.month,
        },
        {
          $set: {
            campus: teacher.campus,
            presentDays: toNonNegInt(row.presentDays),
            clDays: normalized.clDays,
            lwpDays: normalized.lwpDays,
            updatedBy: req.user._id,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );

      saved.push(doc);
      if (normalized.overflowDays > 0) {
        overflows.push({
          teacher: teacher._id,
          overflowDays: normalized.overflowDays,
        });
      }
    }

    res.json({
      message: "Attendance saved.",
      year: parsed.year,
      month: parsed.month,
      count: saved.length,
      overflows,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to save attendance: " + error.message });
  }
};

const buildSalaryRows = async ({ year, month, campusIds }) => {
  const teachers = await Teacher.find(teacherQueryForCampuses(campusIds))
    .select(
      "teacherId name banglaName designation campus basicSalary houseRent salaryBankAccount pfBankAccount providentFundEnabled"
    )
    .populate("campus", "name")
    .sort({ name: 1 })
    .lean();

  const teacherIds = teachers.map((item) => item._id);
  const attendanceRows = teacherIds.length
    ? await PayrollAttendance.find({
        teacher: { $in: teacherIds },
        year,
        month,
      }).lean()
    : [];
  const byTeacher = new Map(
    attendanceRows.map((item) => [attendanceMapKey(item.teacher), item])
  );

  return teachers.map((teacher) => {
    const attendance = byTeacher.get(attendanceMapKey(teacher._id)) || {};
    const payroll = monthlyPayroll({
      basicSalary: teacher.basicSalary,
      houseRent: houseRentFromBasic(teacher.basicSalary || 0),
      presentDays: attendance.presentDays,
      clDays: attendance.clDays,
      lwpDays: attendance.lwpDays,
      providentFundEnabled: teacher.providentFundEnabled,
    });

    return {
      teacher: serializeTeacher(teacher),
      ...payroll,
    };
  });
};

const getSalaryReport = async (req, res) => {
  const parsed = parseYearMonth(req.query.year, req.query.month);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const campusScope = resolvePayrollCampuses(req.user, req.query.campus);
  if (campusScope.error) {
    return res.status(campusScope.status || 400).json({
      message: campusScope.error,
    });
  }

  try {
    const rows = await buildSalaryRows({
      year: parsed.year,
      month: parsed.month,
      campusIds: campusScope.campusIds,
    });
    res.json({
      year: parsed.year,
      month: parsed.month,
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load salary report: " + error.message });
  }
};

const getPayslip = async (req, res) => {
  const parsed = parseYearMonth(req.query.year, req.query.month);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const { teacherId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(teacherId)) {
    return res.status(400).json({ message: "Invalid teacher id." });
  }

  try {
    const teacher = await Teacher.findById(teacherId)
      .select(
        "teacherId name banglaName designation campus basicSalary houseRent salaryBankAccount pfBankAccount providentFundEnabled"
      )
      .populate("campus", "name")
      .lean();

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }

    const campusScope = resolvePayrollCampuses(req.user, teacher.campus?._id || teacher.campus);
    if (campusScope.error) {
      return res.status(campusScope.status || 403).json({
        message: campusScope.error,
      });
    }

    const attendance = await PayrollAttendance.findOne({
      teacher: teacher._id,
      year: parsed.year,
      month: parsed.month,
    }).lean();

    const payroll = monthlyPayroll({
      basicSalary: teacher.basicSalary,
      houseRent: houseRentFromBasic(teacher.basicSalary || 0),
      presentDays: attendance?.presentDays,
      clDays: attendance?.clDays,
      lwpDays: attendance?.lwpDays,
      providentFundEnabled: teacher.providentFundEnabled,
    });

    res.json({
      year: parsed.year,
      month: parsed.month,
      teacher: serializeTeacher(teacher),
      ...payroll,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load payslip: " + error.message });
  }
};

const getClBenefit = async (req, res) => {
  const parsedYear = parseYear(req.query.year);
  if (parsedYear.error) {
    return res.status(400).json({ message: parsedYear.error });
  }

  const campusScope = resolvePayrollCampuses(req.user, req.query.campus);
  if (campusScope.error) {
    return res.status(campusScope.status || 400).json({
      message: campusScope.error,
    });
  }

  try {
    const teachers = await Teacher.find(teacherQueryForCampuses(campusScope.campusIds))
      .select(
        "teacherId name banglaName designation campus basicSalary houseRent salaryBankAccount pfBankAccount providentFundEnabled"
      )
      .populate("campus", "name")
      .sort({ name: 1 })
      .lean();

    const teacherIds = teachers.map((item) => item._id);
    const yearRows = teacherIds.length
      ? await PayrollAttendance.find({
          teacher: { $in: teacherIds },
          year: parsedYear.year,
        })
          .select("teacher clDays")
          .lean()
      : [];

    const clByTeacher = new Map();
    yearRows.forEach((item) => {
      const key = attendanceMapKey(item.teacher);
      clByTeacher.set(key, (clByTeacher.get(key) || 0) + toNonNegInt(item.clDays));
    });

    const rows = teachers
      .map((teacher) => {
        const clUsed = clByTeacher.get(attendanceMapKey(teacher._id)) || 0;
        const benefit = yearClBenefit({
          basicSalary: teacher.basicSalary,
          clUsed,
        });
        return {
          teacher: serializeTeacher(teacher),
          ...benefit,
        };
      })
      .filter((item) => item.eligible);

    res.json({
      year: parsedYear.year,
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load CL benefit report: " + error.message });
  }
};

const getProvidentFund = async (req, res) => {
  const campusScope = resolvePayrollCampuses(req.user, req.query.campus);
  if (campusScope.error) {
    return res.status(campusScope.status || 400).json({
      message: campusScope.error,
    });
  }

  try {
    const teachers = await Teacher.find(teacherQueryForCampuses(campusScope.campusIds))
      .select(
        "teacherId name banglaName designation campus basicSalary houseRent salaryBankAccount pfBankAccount providentFundEnabled"
      )
      .populate("campus", "name")
      .sort({ name: 1 })
      .lean();

    res.json({
      rows: teachers.map((teacher) => ({
        teacher: serializeTeacher(teacher),
        ...pfFromBasic(teacher.basicSalary || 0, teacher.providentFundEnabled),
      })),
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to load provident fund: " + error.message });
  }
};

const saveProvidentFund = async (req, res) => {
  const incoming = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!incoming.length) {
    return res.status(400).json({ message: "No provident fund rows were provided." });
  }

  try {
    const saved = [];
    for (const row of incoming) {
      const teacherId = row.teacher || row.teacherId;
      if (!mongoose.Types.ObjectId.isValid(teacherId)) {
        return res.status(400).json({ message: "Each row needs a valid teacher id." });
      }

      const teacher = await Teacher.findById(teacherId).select("campus");
      if (!teacher) {
        return res.status(404).json({ message: `Teacher not found: ${teacherId}` });
      }

      const campusScope = resolvePayrollCampuses(req.user, teacher.campus);
      if (campusScope.error) {
        return res.status(campusScope.status || 403).json({
          message: campusScope.error,
        });
      }

      const updated = await Teacher.findByIdAndUpdate(
        teacher._id,
        {
          $set: {
            salaryBankAccount: String(row.salaryBankAccount || "").trim(),
            pfBankAccount: String(row.pfBankAccount || "").trim(),
            providentFundEnabled: Boolean(row.providentFundEnabled),
          },
        },
        { new: true, runValidators: true }
      )
        .select(
          "teacherId name banglaName designation campus basicSalary houseRent salaryBankAccount pfBankAccount providentFundEnabled"
        )
        .populate("campus", "name");

      saved.push({
        teacher: serializeTeacher(updated),
        ...pfFromBasic(updated.basicSalary || 0, updated.providentFundEnabled),
      });
    }

    res.json({
      message: "Provident fund settings saved.",
      count: saved.length,
      rows: saved,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to save provident fund: " + error.message });
  }
};

module.exports = {
  getAttendanceGrid,
  saveAttendance,
  getSalaryReport,
  getPayslip,
  getClBenefit,
  getProvidentFund,
  saveProvidentFund,
};
