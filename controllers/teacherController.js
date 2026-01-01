const Teacher = require("../models/TeacherModel");
const Branch = require("../models/BranchModel");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const mongoose = require("mongoose");
const xlsx = require("xlsx");
const bcrypt = require("bcryptjs");

// --- ১. নতুন শিক্ষক যোগ করা (Add Teacher) ---
// Admin এবং Incharge উভয়েই ব্যবহার করতে পারবে
const addTeacher = async (req, res) => {
  const { teacherId, name, phone, campus, designation } = req.body;
  try {
    const teacherExists = await Teacher.findOne({
      $or: [{ teacherId }, { phone }],
    });
    if (teacherExists)
      return res
        .status(400)
        .json({ message: "Teacher ID or Phone already registered." });

    const branch = await Branch.findById(campus);
    if (!branch) return res.status(404).json({ message: "Campus not found." });

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

// --- ২. বার্ষিক রিপোর্ট এবং দায়িত্ব যুক্ত করা ---
// ইনচার্জ বা অ্যাডমিন টিচারের পারফরম্যান্স রিপোর্ট লিখতে পারবে
const addAnnualReport = async (req, res) => {
  const teacherObjectId = req.params.id;
  const { year, responsibility, performanceReport } = req.body;
  try {
    const teacher = await Teacher.findById(teacherObjectId);
    if (!teacher)
      return res.status(404).json({ message: "Teacher not found." });

    teacher.reports.push({
      year: Number(year), // বছরটিকে Number হিসেবে নিশ্চিত করা
      responsibility,
      performanceReport,
      addedBy: req.user.id, // AuthMiddleware থেকে প্রাপ্ত
      date: new Date(),
    });

    await teacher.save();
    res.status(200).json({
      message: "Report added successfully.",
      reports: teacher.reports,
    });
  } catch (error) {
    res.status(500).json({ message: "Error adding report: " + error.message });
  }
};

// --- ৩. সকল শিক্ষক দেখা ও সার্চ করা ---
const getAllTeachers = async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const pageInt = parseInt(page);
  const limitInt = parseInt(limit);
  const skip = (pageInt - 1) * limitInt;

  let query = {};
  if (search) {
    const searchRegex = { $regex: search, $options: "i" };
    const matchingBranches = await Branch.find({ name: searchRegex }).select(
      "_id"
    );
    const branchIds = matchingBranches.map((b) => b._id);
    query = {
      $or: [
        { name: searchRegex },
        { teacherId: searchRegex },
        { phone: searchRegex },
        ...(branchIds.length > 0 ? [{ campus: { $in: branchIds } }] : []),
      ],
    };
  }

  try {
    const totalTeachers = await Teacher.countDocuments(query);
    const teachers = await Teacher.find(query)
      .limit(limitInt)
      .skip(skip)
      .populate("campus", "name location")
      .sort({ name: 1 });

    res.json({
      teachers,
      page: pageInt,
      totalPages: Math.ceil(totalTeachers / limitInt),
      totalTeachers,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- ৪. শিক্ষকের প্রোফাইল ও রেসপন্সিবিলিটি ম্যাট্রিক্স (CRITICAL UPDATE) ---
const getTeacherProfile = async (req, res) => {
  const teacherId = req.params.id;
  try {
    // ১. টিচারের বেসিক তথ্য ও রিপোর্ট ফেচ করা
    const teacher = await Teacher.findById(teacherId)
      .populate("campus", "name")
      .populate("reports.responsibility", "name")
      .populate("reports.addedBy", "name role");

    if (!teacher)
      return res.status(404).json({ message: "Teacher not found." });

    // ২. রেসপন্সিবিলিটি ম্যাট্রিক্স এগ্রিগেশন (ট্যাব ভিউ-এর জন্য)
    const assignmentsByYear = await ResponsibilityAssignment.aggregate([
      { $match: { teacher: new mongoose.Types.ObjectId(teacherId) } },
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
          _id: "$year", // বছরের ভিত্তিতে গ্রুপিং (ট্যাব লজিকের জন্য)
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
      { $sort: { _id: -1 } }, // লেটেস্ট বছর আগে থাকবে
    ]);

    res.json({
      teacherDetails: teacher,
      assignmentsByYear, // এটি ফ্রন্টএন্ডে ট্যাবে ডাটা দেখাবে
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- ৫. শিক্ষকের বাল্ক আপলোড ---
const bulkUploadTeachers = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });
  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetData = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]]
    );
    // বাল্ক লজিক এখানে যুক্ত করুন...
    res.status(200).json({ message: "Bulk data processed successfully." });
  } catch (error) {
    res.status(500).json({ message: "Bulk upload failed: " + error.message });
  }
};

// --- ৬. শিক্ষক আপডেট করা ---
const updateTeacher = async (req, res) => {
  const teacherObjectId = req.params.id;
  try {
    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherObjectId,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate("campus", "name");

    if (!updatedTeacher)
      return res.status(404).json({ message: "Teacher not found." });

    res.json({
      message: "Teacher updated successfully.",
      teacher: updatedTeacher,
    });
  } catch (error) {
    res.status(500).json({ message: "Error updating: " + error.message });
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
