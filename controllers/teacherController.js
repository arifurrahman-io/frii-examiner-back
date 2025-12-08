const Teacher = require("../models/TeacherModel");
const Branch = require("../models/BranchModel"); // Branch model is required for campus search
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const mongoose = require("mongoose");
const xlsx = require("xlsx");
const bcrypt = require("bcryptjs");

// --- ১. নতুন শিক্ষক যোগ করা (Add Teacher) ---
// POST /api/teachers
const addTeacher = async (req, res) => {
  const { teacherId, name, phone, campus, designation } = req.body;

  try {
    // 1. Check if Teacher ID or Phone already exists
    const teacherExists = await Teacher.findOne({
      $or: [{ teacherId }, { phone }],
    });
    if (teacherExists) {
      return res
        .status(400)
        .json({ message: "Teacher ID or Phone number already registered." });
    }

    // 2. Find the Branch ObjectId
    const branch = await Branch.findById(campus);
    if (!branch) {
      return res.status(404).json({ message: "Campus not found." });
    }

    // 3. Create new teacher
    const newTeacher = await Teacher.create({
      teacherId,
      name,
      phone,
      campus: branch._id, // Save the ObjectId
      designation,
      // Note: Manual entry requires a password/user creation logic if login is intended
    });

    res.status(201).json(newTeacher);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- ২. সকল শিক্ষক দেখা এবং সার্চ করা (Get All Teachers & Search) ---
// GET /api/teachers
const getAllTeachers = async (req, res) => {
  // 🚀 ফিক্স ১: পেজিনেশন প্যারামিটার গ্রহণ
  const { search, page = 1, limit = 20 } = req.query;

  const pageInt = parseInt(page);
  const limitInt = parseInt(limit);
  const skip = (pageInt - 1) * limitInt;

  let query = {};

  if (search) {
    const searchRegex = { $regex: search, $options: "i" };

    // 1. Search Branches for matching names
    const matchingBranches = await Branch.find({ name: searchRegex }).select(
      "_id"
    );
    const branchIds = matchingBranches.map((branch) => branch._id);

    // 2. Build the complex search query using $or
    query = {
      $or: [
        { name: searchRegex },
        { phone: searchRegex },
        // 🚀 NEW: Search by Campus ID if matching branches were found
        ...(branchIds.length > 0 ? [{ campus: { $in: branchIds } }] : []),
      ],
    };
  }

  try {
    // 1. Get total count for pagination metadata
    const totalTeachers = await Teacher.countDocuments(query);

    // 2. Fetch paginated teachers with limit and skip
    const teachers = await Teacher.find(query)
      .limit(limitInt)
      .skip(skip)
      .populate("campus", "name location")
      .sort({ name: 1 });

    // 3. রিটার্ন পেজিনেটেড ডেটা
    res.json({
      teachers,
      page: pageInt,
      limit: limitInt,
      totalPages: Math.ceil(totalTeachers / limitInt),
      totalTeachers,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- ৩. শিক্ষকের প্রোফাইল দেখা ও দায়িত্বের তালিকা (View Teacher Profile & Responsibilities) ---
// GET /api/teachers/:id
const getTeacherProfile = async (req, res) => {
  const teacherId = req.params.id;

  try {
    const teacher = await Teacher.findById(teacherId).populate(
      "campus",
      "name"
    );

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }

    // Fetch all responsibilities assigned to this teacher (Mongoose aggregation)
    const assignments = await ResponsibilityAssignment.aggregate([
      // 1. ম্যাচিং (Matching)
      { $match: { teacher: new mongoose.Types.ObjectId(teacherId) } },

      // 2. লুকআপ: দায়িত্বের ধরন (Responsibility Type)
      {
        $lookup: {
          from: "responsibilitytypes",
          localField: "responsibilityType",
          foreignField: "_id",
          as: "typeDetails",
        },
      },
      { $unwind: "$typeDetails" },

      // 3. ✅ লুকআপ: ক্লাসের নাম (Class Name)
      {
        $lookup: {
          from: "classes",
          localField: "targetClass",
          foreignField: "_id",
          as: "classDetails",
        },
      },
      // ডেটা না পেলেও রেকর্ডটি ধরে রাখার জন্য preserveNullAndEmptyArrays: true
      { $unwind: { path: "$classDetails", preserveNullAndEmptyArrays: true } },

      // 4. ✅ লুকআপ: বিষয়ের নাম (Subject Name)
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

      // 5. গ্রুপিং (Grouping)
      {
        $group: {
          _id: "$year",
          responsibilities: {
            $push: {
              // ✅ CRITICAL FIX: Include the assignment's MongoDB ID
              _id: "$_id",
              name: "$typeDetails.name",
              status: "$status",
              // ✅ FIX: Populate করা নাম ব্যবহার করা
              class: { $ifNull: ["$classDetails.name", "N/A"] },
              subject: { $ifNull: ["$subjectDetails.name", "N/A"] },
            },
          },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    res.json({
      teacherDetails: teacher,
      assignmentsByYear: assignments,
    });
  } catch (error) {
    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ message: "Invalid Teacher ID format." });
    }
    res
      .status(500)
      .json({ message: "Error fetching profile: " + error.message });
  }
};

// --- ৪. শিক্ষকের তথ্য আপডেট করা (Update Teacher) ---
// PUT /api/teachers/:id
const updateTeacher = async (req, res) => {
  const teacherObjectId = req.params.id;
  const { teacherId, name, phone, campus, designation, isActive } = req.body;
  let updateFields = req.body;

  try {
    // 1. Basic Validation
    if (!mongoose.Types.ObjectId.isValid(teacherObjectId)) {
      return res.status(400).json({ message: "Invalid Teacher ID format." });
    }

    // 2. Handle unique fields (teacherId and phone) during update
    if (teacherId || phone) {
      const existingTeacher = await Teacher.findOne({
        $or: [{ teacherId }, { phone }],
        _id: { $ne: teacherObjectId },
      });

      if (existingTeacher) {
        let field =
          existingTeacher.teacherId === teacherId
            ? "Teacher ID"
            : "Phone Number";
        return res
          .status(400)
          .json({ message: `${field} is already in use by another teacher.` });
      }
    }

    // 3. Handle Campus update
    if (campus) {
      if (!mongoose.Types.ObjectId.isValid(campus)) {
        return res.status(400).json({ message: "Invalid Campus ID format." });
      }
      const branchExists = await Branch.findById(campus);
      if (!branchExists) {
        return res.status(404).json({ message: "Target Campus not found." });
      }
    }

    // 4. Perform the update operation
    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherObjectId,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).populate("campus", "name");

    if (!updatedTeacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }

    res.json({
      message: "Teacher profile updated successfully.",
      teacher: updatedTeacher,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating teacher: " + error.message });
  }
};

// --- ৫. শিক্ষকের বাল্ক আপলোড (Bulk Upload Teachers) ---
// POST /api/teachers/bulk-upload
const bulkUploadTeachers = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  try {
    const fileBuffer = req.file.buffer;
    const workbook = xlsx.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // JSON এ ডেটা কনভার্ট করা (header: 1 মানে প্রথম row header)
    const rawTeachers = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    const headers = rawTeachers[0].map((h) =>
      h ? h.toLowerCase().trim().replace(/\s/g, "") : ""
    );
    const dataRows = rawTeachers.slice(1);

    const teachersToSave = [];
    const bulkErrors = [];
    // Fetch all campuses to perform lookups efficiently
    const campuses = await Branch.find({}).select("name _id");

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNumber = i + 2;
      const teacher = {};

      const excelData = {
        teacherId: row[headers.indexOf("teacherid")],
        name: row[headers.indexOf("name")],
        phone: row[headers.indexOf("phone")],
        campusName: row[headers.indexOf("campus")],
        password: row[headers.indexOf("password")],
        designation: row[headers.indexOf("designation")],
      };

      // প্রাথমিক ভ্যালিডেশন
      if (
        !excelData.teacherId ||
        !excelData.name ||
        !excelData.phone ||
        !excelData.campusName
      ) {
        bulkErrors.push(
          `Row ${rowNumber}: Missing required fields (ID, Name, Phone, or Campus).`
        );
        continue;
      }

      // Campus ID Look-up
      const campusObj = campuses.find(
        (c) => c.name.toLowerCase() === excelData.campusName.toLowerCase()
      );
      if (!campusObj) {
        bulkErrors.push(
          `Row ${rowNumber}: Campus '${excelData.campusName}' not found in master data.`
        );
        continue;
      }

      teacher.teacherId = excelData.teacherId;
      teacher.name = excelData.name;
      teacher.phone = excelData.phone;
      teacher.campus = campusObj._id;
      teacher.designation = excelData.designation;

      // Password Hashing (if included in the bulk sheet)
      if (excelData.password) {
        const salt = await bcrypt.genSalt(10);
        teacher.password = await bcrypt.hash(
          excelData.password.toString(),
          salt
        );
        // Note: You must ensure your TeacherModel includes the 'password' field.
      }

      teachersToSave.push(teacher);
    }

    // ডাটাবেসে বাল্ক ইনসার্ট
    // ordered: false allows insertion to continue even if one document fails (e.g., due to duplicate ID)
    const result = await Teacher.insertMany(teachersToSave, { ordered: false });

    res.status(200).json({
      message: `Successfully processed ${dataRows.length} rows. ${result.length} teachers saved.`,
      savedCount: result.length,
      errors: bulkErrors,
    });
  } catch (error) {
    // Handle bulk insert errors (e.g., duplicate key errors from insertMany)
    res.status(500).json({ message: "Bulk upload failed: " + error.message });
  }
};

module.exports = {
  addTeacher,
  getAllTeachers,
  getTeacherProfile,
  updateTeacher,
  bulkUploadTeachers,
};
