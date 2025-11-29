const Subject = require("../models/SubjectModel");

// POST /api/subjects
const addSubject = async (req, res) => {
  const { name, code, type, minClassLevel } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Subject name is required." });
  }

  try {
    const newSubject = await Subject.create({
      name: name.trim(),
      // Code যদি থাকে, তবে তা uppercase করে সেভ করা হবে
      code: code ? code.trim().toUpperCase() : undefined,
      type,
      minClassLevel: minClassLevel ? parseInt(minClassLevel) : undefined,
    });

    res.status(201).json(newSubject);
  } catch (error) {
    // ডুপ্লিকেশন ত্রুটি হ্যান্ডেল করা (name বা code)
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Subject name or code already exists." });
    }
    res
      .status(500)
      .json({ message: "Failed to add subject: " + error.message });
  }
};

// GET /api/subjects
const getAllSubjects = async (req, res) => {
  try {
    // নাম অনুযায়ী বর্ণানুক্রমিকভাবে সাজানো
    const subjects = await Subject.find({}).sort({ name: 1 });
    res.json(subjects);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch subjects." });
  }
};

// PUT /api/subjects/:id
const updateSubject = async (req, res) => {
  const { name, code, type, minClassLevel } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Subject name is required." });
  }

  try {
    const updateData = {
      name: name.trim(),
      code: code ? code.trim().toUpperCase() : undefined,
      type,
      minClassLevel: minClassLevel ? parseInt(minClassLevel) : undefined,
    };

    const updatedSubject = await Subject.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true } // আপডেটেড ডকুমেন্ট রিটার্ন করা এবং ভ্যালিডেটর চালানো
    );

    if (!updatedSubject) {
      return res.status(404).json({ message: "Subject not found." });
    }

    res.json(updatedSubject);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Subject name or code already exists." });
    }
    res
      .status(500)
      .json({ message: "Failed to update subject: " + error.message });
  }
};

// DELETE /api/subjects/:id
const deleteSubject = async (req, res) => {
  try {
    const deletedSubject = await Subject.findByIdAndDelete(req.params.id);

    if (!deletedSubject) {
      return res.status(404).json({ message: "Subject not found." });
    }

    res.json({ message: "Subject deleted successfully." });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to delete subject: " + error.message });
  }
};

module.exports = {
  addSubject,
  getAllSubjects,
  updateSubject,
  deleteSubject,
};
