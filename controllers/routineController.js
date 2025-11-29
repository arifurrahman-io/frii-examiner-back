const Routine = require("../models/RoutineModel");
const Teacher = require("../models/TeacherModel");
const Class = require("../models/ClassModel");
const Subject = require("../models/SubjectModel");
const Branch = require("../models/BranchModel");
const xlsx = require("xlsx");
const mongoose = require("mongoose");

// --- 1. রুটিন অ্যাসাইন করা (Add Routine - Manual) ---
const addRoutine = async (req, res) => {
  const { teacher, year, className, subject } = req.body;
  const yearInt = parseInt(year);

  try {
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
        message: `This routine (Class/Subject in ${yearInt}) already exists for this teacher.`,
      });
    }

    // 3. Attempt to push to the existing year's array.
    let result = await Routine.findOneAndUpdate(
      { teacher: teacher, "years.year": yearInt },
      { $push: { "years.$.assignments": assignmentDetail } },
      { new: true }
    );

    // 4. If the year doesn't exist, push a new year object with the assignment.
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

// --- 2. শিক্ষকের রুটিন দেখা (Get Teacher Routines) ---
const getTeacherRoutines = async (req, res) => {
  const { teacherId } = req.params;
  const { year } = req.query;

  try {
    let filter = { teacher: teacherId };

    // 1. Find the Routine document
    const routines = await Routine.findOne(filter)
      .select("years")
      .populate({
        path: "years.assignments.className",
        select: "name",
      })
      .populate({
        path: "years.assignments.subject",
        select: "name",
      })
      .lean();

    if (!routines) {
      return res.json([]);
    }

    // 2. Flatten the nested array structure for the frontend display
    let formattedRoutines = [];
    routines.years.forEach((y) => {
      if (!year || y.year === parseInt(year)) {
        y.assignments.forEach((r) => {
          const subjectName = r.subject ? r.subject.name : "SUBJECT MISSING";
          const className = r.className ? r.className.name : "CLASS MISSING";

          formattedRoutines.push({
            _id: r._id, // The assignment subdocument _id for deletion
            year: y.year,
            display: `${subjectName} [${className}] - ${y.year}`,
            classNameId: r.className?._id,
            subjectId: r.subject?._id,
          });
        });
      }
    });

    formattedRoutines.sort((a, b) => b.year - a.year);

    res.json(formattedRoutines);
  } catch (error) {
    console.error("Routine fetch error:", error);
    res.status(500).json({ message: "Failed to fetch teacher routines." });
  }
};

// --- 3. যোগ্য শিক্ষক ফিল্টার করা (Filter Eligible Teachers - CORE LOGIC) ---
const getTeachersByRoutine = async (req, res) => {
  const { year, classId, subjectId } = req.query;
  const yearInt = parseInt(year);

  if (!year || !classId || !subjectId) {
    return res.status(400).json({
      message: "Year, Class ID, and Subject ID are required for filtering.",
    });
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
    })
      .select("teacher")
      .populate({
        path: "teacher",
        select: "teacherId name phone campus",
        populate: {
          path: "campus",
          select: "name",
        },
      });

    const uniqueTeachers = routines.map((r) => r.teacher).filter((t) => t);

    res.json(uniqueTeachers);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching eligible teachers: " + error.message });
  }
};

// --- 4. রুটিন এন্ট্রি মুছে ফেলা (Delete Routine Entry) ---
const deleteRoutine = async (req, res) => {
  const routineId = req.params.id; // This is the assignment subdocument _id

  try {
    const result = await Routine.findOneAndUpdate(
      { "years.assignments._id": routineId },
      { $pull: { "years.$.assignments": { _id: routineId } } }
    );

    if (!result) {
      return res.status(404).json({ message: "Routine entry not found." });
    }

    res.json({ message: "Routine entry successfully deleted." });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting routine: " + error.message });
  }
};

