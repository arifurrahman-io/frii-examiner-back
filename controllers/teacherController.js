const Teacher = require("../models/TeacherModel");
const Branch = require("../models/BranchModel");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const TeacherRoutine = require("../models/RoutineModel"); // রুটিন মডেল
const GrantedLeave = require("../models/LeaveModel"); // লিভ মডেল
const mongoose = require("mongoose");
const xlsx = require("xlsx");

// --- ১. নতুন শিক্ষক যোগ করা ---
const addTeacher = async (req, res) => {
  const { teacherId, name, phone, campus, designation } = req.body;
  try {
    const targetCampusId =
      req.user.role === "incharge" ? req.user.campus : campus;

    if (!targetCampusId) {
      return res.status(400).json({
        message: "Campus synchronization failed: Target node missing.",
      });
    }

    const duplicateFilters = [{ teacherId }];
    if (phone) duplicateFilters.push({ phone });
    const teacherExists = await Teacher.findOne({ $or: duplicateFilters });
    if (teacherExists) {
      return res.status(409).json({
        message: "Conflict detected: Teacher ID or Phone already indexed.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(targetCampusId)) {
      return res
        .status(400)
        .json({ message: "Invalid Campus Node ID format." });
    }

    const branch = await Branch.findById(targetCampusId);
    if (!branch) {
      return res
        .status(404)
        .json({ message: "Assigned Campus node not found." });
    }

    const newTeacher = await Teacher.create({
      teacherId,
      name,
      phone,
      campus: branch._id,
      designation,
    });

    res.status(201).json({
      success: true,
      message: "Neural profile synchronized.",
      data: newTeacher,
      teacher: newTeacher,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Protocol Error.",
      error: error.message,
    });
  }
};

// --- ২. সকল শিক্ষক দেখা ও সার্চ করা ---
const getAllTeachers = async (req, res) => {
  const { search, page = 1, limit = 20, includeDetails } = req.query;
  const pageInt = parseInt(page);
  const limitInt = parseInt(limit);
  const skip = (pageInt - 1) * limitInt;

  try {
    let query = {};
    if (req.user.role === "incharge") {
      query.campus = req.user.campus;
    }

    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      query.$and = [
        ...(query.campus ? [{ campus: query.campus }] : []),
        {
          $or: [
            { name: searchRegex },
            { teacherId: searchRegex },
            { phone: searchRegex },
          ],
        },
      ];
      delete query.campus;
    }

    const totalTeachers = await Teacher.countDocuments(query);
    const teachers = await Teacher.find(query)
      .limit(limitInt)
      .skip(skip)
      .populate("campus", "name")
      .sort({ name: 1 })
      .lean();

    if (includeDetails === "true" && teachers.length > 0) {
      const currentYear = new Date().getFullYear();
      const teacherIds = teachers.map(
        (teacher) => new mongoose.Types.ObjectId(teacher._id)
      );
      const assignmentsByTeacher = new Map();
      const routinesByTeacher = new Map();

      const [assignmentGroups, routineDocs] = await Promise.all([
        ResponsibilityAssignment.aggregate([
          { $match: { teacher: { $in: teacherIds } } },
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
            $unwind: {
              path: "$classDetails",
              preserveNullAndEmptyArrays: true,
            },
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
            $group: {
              _id: { teacher: "$teacher", year: "$year" },
              responsibilities: {
                $push: {
                  _id: "$_id",
                  name: "$typeDetails.name",
                  class: { $ifNull: ["$classDetails.name", "N/A"] },
                  subject: { $ifNull: ["$subjectDetails.name", "N/A"] },
                  status: "$status",
                },
              },
            },
          },
          { $sort: { "_id.year": -1 } },
        ]),
        TeacherRoutine.find({ teacher: { $in: teacherIds } })
          .select("teacher years")
          .populate({ path: "years.assignments.className", select: "name" })
          .populate({ path: "years.assignments.subject", select: "name" })
          .lean(),
      ]);

      assignmentGroups.forEach((group) => {
        const teacherKey = String(group._id.teacher);
        if (!assignmentsByTeacher.has(teacherKey)) {
          assignmentsByTeacher.set(teacherKey, []);
        }
        assignmentsByTeacher.get(teacherKey).push({
          _id: group._id.year,
          responsibilities: group.responsibilities,
        });
      });

      routineDocs.forEach((routine) => {
        const teacherKey = String(routine.teacher);
        const routineSchedule = [];

        routine.years.forEach((yearBlock) => {
          if (yearBlock.year === currentYear) {
            yearBlock.assignments.forEach((assignment) => {
              routineSchedule.push({
                _id: assignment._id,
                year: yearBlock.year,
                display: `${assignment.subject?.name || "N/A"} [${
                  assignment.className?.name || "N/A"
                }] - ${yearBlock.year}`,
                classNameId: assignment.className?._id,
                subjectId: assignment.subject?._id,
              });
            });
          }
        });

        routinesByTeacher.set(teacherKey, routineSchedule);
      });

      teachers.forEach((teacher) => {
        const teacherKey = String(teacher._id);
        teacher.assignmentsByYear = assignmentsByTeacher.get(teacherKey) || [];
        teacher.routineSchedule = routinesByTeacher.get(teacherKey) || [];
      });
    }

    res.json({
      teachers,
      page: pageInt,
      totalPages: Math.ceil(totalTeachers / limitInt),
      totalTeachers,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch matrix: " + error.message });
  }
};

// --- ৩. শিক্ষকের প্রোফাইল ও ম্যাট্রিক্স ---
const getTeacherProfile = async (req, res) => {
  const teacherObjectId = req.params.id;
  try {
    const teacher = await Teacher.findById(teacherObjectId).populate(
      "campus",
      "name description"
    );

    if (!teacher)
      return res.status(404).json({ message: "Teacher node not found." });

    if (
      req.user.role === "incharge" &&
      String(teacher.campus._id) !== String(req.user.campus)
    ) {
      return res
        .status(403)
        .json({ message: "Access Denied: Vector Mismatch." });
    }

    const assignmentsByYear = await ResponsibilityAssignment.aggregate([
      { $match: { teacher: new mongoose.Types.ObjectId(teacherObjectId) } },
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
      { $unwind: { path: "$classDetails", preserveNullAndEmptyArrays: true } },
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
        $group: {
          _id: "$year",
          responsibilities: {
            $push: {
              _id: "$_id",
              name: "$typeDetails.name",
              class: { $ifNull: ["$classDetails.name", "N/A"] },
              subject: { $ifNull: ["$subjectDetails.name", "N/A"] },
            },
          },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    res.json({ teacherDetails: teacher, assignmentsByYear });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- 🚀 ৪. শিক্ষক স্থায়ীভাবে মুছে ফেলা (Purge Teacher with all Data) ---
const deleteTeacher = async (req, res) => {
  const teacherId = req.params.id;

  try {
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res
        .status(404)
        .json({ message: "Teacher node not found in registry." });
    }

    // শুধুমাত্র অ্যাডমিন ডিলিট করতে পারবে
    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Access Denied: Admin authorization required to purge nodes.",
      });
    }

    // 🛡️ CRITICAL ACTION: ডিলিট করার আগে সংশ্লিষ্ট সকল ডেটা মুছে ফেলা হচ্ছে
    await Promise.all([
      Teacher.findByIdAndDelete(teacherId), // শিক্ষক ডিলিট
      ResponsibilityAssignment.deleteMany({ teacher: teacherId }), // সকল অ্যাসাইনমেন্ট ডিলিট
      TeacherRoutine.deleteMany({ teacher: teacherId }), // সকল রুটিন ডিলিট
      GrantedLeave.deleteMany({ teacher: teacherId }), // সকল লিভ রেকর্ড ডিলিট
    ]);

    res.status(200).json({
      success: true,
      message: `Teacher node [${teacher.name}] and all associated responsibilities/routines have been purged from the matrix.`,
    });
  } catch (error) {
    console.error("Purge Failure:", error);
    res
      .status(500)
      .json({ message: "System failure during purge: " + error.message });
  }
};

// --- ৫. বার্ষিক রিপোর্ট, ৬. আপডেট এবং ৭. বাল্ক আপলোড (অপরিবর্তিত) ---
const addAnnualReport = async (req, res) => {
  const teacherObjectId = req.params.id;
  const { year, responsibility, performanceReport } = req.body;
  try {
    const teacher = await Teacher.findById(teacherObjectId);
    if (!teacher)
      return res.status(404).json({ message: "Teacher not found." });
    if (
      req.user.role === "incharge" &&
      String(teacher.campus) !== String(req.user.campus)
    ) {
      return res.status(403).json({ message: "Unauthorized node access." });
    }
    teacher.reports.push({
      year: Number(year),
      responsibility,
      performanceReport,
      addedBy: req.user.id,
      date: new Date(),
    });
    await teacher.save();
    res
      .status(200)
      .json({ message: "Report indexed.", reports: teacher.reports });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateTeacher = async (req, res) => {
  const teacherObjectId = req.params.id;
  try {
    const teacherToUpdate = await Teacher.findById(teacherObjectId);
    if (!teacherToUpdate)
      return res.status(404).json({ message: "Teacher not found." });
    if (
      req.user.role === "incharge" &&
      String(teacherToUpdate.campus) !== String(req.user.campus)
    ) {
      return res.status(403).json({ message: "Restriction: External node." });
    }
    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherObjectId,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate("campus", "name");
    res.json({ message: "Teacher synchronized.", teacher: updatedTeacher });
  } catch (error) {
    res.status(500).json({ message: "Update failure: " + error.message });
  }
};

const bulkUploadTeachers = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });
  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetData = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: "" }
    );

    const branches = await Branch.find({ isActive: true }).lean();
    const branchMap = new Map(
      branches.flatMap((branch) => [
        [branch.name?.toLowerCase(), branch],
        [branch.location?.toLowerCase(), branch],
      ])
    );

    const errors = [];
    const createdTeachers = [];

    for (let index = 0; index < sheetData.length; index++) {
      const row = sheetData[index];
      const rowNumber = index + 2;
      const normalizedRow = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.toLowerCase().trim().replace(/\s/g, ""),
          value,
        ])
      );

      const teacherId = String(
        normalizedRow.teacherid || normalizedRow.id || ""
      ).trim();
      const name = String(normalizedRow.name || normalizedRow.teachername || "")
        .trim();
      const phone = String(normalizedRow.phone || normalizedRow.mobile || "")
        .trim();
      const designation = String(normalizedRow.designation || "").trim();
      const campusName = String(
        normalizedRow.campus ||
          normalizedRow.branch ||
          normalizedRow.branchname ||
          ""
      )
        .trim()
        .toLowerCase();

      if (!teacherId || !name) {
        errors.push(`Row ${rowNumber}: Teacher ID and Name are required.`);
        continue;
      }

      let campusId = req.user.role === "incharge" ? req.user.campus : null;
      if (req.user.role === "admin") {
        const branch = branchMap.get(campusName);
        if (!branch) {
          errors.push(`Row ${rowNumber}: Campus/Branch not found.`);
          continue;
        }
        campusId = branch._id;
      }

      if (!campusId) {
        errors.push(`Row ${rowNumber}: Campus is required.`);
        continue;
      }

      const branch = await Branch.findById(campusId);
      if (!branch) {
        errors.push(`Row ${rowNumber}: Assigned campus does not exist.`);
        continue;
      }

      if (
        req.user.role === "incharge" &&
        campusName &&
        branch.name.toLowerCase() !== campusName
      ) {
        errors.push(`Row ${rowNumber}: Campus is outside your access scope.`);
        continue;
      }

      const duplicateFilters = [{ teacherId }];
      if (phone) duplicateFilters.push({ phone });
      const existingTeacher = await Teacher.findOne({ $or: duplicateFilters });
      if (existingTeacher) {
        errors.push(`Row ${rowNumber}: Teacher ID or Phone already exists.`);
        continue;
      }

      const teacher = await Teacher.create({
        teacherId,
        name,
        phone,
        campus: campusId,
        designation,
      });
      createdTeachers.push(teacher);
    }

    res.status(200).json({
      message: `Bulk add completed. ${createdTeachers.length} teachers indexed.`,
      savedCount: createdTeachers.length,
      errors,
    });
  } catch (error) {
    res.status(500).json({ message: "Bulk upload failed: " + error.message });
  }
};

// teacherController.js এ যুক্ত করুন
const deleteAnnualReport = async (req, res) => {
  try {
    const { id, reportId } = req.params; // id = teacherId, reportId = specific report's id

    const teacher = await Teacher.findByIdAndUpdate(
      id,
      { $pull: { reports: { _id: reportId } } },
      { new: true }
    );

    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher node not found." });
    }

    res.json({
      success: true,
      message: "Report successfully purged from matrix.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Protocol Error: Purge failed.",
    });
  }
};

module.exports = {
  addTeacher,
  getAllTeachers,
  addAnnualReport,
  getTeacherProfile,
  bulkUploadTeachers,
  updateTeacher,
  deleteTeacher,
  deleteAnnualReport,
};
