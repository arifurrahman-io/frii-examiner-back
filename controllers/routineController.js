const Routine = require("../models/RoutineModel");
const Teacher = require("../models/TeacherModel");
const Class = require("../models/ClassModel");
const Subject = require("../models/SubjectModel");
const Branch = require("../models/BranchModel");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const User = require("../models/UserModel");
const bcrypt = require("bcryptjs");
const xlsx = require("xlsx");
const mongoose = require("mongoose");

const normalizeLookupKey = (value) => value?.toString().trim().toLowerCase();
const normalizeTeacherId = (value) => value?.toString().trim();

const buildRoutineAssignmentMatch = ({ teacher, year, className, subject }) => ({
  teacher,
  years: {
    $elemMatch: {
      year,
      assignments: {
        $elemMatch: {
          className,
          subject,
        },
      },
    },
  },
});

const getHeaderIndex = (headers, acceptedNames) => {
  const headerName = acceptedNames.find((name) => headers.includes(name));
  return headerName ? headers.indexOf(headerName) : -1;
};

const getCellValue = (row, headers, acceptedNames) => {
  const index = getHeaderIndex(headers, acceptedNames);
  return index >= 0 ? row[index] : undefined;
};

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
    const existingAssignment = await Routine.findOne(
      buildRoutineAssignmentMatch({
        teacher,
        year: yearInt,
        className,
        subject,
      })
    );

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