// --- 5. রুটিন বাল্ক আপলোড (Bulk Upload Routines) ---
const bulkUploadRoutines = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  try {
    const fileBuffer = req.file.buffer;

    let workbook;
    try {
      workbook = xlsx.read(fileBuffer, { type: "buffer" });
    } catch (readError) {
      return res.status(400).json({
        message:
          "File format error: Please ensure the file is a valid .xlsx (Excel Workbook) file, not CSV.",
      });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    const headers = rawData[0].map((h) =>
      h ? h.toLowerCase().trim().replace(/\s/g, "") : ""
    );
    const dataRows = rawData.slice(1);

    const bulkErrors = [];
    const routinesToProcess = [];

    // 1. Fetch all Master Data for efficient lookup
    const [branches, classes, subjects, existingTeachers] = await Promise.all([
      Branch.find({}).select("name _id"),
      Class.find({}).select("name _id"),
      Subject.find({}).select("name _id"),
      Teacher.find({}).select("teacherId _id phone name"),
    ]);

    const branchMap = new Map(
      branches.map((b) => [b.name.toLowerCase(), b._id])
    );
    const classMap = new Map(classes.map((c) => [c.name.toLowerCase(), c._id]));
    const subjectMap = new Map(
      subjects.map((s) => [s.name.toLowerCase(), s._id])
    );

    // Map existing teachers by BOTH TeacherID and Phone for robust lookup
    const existingTeacherIdMap = new Map(
      existingTeachers.map((t) => [t.teacherId, t])
    );
    const existingTeacherPhoneMap = new Map(
      existingTeachers.map((t) => [t.phone, t])
    );

    const teacherMap = {};
    let newTeachersToInsert = [];
    let successfulTeachersCount = 0;

    // --- Pass 1: Validate rows, map master data, and prepare new teachers ---
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNumber = i + 2;

      const excelData = {
        teacherId: row[headers.indexOf("teacherid")],
        name: row[headers.indexOf("name")],
        branchName: row[headers.indexOf("branchname")],
        className: row[headers.indexOf("classname")],
        subjectName: row[headers.indexOf("subjectname")],
        phone: row[headers.indexOf("phone")],
        year: row[headers.indexOf("year")],
      };

      // Basic validation for core fields
      if (
        !excelData.teacherId ||
        !excelData.className ||
        !excelData.subjectName ||
        !excelData.branchName ||
        !excelData.year
      ) {
        bulkErrors.push(
          `Row ${rowNumber}: Missing core fields (ID, Branch, Class, Subject, or Year).`
        );
        continue;
      }

      // Lookup Master Data IDs
      const branchObjectId = branchMap.get(excelData.branchName?.toLowerCase());
      const classObjectId = classMap.get(excelData.className.toLowerCase());
      const subjectObjectId = subjectMap.get(
        excelData.subjectName.toLowerCase()
      );
      const yearInt = parseInt(excelData.year);

      if (isNaN(yearInt)) {
        bulkErrors.push(
          `Row ${rowNumber}: Invalid year value: ${excelData.year}.`
        );
        continue;
      }

      if (!branchObjectId || !classObjectId || !subjectObjectId) {
        bulkErrors.push(
          `Row ${rowNumber}: Master data not found (Check Branch: ${excelData.branchName}, Class: ${excelData.className}, or Subject: ${excelData.subjectName}).`
        );
        continue;
      }

      // Find or Prepare Teacher for insertion/link
      let teacherIdMongo;
      const existingTeacherById = existingTeacherIdMap.get(excelData.teacherId);
      const existingTeacherByPhone = existingTeacherPhoneMap.get(
        excelData.phone
      );
      const teacherSlated = teacherMap[excelData.teacherId];

      if (existingTeacherById) {
        teacherIdMongo = existingTeacherById._id;
      } else if (existingTeacherByPhone) {
        teacherIdMongo = existingTeacherByPhone._id;
      } else if (teacherSlated) {
        teacherIdMongo = teacherSlated;
      } else {
        // Teacher is genuinely new. Check name/phone, then slate for insertion.
        if (!excelData.phone || !excelData.name) {
          bulkErrors.push(
            `Row ${rowNumber}: Teacher ID ${excelData.teacherId}: New teacher requires Name and Phone Number for initial registration.`
          );
          continue;
        }

        const newTeacherId = new mongoose.Types.ObjectId();
        newTeachersToInsert.push({
          _id: newTeacherId,
          teacherId: excelData.teacherId,
          name: excelData.name,
          phone: excelData.phone,
          campus: branchObjectId,
        });
        teacherIdMongo = newTeacherId;
        teacherMap[excelData.teacherId] = newTeacherId;
      }

      // Collect routine data for processing
      routinesToProcess.push({
        teacherMongoId: teacherIdMongo,
        year: yearInt,
        className: classObjectId,
        subject: subjectObjectId,
        rowNumber: rowNumber, // Keep track of the row for error reporting
      });
    }

    // --- Pass 2: Insert NEW Teachers (If any) ---
    let successfulTeacherIds = new Set(
      existingTeachers.map((t) => t._id.toString())
    );

    if (newTeachersToInsert.length > 0) {
      try {
        const teacherResult = await Teacher.insertMany(newTeachersToInsert, {
          ordered: false,
        });

        teacherResult.forEach((t) =>
          successfulTeacherIds.add(t._id.toString())
        );
        successfulTeachersCount = teacherResult.length;
      } catch (err) {
        if (err.insertedDocs) {
          err.insertedDocs.forEach((t) =>
            successfulTeacherIds.add(t._id.toString())
          );
          successfulTeachersCount = err.insertedDocs.length;
        }
        bulkErrors.push(
          `Error during bulk teacher insert: ${
            newTeachersToInsert.length - successfulTeachersCount
          } new teacher records failed due to existing ID/Phone conflicts.`
        );
      }
    }

    // --- Pass 3: Process and Upsert Routines (Nested Model Logic) ---
    let savedRoutinesCount = 0;

    // Fetch all existing Routine documents once for conflict checking/overwrite preparation
    const existingRoutineDocs = await Routine.find({
      teacher: { $in: Array.from(successfulTeacherIds) },
    }).lean();

    // Map existing assignments for conflict check (used for overwriting)
    const existingAssignmentsMap = new Map(); // Key: teacherId_year, Value: Array of assignments

    existingRoutineDocs.forEach((doc) => {
      doc.years.forEach((yearEntry) => {
        const key = `${doc.teacher.toString()}_${yearEntry.year}`;
        if (!existingAssignmentsMap.has(key)) {
          existingAssignmentsMap.set(key, []);
        }
        // Store the entire assignment subdocument to get the _id for $pull
        existingAssignmentsMap.get(key).push(
          ...yearEntry.assignments.map((a) => ({
            _id: a._id,
            className: a.className.toString(),
            subject: a.subject.toString(),
          }))
        );
      });
    });

    let successfulRoutineUpserts = 0;

    for (const routine of routinesToProcess) {
      const assignmentDetail = {
        className: routine.className,
        subject: routine.subject,
      };
      const teacherIdStr = routine.teacherMongoId.toString();
      const key = `${teacherIdStr}_${routine.year}`;
      const assignmentKey = `${routine.className.toString()}_${routine.subject.toString()}`;

      // Skip routine if associated new teacher failed to save
      if (!successfulTeacherIds.has(teacherIdStr)) {
        continue;
      }

      // 1. CHECK FOR DUPLICATE AND OVERWRITE/PULL
      const existingAssignments = existingAssignmentsMap.get(key) || [];
      const duplicateAssignment = existingAssignments.find(
        (a) =>
          a.className === assignmentDetail.className.toString() &&
          a.subject === assignmentDetail.subject.toString()
      );

      if (duplicateAssignment) {
        // ✅ OVERWRITE LOGIC: Pull the old subdocument before pushing the new one
        await Routine.findOneAndUpdate(
          { teacher: routine.teacherMongoId, "years.year": routine.year },
          { $pull: { "years.$.assignments": { _id: duplicateAssignment._id } } }
        );
        // Log for clarity, but don't count as an error
        // Note: Since we only push one new entry later, no need to log a "skip".
      }

      // 2. INSERT (PUSH) THE NEW ASSIGNMENT

      // A. Attempt to push to the existing year's array.
      let result = await Routine.findOneAndUpdate(
        { teacher: routine.teacherMongoId, "years.year": routine.year },
        { $push: { "years.$.assignments": assignmentDetail } },
        { new: true }
      );

      // B. If the year doesn't exist, push a new year object with the assignment.
      if (!result) {
        result = await Routine.findOneAndUpdate(
          { teacher: routine.teacherMongoId },
          {
            $push: {
              years: { year: routine.year, assignments: [assignmentDetail] },
            },
          },
          { upsert: true, new: true }
        );
      }

      if (result) {
        successfulRoutineUpserts++;
        // Note: We intentionally DO NOT update existingAssignmentsMap here
        // to avoid re-overwriting routines that appear multiple times in the SAME file,
        // relying on the atomic database operation to handle the overwrite on push/pull.
        // A perfect solution would require a unique constraint on subdocuments, which Mongoose doesn't easily provide.
      }
    }
    savedRoutinesCount = successfulRoutineUpserts;

    res.status(200).json({
      message: `Successfully processed ${dataRows.length} rows. ${successfulTeachersCount} new teachers and ${savedRoutinesCount} routines saved. Duplicates were overwritten.`,
      savedRoutinesCount: savedRoutinesCount,
      savedTeachersCount: successfulTeachersCount,
      errors: bulkErrors, // Contains only Master Data/Teacher creation errors
    });
  } catch (error) {
    console.error("Bulk Routine Upload Failed:", error);
    res.status(500).json({
      message: "Bulk upload failed due to a server error: " + error.message,
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
