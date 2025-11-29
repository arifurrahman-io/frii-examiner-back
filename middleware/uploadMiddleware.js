const multer = require("multer");

// আপলোড স্টোরেজ সেটআপ
const storage = multer.memoryStorage(); // ফাইল মেমোরিতে সেভ হবে, যাতে সরাসরি রিড করা যায়

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    // শুধুমাত্র Excel ফাইল (.xlsx, .xls) অনুমতি দেওয়া
    if (
      file.mimetype.includes("spreadsheet") ||
      file.mimetype.includes("excel")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are allowed!"), false);
    }
  },
});

// 'excelFile' নামের সিঙ্গেল ফাইল আপলোডের জন্য এক্সপোর্ট
module.exports = upload.single("excelFile");
