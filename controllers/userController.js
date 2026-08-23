const User = require("../models/UserModel");
const bcrypt = require("bcryptjs");

const populateUser = (query) =>
  query
    .select("-password")
    .populate("campus", "name")
    .populate("campuses", "name")
    .populate("teacherProfile", "name teacherId campus designation");

const getUsers = async (req, res) => {
  try {
    const users = await populateUser(User.find());
    res.json(users);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to retrieve user matrix: " + error.message });
  }
};

const validateRoleCampusFields = ({ role, campus, campuses }) => {
  if (role === "incharge" && !campus) {
    return "Campus must be assigned for Incharge role.";
  }
  if (
    (role === "coordinator" || role === "executive") &&
    (!Array.isArray(campuses) || campuses.length === 0)
  ) {
    return `At least one campus must be assigned for ${
      role === "executive" ? "Executive" : "Coordinator"
    } role.`;
  }
  return null;
};

const addUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      campus,
      campuses,
      teacherProfile,
      username,
    } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();

    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({
        message: "Identity conflict: User with this email already exists.",
      });
    }

    const campusError = validateRoleCampusFields({ role, campus, campuses });
    if (campusError) {
      return res.status(400).json({ message: campusError });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      username: username?.trim() || normalizedEmail,
      email: normalizedEmail,
      password: hashedPassword,
      role: role || "teacher",
      campus: role === "incharge" ? campus : undefined,
      campuses: ["coordinator", "executive"].includes(role) ? campuses : [],
      teacherProfile:
        ["incharge", "coordinator"].includes(role) && teacherProfile
          ? teacherProfile
          : null,
    });

    const userResponse = await populateUser(User.findById(user._id));

    res.status(201).json({
      message: "New access node established successfully.",
      data: userResponse,
    });
  } catch (error) {
    console.error("User Creation Error:", error);
    res
      .status(500)
      .json({ message: "Internal System Error during node creation." });
  }
};

const updateUser = async (req, res) => {
  try {
    const {
      password,
      role,
      campus,
      campuses,
      teacherProfile,
      email,
      username,
      ...otherData
    } = req.body;

    let updateFields = { ...otherData, role };
    if (email) updateFields.email = email.trim().toLowerCase();
    if (username) updateFields.username = username.trim();

    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(password, salt);
    } else {
      delete updateFields.password;
    }

    const campusError = validateRoleCampusFields({ role, campus, campuses });
    if (campusError) {
      return res.status(400).json({ message: campusError });
    }

    if (role === "incharge") {
      updateFields.campus = campus;
      updateFields.campuses = [];
      updateFields.teacherProfile = teacherProfile || null;
    } else if (role === "coordinator" || role === "executive") {
      updateFields.campuses = campuses || [];
      updateFields.teacherProfile =
        role === "coordinator" ? teacherProfile || null : null;
      updateFields.$unset = { ...(updateFields.$unset || {}), campus: "" };
    } else {
      updateFields.campuses = [];
      updateFields.teacherProfile = null;
      updateFields.$unset = { ...(updateFields.$unset || {}), campus: "" };
    }

    const updatedUser = await populateUser(
      User.findByIdAndUpdate(req.params.id, updateFields, {
        new: true,
        runValidators: true,
      })
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User node not found." });
    }

    res.json({
      message: "User synchronization complete.",
      data: updatedUser,
    });
  } catch (error) {
    res.status(400).json({ message: "Update failed: " + error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Access node terminated and removed from system." });
  } catch (error) {
    res.status(400).json({ message: "Deletion failed: " + error.message });
  }
};

module.exports = {
  getUsers,
  addUser,
  updateUser,
  deleteUser,
};
