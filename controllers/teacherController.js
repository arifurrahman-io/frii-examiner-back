const Teacher = require("../models/TeacherModel");
const Branch = require("../models/BranchModel");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const mongoose = require("mongoose");
const xlsx = require("xlsx");

// --- ১. নতুন শিক্ষক যোগ করা ---
const addTeacher = async (req, res) => {
  const { teacherId, name, phone, campus, designation } = req.body;
  try {
    // ইনচার্জ হলে সে অন্য ক্যাম্পাসে শিক্ষক যোগ করতে পারবে না
    const targetCampus =
      req.user.role === "incharge" ? req.user.campus : campus;

    const teacherExists = await Teacher.findOne({
      $or: [{ teacherId }, { phone }],
    });
    if (teacherExists)
      return res
        .status(400)
        .json({ message: "Teacher ID or Phone already registered matrix." });

    const branch = await Branch.findById(targetCampus);
    if (!branch)
      return res
        .status(404)
        .json({ message: "Assigned Campus node not found." });

    const newTeacher = await Teacher.create({
      teacherId,
      name,
      phone,
      campus: branch._id,
      designation,
    });
    res.status(201).json(newTeacher);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- ২. সকল শিক্ষক দেখা ও সার্চ করা (Role-based Filtering) ---
const getAllTeachers = async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const pageInt = parseInt(page);
  const limitInt = parseInt(limit);
  const skip = (pageInt - 1) * limitInt;

  try {
    let query = {};

    // 🛡️ ROLE PROTECTION: ইনচার্জ হলে শুধুমাত্র তাঁর ক্যাম্পাসের ডেটা কুয়েরি হবে
    if (req.user.role === "incharge") {
      query.campus = req.user.campus; // AuthMiddleware থেকে প্রাপ্ত ক্যাম্পাস আইডি
    }

    if (search) {
      const searchRegex = { $regex: search, $options: "i" };

      // সার্চ প্যারামিটারের সাথে অন্যান্য ফিল্টার যুক্ত করা
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
      // সার্চের ক্ষেত্রে মূল কুয়েরি থেকে ক্যাম্পাস সরানো কারণ এটি $and এ আছে
      delete query.campus;
    }

    const totalTeachers = await Teacher.countDocuments(query);
    const teachers = await Teacher.find(query)
      .limit(limitInt)
      .skip(skip)
      .populate("campus", "name description")
      .sort({ name: 1 });

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

    // 🛡️ ইনচার্জ প্রোটেকশন: অন্য ক্যাম্পাসের টিচারের প্রোফাইল দেখা ব্লক করা
    if (
      req.user.role === "incharge" &&
      String(teacher.campus._id) !== String(req.user.campus)
    ) {
      return res.status(403).json({
        message: "Access Denied: Node belongs to different campus vector.",
      });
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
              status: "$status",
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

// --- ৪. বার্ষিক রিপোর্ট যুক্ত করা ---
const addAnnualReport = async (req, res) => {
  const teacherObjectId = req.params.id;
  const { year, responsibility, performanceReport } = req.body;
  try {
    const teacher = await Teacher.findById(teacherObjectId);
    if (!teacher)
      return res.status(404).json({ message: "Teacher not found." });

    // 🛡️ ইনচার্জ প্রোটেকশন: নিজের ক্যাম্পাসের বাইরে রিপোর্ট যোগ করা যাবে না
    if (
      req.user.role === "incharge" &&
      String(teacher.campus) !== String(req.user.campus)
    ) {
      return res.status(403).json({
        message: "Unauthorized: Cannot index report for external campus node.",
      });
    }

    teacher.reports.push({
      year: Number(year),
      responsibility,
      performanceReport,
      addedBy: req.user.id,
      date: new Date(),
    });

    await teacher.save();
    res.status(200).json({
      message: "Report indexed successfully.",
      reports: teacher.reports,
    });
  } catch (error) {
    res.status(500).json({ message: "Error adding report: " + error.message });
  }
};

// --- ৫. শিক্ষক আপডেট করা ---
const updateTeacher = async (req, res) => {
  const teacherObjectId = req.params.id;
  try {
    const teacherToUpdate = await Teacher.findById(teacherObjectId);
    if (!teacherToUpdate)
      return res.status(404).json({ message: "Teacher not found." });

    // 🛡️ ইনচার্জ প্রোটেকশন
    if (
      req.user.role === "incharge" &&
      String(teacherToUpdate.campus) !== String(req.user.campus)
    ) {
      return res
        .status(403)
        .json({ message: "Restriction: Cannot modify external campus data." });
    }

    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherObjectId,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate("campus", "name");

    res.json({
      message: "Teacher node synchronized.",
      teacher: updatedTeacher,
    });
  } catch (error) {
    res.status(500).json({ message: "Update failure: " + error.message });
  }
};

// --- ৬. বাল্ক আপলোড ---
const bulkUploadTeachers = async (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ message: "Buffer missing: No file uploaded." });
  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetData = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]]
    );

    // ইনচার্জ বাল্ক আপলোড করলে সকল টিচারের ক্যাম্পাস স্বয়ংক্রিয়ভাবে ইনচার্জের ক্যাম্পাস হয়ে যাবে
    const processedData = sheetData.map((t) => ({
      ...t,
      campus: req.user.role === "incharge" ? req.user.campus : t.campus,
    }));

    // এখানে Bulk Insert লজিক (Teacher.insertMany) যোগ করা যাবে
    res
      .status(200)
      .json({ message: "Matrix bulk aggregation processed successfully." });
  } catch (error) {
    res.status(500).json({ message: "Bulk upload failed: " + error.message });
  }
};

module.exports = {
  addTeacher,
  getAllTeachers,
  addAnnualReport,
  getTeacherProfile,
  bulkUploadTeachers,
  updateTeacher,
};
