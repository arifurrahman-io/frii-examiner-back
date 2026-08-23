const User = require("../models/UserModel");

const INCREMENT_EVALUATOR_ROLES = [
  "admin",
  "head_teacher",
  "coordinator",
  "incharge",
];

const SCHOOL_WIDE_ROLES = ["admin", "head_teacher"];

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value._id || value);
};

const getUserCampusIds = (user) => {
  if (!user) return [];
  if (user.role === "incharge") {
    const id = toIdString(user.campus);
    return id ? [id] : [];
  }
  if (user.role === "coordinator" || user.role === "executive") {
    return (user.campuses || []).map(toIdString).filter(Boolean);
  }
  return [];
};

const getScaleMaxForEvaluatorRole = (role) => {
  if (role === "head_teacher" || role === "admin") return 5;
  return 4;
};

const normalizeScore = (score, scaleMax) => {
  const numericScore = Number(score);
  const numericMax = Number(scaleMax);
  if (!Number.isFinite(numericScore) || !Number.isFinite(numericMax) || numericMax <= 0) {
    return null;
  }
  return Math.round((numericScore / numericMax) * 10000) / 100;
};

const resolveEvaluateeRole = async (teacherId) => {
  const map = await resolveEvaluateeRoles([teacherId]);
  return map.get(String(teacherId)) || "teacher";
};

const resolveEvaluateeRoles = async (teacherIds = []) => {
  const ids = teacherIds.filter(Boolean);
  const map = new Map(ids.map((id) => [String(id), "teacher"]));
  if (ids.length === 0) return map;

  const linkedUsers = await User.find({
    teacherProfile: { $in: ids },
    role: { $in: ["incharge", "coordinator"] },
    status: { $ne: "inactive" },
  })
    .select("role teacherProfile")
    .lean();

  linkedUsers.forEach((item) => {
    const teacherKey = toIdString(item.teacherProfile);
    if (!teacherKey) return;
    if (item.role === "coordinator") map.set(teacherKey, "coordinator");
    else if (item.role === "incharge") map.set(teacherKey, "incharge");
  });

  return map;
};

const canAccessTeacherCampus = (user, teacher) => {
  if (!user || !teacher) return false;
  if (SCHOOL_WIDE_ROLES.includes(user.role)) return true;

  const teacherCampusId = toIdString(teacher.campus?._id || teacher.campus);
  if (!teacherCampusId) return false;

  const allowed = getUserCampusIds(user);
  return allowed.includes(teacherCampusId);
};

/**
 * Who may evaluate whom for increment criteria.
 * - incharge → teachers only (same campus)
 * - coordinator → teachers + incharges (own campuses)
 * - head_teacher/admin → all evaluatee roles
 */
const canEvaluateTeacher = (user, teacher, evaluateeRole) => {
  if (!user || !INCREMENT_EVALUATOR_ROLES.includes(user.role)) return false;
  if (!canAccessTeacherCampus(user, teacher)) return false;

  if (user.role === "incharge") {
    return evaluateeRole === "teacher";
  }
  if (user.role === "coordinator") {
    return evaluateeRole === "teacher" || evaluateeRole === "incharge";
  }
  return true;
};

module.exports = {
  INCREMENT_EVALUATOR_ROLES,
  SCHOOL_WIDE_ROLES,
  toIdString,
  getUserCampusIds,
  getScaleMaxForEvaluatorRole,
  normalizeScore,
  resolveEvaluateeRole,
  resolveEvaluateeRoles,
  canAccessTeacherCampus,
  canEvaluateTeacher,
};
