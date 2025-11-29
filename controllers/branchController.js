const Branch = require("../models/BranchModel");

// POST /api/branches
const addBranch = async (req, res) => {
  const { name, location, description } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Branch name is required." });
  }

  try {
    const newBranch = await Branch.create({
      name,
      location,
      description,
    });

    res.status(201).json(newBranch);
  } catch (error) {
    // ডুপ্লিকেট কী ত্রুটি (E11000) হ্যান্ডেল করা
    if (error.code === 11000) {
      return res.status(400).json({ message: "Branch already exists." });
    }
    res.status(500).json({ message: "Failed to add branch: " + error.message });
  }
};

// GET /api/branches
const getAllBranches = async (req, res) => {
  try {
    const branches = await Branch.find({ isActive: true }).sort({ name: 1 });
    res.json(branches);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch branches." });
  }
};

// --- নতুন যোগ করা ফাংশন ---

// PUT /api/branches/:id
const updateBranch = async (req, res) => {
  const { name, location, description } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ message: "Branch name is required for update." });
  }

  try {
    // FindByIdAndUpdate ব্যবহার করে তথ্য আপডেট করা
    const updatedBranch = await Branch.findByIdAndUpdate(
      req.params.id,
      { $set: { name, location, description } },
      { new: true, runValidators: true } // নতুন ডকুমেন্ট রিটার্ন করা এবং ভ্যালিডেটর চালানো
    );

    if (!updatedBranch) {
      return res.status(404).json({ message: "Branch not found." });
    }

    res.json(updatedBranch);
  } catch (error) {
    // ডুপ্লিকেট কী ত্রুটি হ্যান্ডেল করা
    if (error.code === 11000) {
      return res.status(400).json({ message: "Branch already exists." });
    }
    res
      .status(500)
      .json({ message: "Failed to update branch: " + error.message });
  }
};

// DELETE /api/branches/:id
const deleteBranch = async (req, res) => {
  try {
    // FindByIdAndDelete ব্যবহার করে ব্রাঞ্চ মুছে ফেলা
    const deletedBranch = await Branch.findByIdAndDelete(req.params.id);

    if (!deletedBranch) {
      return res.status(404).json({ message: "Branch not found." });
    }

    res.json({ message: "Branch deleted successfully." });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to delete branch: " + error.message });
  }
};

module.exports = {
  addBranch,
  getAllBranches,
  updateBranch, // ✅ এক্সপোর্ট করা হলো
  deleteBranch, // ✅ এক্সপোর্ট করা হলো
};
