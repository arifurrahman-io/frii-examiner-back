// controllers/responsibilityTypeController.js
const ResponsibilityType = require("../models/ResponsibilityTypeModel");

const normalizeSubmissionDeadline = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// ----------------------------
// 1️⃣ Add Responsibility Type
// POST /api/responsibility-types
// ----------------------------
const addResponsibilityType = async (req, res) => {
  const {
    name,
    description,
    category,
    requiresClassSubject,
    submissionDeadline,
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({
      message: "Name and Category are required for a responsibility type.",
    });
  }

  try {
    const newType = await ResponsibilityType.create({
      name: name.trim(),
      description: description || "",
      category,
      requiresClassSubject:
        requiresClassSubject !== undefined ? requiresClassSubject : true,
      submissionDeadline: normalizeSubmissionDeadline(submissionDeadline),
    });

    res.status(201).json(newType);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Responsibility name already exists." });
    }
    res
      .status(500)
      .json({ message: "Failed to add responsibility type: " + error.message });
  }
};

// ----------------------------
// 2️⃣ Get All Responsibility Types
// GET /api/responsibility-types
// ----------------------------
const getAllResponsibilityTypes = async (req, res) => {
  try {
    const types = await ResponsibilityType.find({}).sort({ name: 1 });
    res.json(types);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch responsibility types: " + error.message,
    });
  }
};

// ----------------------------
// 3️⃣ Update Responsibility Type
// PUT /api/responsibility-types/:id
// ----------------------------
const updateResponsibilityType = async (req, res) => {
  const {
    name,
    description,
    category,
    requiresClassSubject,
    submissionDeadline,
  } = req.body;

  if (!name || !category) {
    return res
      .status(400)
      .json({ message: "Name and Category are required for update." });
  }

  try {
    const updateData = {
      name: name.trim(),
      description: description || "",
      category,
      requiresClassSubject:
        requiresClassSubject !== undefined ? requiresClassSubject : true,
      submissionDeadline: normalizeSubmissionDeadline(submissionDeadline),
    };

    const updatedType = await ResponsibilityType.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedType) {
      return res
        .status(404)
        .json({ message: "Responsibility type not found." });
    }

    res.json(updatedType);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Responsibility name already exists." });
    }
    res.status(500).json({
      message: "Failed to update responsibility type: " + error.message,
    });
  }
};

// ----------------------------
// 4️⃣ Delete Responsibility Type
// DELETE /api/responsibility-types/:id
// ----------------------------
const deleteResponsibilityType = async (req, res) => {
  try {
    const deletedType = await ResponsibilityType.findByIdAndDelete(
      req.params.id
    );

    if (!deletedType) {
      return res
        .status(404)
        .json({ message: "Responsibility type not found." });
    }

    res.json({ message: "Responsibility type deleted successfully." });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete responsibility type: " + error.message,
    });
  }
};

module.exports = {
  addResponsibilityType,
  getAllResponsibilityTypes,
  updateResponsibilityType,
  deleteResponsibilityType,
};
