const express = require("express");
const {
  addRoutine,
  getTeacherRoutines,
  getTeachersByRoutine,
  deleteRoutine,
  bulkUploadRoutines, // ✅ Import new controller
} = require("../controllers/routineController");

const { protect, admin } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware"); // ✅ Import Multer middleware

const router = express.Router();

// --- ROUINE CRUD ---

// Base Route: /api/routines
router.route("/").post(protect, admin, addRoutine);

// DELETE /api/routines/:id (Deleting a specific routine entry)
router.route("/:id").delete(protect, admin, deleteRoutine);

// --- FILTERS ---

// GET /api/routines/filter (Eligible teachers for assignment)
router.route("/filter").get(protect, getTeachersByRoutine);

// GET /api/routines/teacher/:teacherId - Fetch all routines for a specific teacher
router.route("/teacher/:teacherId").get(protect, getTeacherRoutines);

// ✅ NEW ROUTE: POST /api/routines/bulk-upload (File Upload Route)
// Order of middleware: protect -> admin -> upload (multer) -> controller
router.post("/bulk-upload", protect, admin, upload, bulkUploadRoutines);

module.exports = router;
