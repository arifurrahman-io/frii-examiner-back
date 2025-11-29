const Class = require("../models/ClassModel");

// POST /api/classes
const addClass = async (req, res) => {
  const { name, level, stream } = req.body;

  if (!name || !level) {
    return res
      .status(400)
      .json({ message: "Class name and level are required." });
  }
  if (isNaN(level)) {
    return res.status(400).json({ message: "Level must be a number." });
  }

  try {
    const newClass = await Class.create({
      // Mongoose Schema-তে `uppercase: true` সেট না থাকলে এখানে uppercase করে সেভ করা যায়
      name: name.toUpperCase(),
      level: parseInt(level),
      stream: stream,
    });

    res.status(201).json(newClass);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Class name or level already exists." });
    }
    res.status(500).json({ message: "Failed to add class: " + error.message });
  }
};

// GET /api/classes
const getAllClasses = async (req, res) => {
  try {
    // লেভেল (Level) অনুযায়ী সাজানো হয় (যেমন: Five -> Six -> Nine)
    const classes = await Class.find({}).sort({ level: 1 });
    res.json(classes);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch classes." });
  }
};

// PUT /api/classes/:id
const updateClass = async (req, res) => {
  const { name, level, stream } = req.body;

  try {
    const updatedClass = await Class.findByIdAndUpdate(
      req.params.id,
      { $set: { name: name.toUpperCase(), level: parseInt(level), stream } },
      { new: true, runValidators: true }
    );

    if (!updatedClass) {
      return res.status(404).json({ message: "Class not found." });
    }

    res.json(updatedClass);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Class name or level already exists." });
    }
    res
      .status(500)
      .json({ message: "Failed to update class: " + error.message });
  }
};

// DELETE /api/classes/:id
const deleteClass = async (req, res) => {
  try {
    const deletedClass = await Class.findByIdAndDelete(req.params.id);

    if (!deletedClass) {
      return res.status(404).json({ message: "Class not found." });
    }

    res.json({ message: "Class deleted successfully." });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to delete class: " + error.message });
  }
};

module.exports = {
  addClass,
  getAllClasses,
  updateClass,
  deleteClass,
};
