const express = require("express");
const router = express.Router();
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const {
  getMeta,
  getCriteria,
  listTeachersForIncrement,
  getTeacherIncrementSummary,
  createEvaluation,
  updateEvaluation,
  deleteEvaluation,
  updateTeacherSalary,
  upsertIncrementLetter,
  getIncrementLetter,
  listLetterBundle,
  getIncrementSettings,
  updateIncrementSettings,
} = require("../controllers/incrementController");

const incrementAccess = authorizeRoles(
  "admin",
  "head_teacher",
  "coordinator",
  "incharge"
);

const letterAccess = authorizeRoles("admin", "head_teacher");
const letterDownloadAccess = authorizeRoles(
  "admin",
  "head_teacher",
  "coordinator"
);

router.use(protect);

router.get("/meta", incrementAccess, getMeta);
router.get("/settings", incrementAccess, getIncrementSettings);
router.put("/settings", letterAccess, updateIncrementSettings);
router.get("/criteria", incrementAccess, getCriteria);
router.get("/teachers", incrementAccess, listTeachersForIncrement);
router.get(
  "/teachers/:teacherId/summary",
  incrementAccess,
  getTeacherIncrementSummary
);
router.get(
  "/teachers/:teacherId/letter",
  incrementAccess,
  getIncrementLetter
);

router.post("/evaluations", incrementAccess, createEvaluation);
router.put("/evaluations/:id", incrementAccess, updateEvaluation);
router.delete("/evaluations/:id", incrementAccess, deleteEvaluation);

router.put(
  "/teachers/:teacherId/salary",
  letterAccess,
  updateTeacherSalary
);
router.get("/letters/bundle", letterDownloadAccess, listLetterBundle);
router.put("/letters", letterAccess, upsertIncrementLetter);

module.exports = router;
