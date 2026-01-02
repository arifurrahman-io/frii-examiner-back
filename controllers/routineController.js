const Routine = require("../models/RoutineModel");
const Teacher = require("../models/TeacherModel");
const Class = require("../models/ClassModel");
const Subject = require("../models/SubjectModel");
const Branch = require("../models/BranchModel");
const xlsx = require("xlsx");
const mongoose = require("mongoose");

/**
 * --- 1. Add Routine (Manual) ---
 * Logic: Admin can add for anyone.
 * Incharge can only add if the teacher belongs to their campus.
 */
const addRoutine = async (req, res) => {
  const { teacher, year, className, subject } = req.body;
  const yearInt = parseInt(year);

  try {
    // 🛡️ ROLE PROTECTION
    if (req.user.role === "incharge") {
      const targetTeacher = await Teacher.findById(teacher);
      if (
        !targetTeacher ||
        String(targetTeacher.campus) !== String(req.user.campus)
      ) {
        return res.status(403).json({
          message:
            "Access Denied: You can only manage routines for teachers in your campus node.",
        });
      }
    }

    const assignmentDetail = { className, subject };

    // 1. Ensure a Routine document exists for the teacher.
    await Routine.findOneAndUpdate(
      { teacher: teacher },
      { $setOnInsert: { teacher: teacher } },
      { upsert: true }
    );

    // 2. Check for duplication (teacher, year, class, subject)
    const existingAssignment = await Routine.findOne({
      teacher: teacher,
      years: {
        $elemMatch: {
          year: yearInt,
          "assignments.className": className,
          "assignments.subject": subject,
        },
      },
    });

    if (existingAssignment) {
      return res.status(400).json({
        message: `This routine already exists for this teacher in ${yearInt}.`,
      });
    }

    // 3. Attempt to push to the existing year's array.
    let result = await Routine.findOneAndUpdate(
      { teacher: teacher, "years.year": yearInt },
      { $push: { "years.$.assignments": assignmentDetail } },
      { new: true }
    );

    // 4. If the year doesn't exist, push a new year object.
    if (!result) {
      result = await Routine.findOneAndUpdate(
        { teacher: teacher },
        {
          $push: { years: { year: yearInt, assignments: [assignmentDetail] } },
        },
        { new: true }
      );
    }

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: "Error adding routine: " + error.message });
  }
};

/**
 * --- 2. Get Teacher Routines ---
 * Logic: Admin can view all.
 * Incharge can only view if the teacher belongs to their campus.
 */
const getTeacherRoutines = async (req, res) => {
  const { teacherId } = req.params;
  const { year } = req.query;

  try {
    // 🛡️ ROLE PROTECTION
    if (req.user.role === "incharge") {
      const targetTeacher = await Teacher.findById(teacherId);
      if (
        !targetTeacher ||
        String(targetTeacher.campus) !== String(req.user.campus)
      ) {
        return res.status(403).json({
          message: "Access Denied: Teacher belongs to a different campus node.",
        });
      }
    }

    const routines = await Routine.findOne({ teacher: teacherId })
      .select("years")
      .populate({ path: "years.assignments.className", select: "name" })
      .populate({ path: "years.assignments.subject", select: "name" })
      .lean();

    if (!routines) return res.json([]);

    let formattedRoutines = [];
    routines.years.forEach((y) => {
      if (!year || y.year === parseInt(year)) {
        y.assignments.forEach((r) => {
          formattedRoutines.push({
            _id: r._id,
            year: y.year,
            display: `${r.subject?.name || "N/A"} [${
              r.className?.name || "N/A"
            }] - ${y.year}`,
            classNameId: r.className?._id,
            subjectId: r.subject?._id,
          });
        });
      }
    });

    res.json(formattedRoutines.sort((a, b) => b.year - a.year));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch teacher routines." });
  }
};

/**
 * --- 3. Filter Eligible Teachers ---
 * Logic: Admin sees global results.
 * Incharge sees results only from their campus.
 */
const getTeachersByRoutine = async (req, res) => {
  const { year, classId, subjectId } = req.query;
  const yearInt = parseInt(year);

  if (!year || !classId || !subjectId) {
    return res
      .status(400)
      .json({ message: "Year, Class, and Subject IDs are required." });
  }

  try {
    const routines = await Routine.find({
      "years.year": yearInt,
      "years.assignments": {
        $elemMatch: {
          className: new mongoose.Types.ObjectId(classId),
          subject: new mongoose.Types.ObjectId(subjectId),
        },
      },
    }).populate({
      path: "teacher",
      select: "teacherId name phone campus",
      populate: { path: "campus", select: "name" },
    });

    let teachers = routines.map((r) => r.teacher).filter((t) => t);

    // 🛡️ ROLE FILTERING
    if (req.user.role === "incharge") {
      teachers = teachers.filter(
        (t) => String(t.campus?._id || t.campus) === String(req.user.campus)
      );
    }

    res.json(teachers);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching eligible teachers: " + error.message });
  }
};

/**
 * --- 4. Delete Routine Entry ---
 * Logic: Admin can delete any.
 * Incharge can only delete if the teacher linked to the routine belongs to their campus.
 */