const updateRoutine = async (req, res) => {
  const routineId = req.params.id;
  const { year, className, subject } = req.body;
  const yearInt = parseInt(year, 10);

  if (!yearInt || !className || !subject) {
    return res.status(400).json({
      message: "Year, Class, and Subject are required to update routine.",
    });
  }

  try {
    const routineDoc = await Routine.findOne({
      "years.assignments._id": routineId,
    });

    if (!routineDoc) {
      return res.status(404).json({ message: "Routine entry not found." });
    }

    if (req.user.role === "incharge") {
      const targetTeacher = await Teacher.findById(routineDoc.teacher);
      if (
        !targetTeacher ||
        String(targetTeacher.campus) !== String(req.user.campus)
      ) {
        return res.status(403).json({
          message: "Unauthorized: Access denied for this campus node.",
        });
      }
    }

    const duplicate = routineDoc.years.some(
      (yearBlock) =>
        yearBlock.year === yearInt &&
        yearBlock.assignments.some(
          (assignment) =>
            String(assignment._id) !== String(routineId) &&
            String(assignment.className) === String(className) &&
            String(assignment.subject) === String(subject)
        )
    );

    if (duplicate) {
      return res.status(400).json({
        message: `This routine already exists for this teacher in ${yearInt}.`,
      });
    }

    let existingAssignment = null;
    routineDoc.years.forEach((yearBlock) => {
      const match = yearBlock.assignments.id(routineId);
      if (match) {
        existingAssignment = match;
        match.deleteOne();
      }
    });

    if (!existingAssignment) {
      return res.status(404).json({ message: "Routine entry not found." });
    }

    let targetYear = routineDoc.years.find((y) => y.year === yearInt);
    if (!targetYear) {
      routineDoc.years.push({ year: yearInt, assignments: [] });
      targetYear = routineDoc.years[routineDoc.years.length - 1];
    }

    targetYear.assignments.push({
      _id: existingAssignment._id,
      className,
      subject,
      slot: existingAssignment.slot,
    });

    await routineDoc.save();
    res.json({ message: "Routine entry updated.", routine: routineDoc });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating routine: " + error.message });
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
      years: {
        $elemMatch: {
          year: yearInt,
          assignments: {
            $elemMatch: {
              className: new mongoose.Types.ObjectId(classId),
              subject: new mongoose.Types.ObjectId(subjectId),
            },
          },
        },
      },
    })
      .populate({
        path: "teacher",
        select: "teacherId name phone campus",
        populate: { path: "campus", select: "name" },
      })
      .populate({ path: "years.assignments.className", select: "name" })
      .populate({ path: "years.assignments.subject", select: "name" })
      .lean();

    let eligibleEntries = routines
      .map((routine) => ({ routine, teacher: routine.teacher }))
      .filter((entry) => entry.teacher);

    // 🛡️ ROLE FILTERING
    if (req.user.role === "incharge") {
      eligibleEntries = eligibleEntries.filter(
        ({ teacher }) =>
          String(teacher.campus?._id || teacher.campus) ===
          String(req.user.campus)
      );
    }

    const teacherIds = eligibleEntries.map(
      ({ teacher }) => new mongoose.Types.ObjectId(teacher._id)
    );
    const assignmentsByTeacher = new Map();

    if (teacherIds.length > 0) {
      const assignmentGroups = await ResponsibilityAssignment.aggregate([
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
    }

    const teachers = eligibleEntries.map(({ teacher, routine }) => {
      const routineSchedule = [];

      routine.years.forEach((yearBlock) => {
        if (yearBlock.year === yearInt) {
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

      return {
        ...teacher,
        assignmentsByYear: assignmentsByTeacher.get(String(teacher._id)) || [],
        routineSchedule,
      };
    });

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
 * --- 5. Delete Complete Routine For Year ---
 * Admin only: Removes every routine assignment block for a specific academic year.
 */
const deleteRoutinesByYear = async (req, res) => {
  const yearInt = parseInt(req.params.year, 10);
  const { password } = req.body;

  if (!yearInt) {
    return res.status(400).json({ message: "A valid year is required." });
  }

  if (!password) {
    return res.status(400).json({ message: "Admin password is required." });
  }

  try {
    const adminUser = await User.findById(req.user._id).select("+password");

    if (!adminUser || adminUser.role !== "admin") {
      return res.status(403).json({ message: "Admin authorization failed." });
    }

    const passwordMatches = await bcrypt.compare(password, adminUser.password);

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Admin password did not match. Routine deletion was not started.",
      });
    }

    const matchedRoutineDocs = await Routine.find({ "years.year": yearInt })
      .select("years")
      .lean();

    const assignmentsDeleted = matchedRoutineDocs.reduce((total, doc) => {
      const yearBlock = doc.years.find((item) => item.year === yearInt);
      return total + (yearBlock?.assignments?.length || 0);
    }, 0);

    const updateResult = await Routine.updateMany(
      { "years.year": yearInt },
      { $pull: { years: { year: yearInt } } }
    );

    const emptyDeleteResult = await Routine.deleteMany({ years: { $size: 0 } });

    res.json({
      message: `Complete routine for ${yearInt} deleted.`,
      year: yearInt,
      teachersAffected: updateResult.modifiedCount || 0,
      assignmentsDeleted,
      emptyRoutineDocsDeleted: emptyDeleteResult.deletedCount || 0,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error deleting yearly routines: " + error.message,
    });
  }
};

/**
 * --- 6. Bulk Upload Routines ---
 * Logic: Admin can upload for any branch.
 * Incharge is strictly restricted to their own branch name in the Excel file.
 */
const bulkUploadRoutines = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  try {
    const duplicateMode =
      req.body.duplicateMode === "overwrite" ? "overwrite" : "skip";
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetData = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1 }
    );

    if (!sheetData.length || !Array.isArray(sheetData[0])) {
      return res.status(400).json({ message: "Excel sheet is empty." });
    }

    const headers = sheetData[0].map((h) =>
      h ? h.toLowerCase().trim().replace(/\s/g, "") : ""
    );
    const dataRows = sheetData
      .slice(1)
      .filter((row) => Array.isArray(row) && row.some((cell) => cell));

    const [branches, classes, subjects, teachers] = await Promise.all([
      Branch.find({}).lean(),
      Class.find({}).lean(),
      Subject.find({}).lean(),
      Teacher.find({}).lean(),
    ]);

    const branchMap = new Map(
      branches.map((b) => [normalizeLookupKey(b.name), b])
    );
    const classMap = new Map(
      classes.map((c) => [normalizeLookupKey(c.name), c._id])
    );
    const subjectMap = new Map(
      subjects.map((s) => [normalizeLookupKey(s.name), s._id])
    );
    const teacherIdMap = new Map(
      teachers.map((t) => [normalizeTeacherId(t.teacherId), t])
    );
    const teacherPhoneMap = new Map(
      teachers
        .filter((t) => t.phone?.toString().trim())
        .map((t) => [t.phone.toString().trim(), t])
    );

    const bulkErrors = [];
    const stats = {
      totalRows: dataRows.length,
      processedCount: 0,
      uploadedCount: 0,
      createdTeachersCount: 0,
      updatedTeacherCampusesCount: 0,
      overwrittenCount: 0,
      skippedCount: 0,
      failedCount: 0,
      remainingCount: 0,
      progressPercentage: 0,
    };

    const updateProgress = () => {
      stats.processedCount =
        stats.uploadedCount + stats.skippedCount + stats.failedCount;
      stats.remainingCount = Math.max(stats.totalRows - stats.processedCount, 0);
      stats.progressPercentage = stats.totalRows
        ? Math.round((stats.processedCount / stats.totalRows) * 100)
        : 100;
    };

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;

      const teacherId = normalizeTeacherId(
        getCellValue(row, headers, ["teacherid"])
      );
      const teacherName = getCellValue(row, headers, [
        "teachername",
        "teacher",
        "name",
      ])
        ?.toString()
        .trim();
      const phone =
        getCellValue(row, headers, ["phone", "mobileno", "mobile"])
          ?.toString()
          .trim() || undefined;
      const designation = getCellValue(row, headers, [
        "designation",
        "position",
      ])
        ?.toString()
        .trim();
      const branchName = normalizeLookupKey(
        getCellValue(row, headers, ["branchname", "branch", "campus"])
      );
      const className = normalizeLookupKey(
        getCellValue(row, headers, ["classname", "class"])
      );
      const subjectName = normalizeLookupKey(
        getCellValue(row, headers, ["subjectname", "subject"])
      );
      const year = parseInt(getCellValue(row, headers, ["year"]), 10);

      if (!teacherId || !branchName || !className || !subjectName || !year) {
        bulkErrors.push(`Row ${rowNum}: Missing required fields.`);
        stats.failedCount++;
        updateProgress();
        continue;
      }

      // 🛡️ ROLE VALIDATION (Campus Locking)
      const targetBranch = branchMap.get(branchName);
      if (!targetBranch) {
        bulkErrors.push(`Row ${rowNum}: Invalid Branch.`);
        stats.failedCount++;
        updateProgress();
        continue;
      }
      if (req.user.role === "incharge") {
        if (String(targetBranch._id) !== String(req.user.campus)) {
          bulkErrors.push(
            `Row ${rowNum}: Denied. Branch "${branchName}" is not your assigned campus.`
          );
          stats.failedCount++;
          updateProgress();
          continue;
        }
      }

      let teacherDoc = teacherIdMap.get(teacherId);
      const classId = classMap.get(className);
      const subjectId = subjectMap.get(subjectName);

      if (!classId || !subjectId) {
        bulkErrors.push(`Row ${rowNum}: Invalid Class or Subject.`);
        stats.failedCount++;
        updateProgress();
        continue;
      }

      if (!teacherDoc) {
        if (!teacherName) {
          bulkErrors.push(
            `Row ${rowNum}: New teacher ${teacherId} requires TeacherName or Name.`
          );
          stats.failedCount++;
          updateProgress();
          continue;
        }

        if (phone && teacherPhoneMap.has(phone)) {
          bulkErrors.push(
            `Row ${rowNum}: Phone already belongs to another teacher.`
          );
          stats.failedCount++;
          updateProgress();
          continue;
        }

        const newTeacherData = {
          teacherId,
          name: teacherName,
          campus: targetBranch._id,
        };
        if (phone) newTeacherData.phone = phone;
        if (designation) newTeacherData.designation = designation;

        teacherDoc = await Teacher.create(newTeacherData);
        teacherIdMap.set(teacherId, teacherDoc);
        if (phone) teacherPhoneMap.set(phone, teacherDoc);
        stats.createdTeachersCount++;
      }

      // Routine uploads define the teacher's current campus for that academic year import.
      if (String(teacherDoc.campus) !== String(targetBranch._id)) {
        const updatedTeacher = await Teacher.findByIdAndUpdate(
          teacherDoc._id,
          { campus: targetBranch._id },
          { new: true }
        ).lean();

        teacherDoc = updatedTeacher || {
          ...teacherDoc,
          campus: targetBranch._id,
        };
        teacherIdMap.set(teacherId, teacherDoc);
        stats.updatedTeacherCampusesCount++;
      }

      // Upsert Routine
      await Routine.findOneAndUpdate(
        { teacher: teacherDoc._id },
        { $setOnInsert: { teacher: teacherDoc._id } },
        { upsert: true }
      );

      const duplicateRoutine = await Routine.findOne(
        buildRoutineAssignmentMatch({
          teacher: teacherDoc._id,
          year,
          className: classId,
          subject: subjectId,
        })
      );

      if (duplicateRoutine && duplicateMode === "skip") {
        stats.skippedCount++;
        updateProgress();
        continue;
      }

      if (duplicateRoutine && duplicateMode === "overwrite") {
        await Routine.findOneAndUpdate(
          { teacher: teacherDoc._id, "years.year": year },
          {
            $pull: {
              "years.$.assignments": { className: classId, subject: subjectId },
            },
          }
        );
        stats.overwrittenCount++;
      }

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
      stats.uploadedCount++;
      updateProgress();
    }

    updateProgress();

    res.json({
      message: `Bulk processing finished. ${stats.uploadedCount} entries synced.`,
      savedRoutinesCount: stats.uploadedCount,
      ...stats,
      duplicateMode,
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
  updateRoutine,
  getTeacherRoutines,
  getTeachersByRoutine,
  deleteRoutine,
  deleteRoutinesByYear,
  bulkUploadRoutines,
};