const deleteRoutine = async (req, res) => {
  const routineId = req.params.id;

  try {
    const routineDoc = await Routine.findOne({
      "years.assignments._id": routineId,
    });
    if (!routineDoc)
      return res.status(404).json({ message: "Routine entry not found." });

    // 🛡️ ROLE PROTECTION
    if (req.user.role === "incharge") {
      const targetTeacher = await Teacher.findById(routineDoc.teacher);
      if (String(targetTeacher.campus) !== String(req.user.campus)) {
        return res.status(403).json({
          message: "Unauthorized: Access denied for this campus node.",
        });
      }
    }

    const result = await Routine.findOneAndUpdate(
      { "years.assignments._id": routineId },
      { $pull: { "years.$.assignments": { _id: routineId } } },
      { new: true }
    );

    res.json({ message: "Routine entry successfully deleted." });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting routine: " + error.message });
  }
};

/**
 * --- 5. Bulk Upload Routines ---
 * Logic: Admin can upload for any branch.
 * Incharge is strictly restricted to their own branch name in the Excel file.
 */
const bulkUploadRoutines = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetData = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1 }
    );
    const headers = sheetData[0].map((h) =>
      h ? h.toLowerCase().trim().replace(/\s/g, "") : ""
    );
    const dataRows = sheetData.slice(1);

    const [branches, classes, subjects, teachers] = await Promise.all([
      Branch.find({}).lean(),
      Class.find({}).lean(),
      Subject.find({}).lean(),
      Teacher.find({}).lean(),
    ]);

    const branchMap = new Map(branches.map((b) => [b.name.toLowerCase(), b]));
    const classMap = new Map(classes.map((c) => [c.name.toLowerCase(), c._id]));
    const subjectMap = new Map(
      subjects.map((s) => [s.name.toLowerCase(), s._id])
    );
    const teacherIdMap = new Map(teachers.map((t) => [t.teacherId, t]));

    const bulkErrors = [];
    let successCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;

      const teacherId = row[headers.indexOf("teacherid")];
      const branchName = row[headers.indexOf("branchname")]
        ?.toString()
        .toLowerCase();
      const className = row[headers.indexOf("classname")]
        ?.toString()
        .toLowerCase();
      const subjectName = row[headers.indexOf("subjectname")]
        ?.toString()
        .toLowerCase();
      const year = parseInt(row[headers.indexOf("year")]);

      if (!teacherId || !branchName || !className || !subjectName || !year) {
        bulkErrors.push(`Row ${rowNum}: Missing required fields.`);
        continue;
      }

      // 🛡️ ROLE VALIDATION (Campus Locking)
      const targetBranch = branchMap.get(branchName);
      if (req.user.role === "incharge") {
        if (
          !targetBranch ||
          String(targetBranch._id) !== String(req.user.campus)
        ) {
          bulkErrors.push(
            `Row ${rowNum}: Denied. Branch "${branchName}" is not your assigned campus.`
          );
          continue;
        }
      }

      const teacherDoc = teacherIdMap.get(teacherId);
      const classId = classMap.get(className);
      const subjectId = subjectMap.get(subjectName);

      if (!teacherDoc || !classId || !subjectId) {
        bulkErrors.push(`Row ${rowNum}: Invalid TeacherID, Class, or Subject.`);
        continue;
      }

      // Double Check: Ensure teacher is actually assigned to that branch in the DB
      if (String(teacherDoc.campus) !== String(targetBranch?._id)) {
        bulkErrors.push(
          `Row ${rowNum}: Data Conflict. Teacher belongs to ${teacherDoc.campus}, not ${branchName}.`
        );
        continue;
      }

      // Upsert Routine
      await Routine.findOneAndUpdate(
        { teacher: teacherDoc._id },
        { $setOnInsert: { teacher: teacherDoc._id } },
        { upsert: true }
      );

      // Remove existing duplicate for overwrite logic
      await Routine.findOneAndUpdate(
        { teacher: teacherDoc._id, "years.year": year },
        {
          $pull: {
            "years.$.assignments": { className: classId, subject: subjectId },
          },
        }
      );

      // Push new assignment
      let updateOp = await Routine.findOneAndUpdate(
        { teacher: teacherDoc._id, "years.year": year },
        {
          $push: {
            "years.$.assignments": { className: classId, subject: subjectId },
          },
        },
        { new: true }
      );

      if (!updateOp) {
        await Routine.findOneAndUpdate(
          { teacher: teacherDoc._id },
          {
            $push: {
              years: {
                year: year,
                assignments: [{ className: classId, subject: subjectId }],
              },
            },
          }
        );
      }
      successCount++;
    }

    res.json({
      message: `Bulk processing finished. ${successCount} entries synced.`,
      errors: bulkErrors,
    });
  } catch (error) {
    res.status(500).json({
      message: "System error during bulk processing: " + error.message,
    });
  }
};

module.exports = {
  addRoutine,
  getTeacherRoutines,
  getTeachersByRoutine,
  deleteRoutine,
  bulkUploadRoutines,
};
