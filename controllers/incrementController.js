const Teacher = require("../models/TeacherModel");
const Branch = require("../models/BranchModel");
const IncrementCriteria = require("../models/IncrementCriteriaModel");
const IncrementEvaluation = require("../models/IncrementEvaluationModel");
const IncrementLetter = require("../models/IncrementLetterModel");
const IncrementSettings = require("../models/IncrementSettingsModel");
const ResponsibilityAssignment = require("../models/ResponsibilityAssignmentModel");
const mongoose = require("mongoose");
const {
  getFiscalYearForDate,
  listRecentFiscalYears,
  canEditEvaluationsForFiscalYear,
  isIncrementLetterLocked,
  getFiscalYearBounds,
  defaultLetterLockOn,
  endOfLocalDay,
} = require("../utils/fiscalYear");
const {
  INCREMENT_EVALUATOR_ROLES,
  SCHOOL_WIDE_ROLES,
  getUserCampusIds,
  getScaleMaxForEvaluatorRole,
  normalizeScore,
  resolveEvaluateeRole,
  resolveEvaluateeRoles,
  canAccessTeacherCampus,
  canEvaluateTeacher,
  toIdString,
} = require("../utils/incrementAccess");
const { ensureIncrementCriteria } = require("../seeders/incrementCriteriaSeeder");
const {
  houseRentFromBasic,
  deriveIncrementSalary,
} = require("../utils/salarySplit");

const average = (values) => {
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 100) / 100;
};

const serializeTeacher = (teacher) => ({
  _id: teacher._id,
  teacherId: teacher.teacherId,
  name: teacher.name,
  banglaName: teacher.banglaName || "",
  designation: teacher.designation || "",
  phone: teacher.phone || "",
  campus: teacher.campus,
  basicSalary: teacher.basicSalary || 0,
  houseRent: teacher.houseRent || 0,
});

const getRecentDuties = async (teacherId, yearCount = 3) => {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: yearCount }, (_, index) => currentYear - index);
  const minYear = years[years.length - 1];
  const rows = await ResponsibilityAssignment.aggregate([
    {
      $match: {
        teacher: new mongoose.Types.ObjectId(String(teacherId)),
        year: { $gte: minYear, $lte: currentYear },
        status: { $ne: "Cancelled" },
      },
    },
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
    { $unwind: { path: "$subjectDetails", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$year",
        duties: {
          $push: {
            name: "$typeDetails.name",
            class: { $ifNull: ["$classDetails.name", ""] },
            subject: { $ifNull: ["$subjectDetails.name", ""] },
          },
        },
      },
    },
  ]);

  const byYear = new Map(rows.map((row) => [row._id, row.duties || []]));
  return years.map((year) => {
    const seen = new Map();
    (byYear.get(year) || []).forEach((item) => {
      const key = item.name || "Duty";
      if (!seen.has(key)) {
        seen.set(key, { name: key, details: [] });
      }
      const detail = [item.class, item.subject].filter(Boolean).join(" · ");
      if (detail) seen.get(key).details.push(detail);
    });
    return { year, duties: Array.from(seen.values()) };
  });
};

const applyLockedLetterSalary = async (teacher, letter, letterLocked) => {
  if (!teacher || !letter || letter.status !== "final" || !letterLocked) {
    return teacher;
  }

  const nextBasic = Math.max(0, Number(letter.newBasic) || 0);
  const nextRent = Math.max(0, Number(letter.newHouseRent) || 0);
  if (teacher.basicSalary === nextBasic && teacher.houseRent === nextRent) {
    return teacher;
  }

  const previousBasic = Math.max(0, Number(letter.previousBasic) || 0);
  const salaryAlreadyMovedOn =
    teacher.basicSalary !== previousBasic && teacher.basicSalary !== nextBasic;
  if (salaryAlreadyMovedOn) return teacher;

  teacher.basicSalary = nextBasic;
  teacher.houseRent = nextRent;
  await teacher.save();
  return teacher;
};

const resolveLetterLock = async (fiscalYear) => {
  const year = fiscalYear || getFiscalYearForDate();
  const settings = await IncrementSettings.findOne({ fiscalYear: year }).lean();
  const letterLockOn = settings?.letterLockOn || defaultLetterLockOn(year);
  const letterLocked = isIncrementLetterLocked(year, new Date(), letterLockOn);
  return {
    fiscalYear: year,
    letterLockOn,
    letterLockAfter: endOfLocalDay(letterLockOn),
    letterLocked,
    isCustomLock: Boolean(settings?.letterLockOn),
  };
};

const applyFinalLettersIfLocked = async (fiscalYear, letterLocked) => {
  if (!letterLocked) return 0;
  const letters = await IncrementLetter.find({
    fiscalYear,
    status: "final",
  }).lean();
  let updated = 0;
  for (const letter of letters) {
    const teacher = await Teacher.findById(letter.teacher);
    if (!teacher) continue;
    const beforeBasic = teacher.basicSalary;
    const beforeRent = teacher.houseRent;
    await applyLockedLetterSalary(teacher, letter, true);
    if (
      teacher.basicSalary !== beforeBasic ||
      teacher.houseRent !== beforeRent
    ) {
      updated += 1;
    }
  }
  return updated;
};

const buildTeacherCampusFilter = (user, campusQuery) => {
  if (SCHOOL_WIDE_ROLES.includes(user.role)) {
    if (campusQuery) return { campus: campusQuery };
    return {};
  }
  const campusIds = getUserCampusIds(user);
  if (!campusIds.length) return { campus: null };
  if (campusQuery && campusIds.includes(String(campusQuery))) {
    return { campus: campusQuery };
  }
  return { campus: { $in: campusIds } };
};

const computeAverages = async (teacherId, fiscalYear) => {
  const evaluations = await IncrementEvaluation.find({
    teacher: teacherId,
    fiscalYear,
  })
    .populate("criterion", "titleBn evaluateeRole code sortOrder")
    .lean();

  const overall = average(
    evaluations.map((item) => item.normalizedScore).filter(Number.isFinite)
  );

  const byEvaluatorRole = {
    incharge: average(
      evaluations
        .filter((item) => item.evaluatorRole === "incharge")
        .map((item) => item.normalizedScore)
    ),
    coordinator: average(
      evaluations
        .filter((item) => item.evaluatorRole === "coordinator")
        .map((item) => item.normalizedScore)
    ),
    head_teacher: average(
      evaluations
        .filter((item) =>
          ["head_teacher", "admin"].includes(item.evaluatorRole)
        )
        .map((item) => item.normalizedScore)
    ),
  };

  const criterionMap = new Map();
  evaluations.forEach((item) => {
    const key = String(item.criterion?._id || item.criterion);
    if (!criterionMap.has(key)) {
      criterionMap.set(key, {
        criterion: item.criterion?._id || item.criterion,
        titleBn: item.criterion?.titleBn || "",
        scores: [],
      });
    }
    criterionMap.get(key).scores.push(item.normalizedScore);
  });

  const byCriterion = [...criterionMap.values()].map((item) => ({
    criterion: item.criterion,
    titleBn: item.titleBn,
    average: average(item.scores),
  }));

  return {
    overall,
    byEvaluatorRole,
    byCriterion,
    entryCount: evaluations.length,
    evaluations,
  };
};

const canDownloadLetters = (user) =>
  ["admin", "head_teacher", "coordinator"].includes(user?.role);

const buildDefaultLetter = (teacher, fiscalYear, evaluateeRole, criteria = []) => ({
  teacher: teacher._id,
  fiscalYear,
  evaluateeRole,
  status: "draft",
  letterDate: new Date(),
  averages: {
    overall: null,
    byEvaluatorRole: {
      incharge: null,
      coordinator: null,
      head_teacher: null,
    },
    byCriterion: [],
  },
  generalIncrement: 0,
  performanceIncrement: 0,
  totalIncrement: 0,
  criterionAmounts: criteria.map((criterion) => ({
    criterion: criterion._id,
    titleBn: criterion.titleBn,
    amount: 0,
  })),
  previousBasic: teacher.basicSalary || 0,
  previousHouseRent: houseRentFromBasic(teacher.basicSalary || 0),
  newBasic: teacher.basicSalary || 0,
  newHouseRent: houseRentFromBasic(teacher.basicSalary || 0),
  totalMonthly:
    (teacher.basicSalary || 0) + houseRentFromBasic(teacher.basicSalary || 0),
  effectiveFromLabel: "",
});

const getMeta = async (req, res) => {
  try {
    await ensureIncrementCriteria();
    const currentFiscalYear = getFiscalYearForDate();
    const downloadLetters = canDownloadLetters(req.user);
    let letterCampuses = [];
    if (downloadLetters) {
      const campusFilter = { isActive: { $ne: false } };
      if (req.user.role === "coordinator") {
        const ids = getUserCampusIds(req.user);
        campusFilter._id = { $in: ids };
      }
      letterCampuses = await Branch.find(campusFilter)
        .select("name location")
        .sort({ name: 1 })
        .lean();
    }
    const lock = await resolveLetterLock(currentFiscalYear);
    res.json({
      currentFiscalYear,
      fiscalYears: listRecentFiscalYears(5),
      scaleMax: getScaleMaxForEvaluatorRole(req.user.role),
      canEvaluate: INCREMENT_EVALUATOR_ROLES.includes(req.user.role),
      canDownloadLetters: downloadLetters,
      letterCampuses,
      letterLockOn: lock.letterLockOn,
      letterLocked: lock.letterLocked,
      letterLockRule:
        "Letters lock after the date set by admin or head teacher. Default is 3 August after the fiscal year ends. Finalized salaries apply only after lock.",
      evaluationEditRule:
        "Previous fiscal year evaluations remain editable until 31 July.",
      canSetLetterLock: ["admin", "head_teacher"].includes(req.user.role),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCriteria = async (req, res) => {
  try {
    await ensureIncrementCriteria();
    const { evaluateeRole } = req.query;
    const filter = { isActive: true };
    if (evaluateeRole) filter.evaluateeRole = evaluateeRole;
    const criteria = await IncrementCriteria.find(filter)
      .sort({ evaluateeRole: 1, sortOrder: 1 })
      .lean();
    res.json(criteria);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listTeachersForIncrement = async (req, res) => {
  try {
    const { fiscalYear = getFiscalYearForDate(), campus, q } = req.query;
    const campusFilter = buildTeacherCampusFilter(req.user, campus);
    const filter = { isActive: { $ne: false }, ...campusFilter };

    if (q?.trim()) {
      const term = q.trim();
      filter.$or = [
        { name: { $regex: term, $options: "i" } },
        { banglaName: { $regex: term, $options: "i" } },
        { teacherId: { $regex: term, $options: "i" } },
      ];
    }

    const teachers = await Teacher.find(filter)
      .populate("campus", "name")
      .sort({ name: 1 })
      .lean();

    const roleMap = await resolveEvaluateeRoles(teachers.map((item) => item._id));
    const visibleTeachers = teachers.filter((teacher) => {
      const evaluateeRole = roleMap.get(String(teacher._id)) || "teacher";
      if (req.user.role === "incharge") return evaluateeRole === "teacher";
      if (req.user.role === "coordinator") {
        return evaluateeRole === "teacher" || evaluateeRole === "incharge";
      }
      return true;
    });

    const teacherObjectIds = visibleTeachers.map((item) => item._id);
    const evaluationGroups = teacherObjectIds.length
      ? await IncrementEvaluation.aggregate([
          {
            $match: {
              teacher: { $in: teacherObjectIds },
              fiscalYear,
            },
          },
          {
            $group: {
              _id: "$teacher",
              overall: { $avg: "$normalizedScore" },
              entryCount: { $sum: 1 },
              incharge: {
                $avg: {
                  $cond: [
                    { $eq: ["$evaluatorRole", "incharge"] },
                    "$normalizedScore",
                    null,
                  ],
                },
              },
              coordinator: {
                $avg: {
                  $cond: [
                    { $eq: ["$evaluatorRole", "coordinator"] },
                    "$normalizedScore",
                    null,
                  ],
                },
              },
              head_teacher: {
                $avg: {
                  $cond: [
                    {
                      $in: ["$evaluatorRole", ["head_teacher", "admin"]],
                    },
                    "$normalizedScore",
                    null,
                  ],
                },
              },
            },
          },
        ])
      : [];

    const averageMap = new Map(
      evaluationGroups.map((item) => [
        String(item._id),
        {
          overall:
            item.overall == null
              ? null
              : Math.round(item.overall * 100) / 100,
          byEvaluatorRole: {
            incharge:
              item.incharge == null
                ? null
                : Math.round(item.incharge * 100) / 100,
            coordinator:
              item.coordinator == null
                ? null
                : Math.round(item.coordinator * 100) / 100,
            head_teacher:
              item.head_teacher == null
                ? null
                : Math.round(item.head_teacher * 100) / 100,
          },
          entryCount: item.entryCount || 0,
        },
      ])
    );

    const rows = visibleTeachers.map((teacher) => {
      const evaluateeRole = roleMap.get(String(teacher._id)) || "teacher";
      const averages = averageMap.get(String(teacher._id)) || {
        overall: null,
        byEvaluatorRole: {
          incharge: null,
          coordinator: null,
          head_teacher: null,
        },
        entryCount: 0,
      };
      return {
        _id: teacher._id,
        teacherId: teacher.teacherId,
        name: teacher.name,
        banglaName: teacher.banglaName || "",
        designation: teacher.designation || "",
        campus: teacher.campus,
        basicSalary: teacher.basicSalary || 0,
        houseRent: teacher.houseRent || 0,
        evaluateeRole,
        averages,
      };
    });

    const lock = await resolveLetterLock(fiscalYear);

    res.json({
      fiscalYear,
      canEditEvaluations: canEditEvaluationsForFiscalYear(fiscalYear),
      letterLocked: lock.letterLocked,
      letterLockOn: lock.letterLockOn,
      teachers: rows,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getTeacherIncrementSummary = async (req, res) => {
  try {
    const fiscalYear = req.query.fiscalYear || getFiscalYearForDate();
    const teacherDoc = await Teacher.findById(req.params.teacherId).populate(
      "campus",
      "name location"
    );
    if (!teacherDoc) {
      return res.status(404).json({ message: "Teacher not found." });
    }
    if (!canAccessTeacherCampus(req.user, teacherDoc)) {
      return res.status(403).json({ message: "Access denied for this teacher." });
    }

    const evaluateeRole = await resolveEvaluateeRole(teacherDoc._id);
    const criteria = await IncrementCriteria.find({
      evaluateeRole,
      isActive: true,
    })
      .sort({ sortOrder: 1 })
      .lean();
    const averages = await computeAverages(teacherDoc._id, fiscalYear);
    const letter = await IncrementLetter.findOne({
      teacher: teacherDoc._id,
      fiscalYear,
    }).lean();
    const lock = await resolveLetterLock(fiscalYear);
    await applyLockedLetterSalary(teacherDoc, letter, lock.letterLocked);
    const teacher = teacherDoc.toObject();
    const recentDuties = await getRecentDuties(teacher._id);

    res.json({
      teacher: serializeTeacher(teacher),
      recentDuties,
      evaluateeRole,
      fiscalYear,
      fiscalBounds: getFiscalYearBounds(fiscalYear, lock.letterLockOn),
      canEditEvaluations: canEditEvaluationsForFiscalYear(fiscalYear),
      canEvaluate: canEvaluateTeacher(req.user, teacher, evaluateeRole),
      scaleMax: getScaleMaxForEvaluatorRole(req.user.role),
      letterLocked: lock.letterLocked,
      letterLockOn: lock.letterLockOn,
      canSetLetterLock: ["admin", "head_teacher"].includes(req.user.role),
      criteria,
      averages,
      letter,
      recentEvaluations: averages.evaluations
        .sort(
          (a, b) =>
            new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime()
        )
        .slice(0, 50),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createEvaluation = async (req, res) => {
  try {
    const {
      teacherId,
      criterionId,
      score,
      fiscalYear = getFiscalYearForDate(),
      note = "",
      evaluatedAt,
    } = req.body;

    if (!canEditEvaluationsForFiscalYear(fiscalYear)) {
      return res.status(400).json({
        message:
          "Evaluation edit window closed for this fiscal year (deadline: 31 July).",
      });
    }

    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }

    const evaluateeRole = await resolveEvaluateeRole(teacher._id);
    if (!canEvaluateTeacher(req.user, teacher, evaluateeRole)) {
      return res.status(403).json({
        message: "You are not allowed to evaluate this staff member.",
      });
    }

    const criterion = await IncrementCriteria.findById(criterionId);
    if (!criterion || !criterion.isActive) {
      return res.status(400).json({ message: "Invalid evaluation criterion." });
    }
    if (criterion.evaluateeRole !== evaluateeRole) {
      return res.status(400).json({
        message: "Criterion does not match this person's evaluation template.",
      });
    }

    const scaleMax = getScaleMaxForEvaluatorRole(req.user.role);
    const numericScore = Number(score);
    if (
      !Number.isFinite(numericScore) ||
      numericScore < 1 ||
      numericScore > scaleMax
    ) {
      return res.status(400).json({
        message: `Score must be between 1 and ${scaleMax} for your role.`,
      });
    }

    const normalized = normalizeScore(numericScore, scaleMax);
    const evaluation = await IncrementEvaluation.create({
      teacher: teacher._id,
      fiscalYear,
      criterion: criterion._id,
      score: numericScore,
      scaleMax,
      normalizedScore: normalized,
      evaluator: req.user._id,
      evaluatorRole: req.user.role === "admin" ? "head_teacher" : req.user.role,
      evaluatedAt: evaluatedAt ? new Date(evaluatedAt) : new Date(),
      note: String(note || "").trim(),
    });

    const populated = await IncrementEvaluation.findById(evaluation._id)
      .populate("criterion", "titleBn code evaluateeRole")
      .populate("evaluator", "name role")
      .lean();

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateEvaluation = async (req, res) => {
  try {
    const evaluation = await IncrementEvaluation.findById(req.params.id);
    if (!evaluation) {
      return res.status(404).json({ message: "Evaluation not found." });
    }

    if (!canEditEvaluationsForFiscalYear(evaluation.fiscalYear)) {
      return res.status(400).json({
        message:
          "Evaluation edit window closed for this fiscal year (deadline: 31 July).",
      });
    }

    const isOwner = String(evaluation.evaluator) === String(req.user._id);
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only edit your own scores." });
    }

    const scaleMax = evaluation.scaleMax;
    if (req.body.score !== undefined) {
      const numericScore = Number(req.body.score);
      if (
        !Number.isFinite(numericScore) ||
        numericScore < 1 ||
        numericScore > scaleMax
      ) {
        return res.status(400).json({
          message: `Score must be between 1 and ${scaleMax}.`,
        });
      }
      evaluation.score = numericScore;
      evaluation.normalizedScore = normalizeScore(numericScore, scaleMax);
    }
    if (req.body.note !== undefined) {
      evaluation.note = String(req.body.note || "").trim();
    }
    if (req.body.evaluatedAt) {
      evaluation.evaluatedAt = new Date(req.body.evaluatedAt);
    }

    await evaluation.save();
    const populated = await IncrementEvaluation.findById(evaluation._id)
      .populate("criterion", "titleBn code evaluateeRole")
      .populate("evaluator", "name role")
      .lean();
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteEvaluation = async (req, res) => {
  try {
    const evaluation = await IncrementEvaluation.findById(req.params.id);
    if (!evaluation) {
      return res.status(404).json({ message: "Evaluation not found." });
    }
    if (!canEditEvaluationsForFiscalYear(evaluation.fiscalYear)) {
      return res.status(400).json({
        message:
          "Evaluation edit window closed for this fiscal year (deadline: 31 July).",
      });
    }
    const isOwner = String(evaluation.evaluator) === String(req.user._id);
    if (!isOwner && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "You can only delete your own scores." });
    }
    await evaluation.deleteOne();
    res.json({ message: "Evaluation deleted." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateTeacherSalary = async (req, res) => {
  try {
    if (!["admin", "head_teacher"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Only admin or head teacher can update salary fields.",
      });
    }

    const teacher = await Teacher.findById(req.params.teacherId);
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }

    if (req.body.basicSalary !== undefined) {
      teacher.basicSalary = Math.max(0, Number(req.body.basicSalary) || 0);
    }
    teacher.houseRent = houseRentFromBasic(teacher.basicSalary);
    await teacher.save();

    res.json({
      _id: teacher._id,
      basicSalary: teacher.basicSalary,
      houseRent: teacher.houseRent,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const upsertIncrementLetter = async (req, res) => {
  try {
    if (!["admin", "head_teacher"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Only admin or head teacher can prepare increment letters.",
      });
    }

    const fiscalYear = req.body.fiscalYear || getFiscalYearForDate();
    const lock = await resolveLetterLock(fiscalYear);
    if (lock.letterLocked && req.user.role !== "admin") {
      return res.status(400).json({
        message: `Increment letter is locked after ${lock.letterLockOn}.`,
      });
    }

    const teacher = await Teacher.findById(req.body.teacherId).populate(
      "campus",
      "name location"
    );
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }

    const evaluateeRole = await resolveEvaluateeRole(teacher._id);
    const averages = await computeAverages(teacher._id, fiscalYear);
    const criteria = await IncrementCriteria.find({
      evaluateeRole,
      isActive: true,
    })
      .sort({ sortOrder: 1 })
      .lean();

    const incomingAmounts = Array.isArray(req.body.criterionAmounts)
      ? req.body.criterionAmounts
      : [];
    const criterionAmounts = criteria.map((criterion) => {
      const match = incomingAmounts.find(
        (item) => String(item.criterion) === String(criterion._id)
      );
      return {
        criterion: criterion._id,
        titleBn: criterion.titleBn,
        amount: Math.max(0, Number(match?.amount) || 0),
      };
    });
    const amountsTotal = criterionAmounts.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0
    );

    const generalIncrement = Number(req.body.generalIncrement) || 0;
    const bodyPerformance = Number(req.body.performanceIncrement) || 0;
    const performanceIncrement =
      amountsTotal > 0 ? amountsTotal : bodyPerformance;
    const existingLetter = await IncrementLetter.findOne({
      teacher: teacher._id,
      fiscalYear,
    })
      .select("status previousBasic")
      .lean();
    const previousBasicSource =
      existingLetter?.status === "final" && existingLetter.previousBasic != null
        ? existingLetter.previousBasic
        : teacher.basicSalary || 0;
    const derived = deriveIncrementSalary({
      previousBasic: previousBasicSource,
      generalIncrement,
      performanceIncrement,
    });
    const previousBasic = derived.previousBasic;
    const previousHouseRent = derived.previousHouseRent;
    const totalIncrement = derived.totalIncrement;
    const newBasic = derived.newBasic;
    const newHouseRent = derived.newHouseRent;
    const totalMonthly = derived.totalMonthly;

    const status = req.body.status === "final" ? "final" : "draft";
    const startYear = parseInt(String(fiscalYear).split("-")[0], 10);
    const effectiveFromLabel =
      req.body.effectiveFromLabel ||
      `জুলাই-${Number.isFinite(startYear) ? startYear : ""}`;

    const letter = await IncrementLetter.findOneAndUpdate(
      { teacher: teacher._id, fiscalYear },
      {
        $set: {
          evaluateeRole,
          letterDate: req.body.letterDate
            ? new Date(req.body.letterDate)
            : new Date(),
          status,
          averages: {
            overall: averages.overall,
            byEvaluatorRole: averages.byEvaluatorRole,
            byCriterion: averages.byCriterion,
          },
          generalIncrement,
          performanceIncrement,
          totalIncrement,
          criterionAmounts,
          previousBasic,
          previousHouseRent,
          newBasic,
          newHouseRent,
          totalMonthly,
          effectiveFromLabel,
          notes: String(req.body.notes || "").trim(),
          finalizedBy: status === "final" ? req.user._id : undefined,
          lockedAt:
            status === "final" && lock.letterLocked ? new Date() : null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    if (status === "final") {
      await applyLockedLetterSalary(
        teacher,
        {
          status,
          previousBasic,
          newBasic,
          newHouseRent,
        },
        lock.letterLocked
      );
    }

    res.json({
      letter,
      teacher: serializeTeacher(teacher),
      evaluateeRole,
      letterLocked: lock.letterLocked,
      letterLockOn: lock.letterLockOn,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getIncrementLetter = async (req, res) => {
  try {
    const fiscalYear = req.query.fiscalYear || getFiscalYearForDate();
    const teacherDoc = await Teacher.findById(req.params.teacherId).populate(
      "campus",
      "name location"
    );
    if (!teacherDoc) {
      return res.status(404).json({ message: "Teacher not found." });
    }
    if (!canAccessTeacherCampus(req.user, teacherDoc)) {
      return res.status(403).json({ message: "Access denied for this teacher." });
    }

    const evaluateeRole = await resolveEvaluateeRole(teacherDoc._id);
    const criteria = await IncrementCriteria.find({
      evaluateeRole,
      isActive: true,
    })
      .sort({ sortOrder: 1 })
      .lean();
    const averages = await computeAverages(teacherDoc._id, fiscalYear);
    let letter = await IncrementLetter.findOne({
      teacher: teacherDoc._id,
      fiscalYear,
    }).lean();
    const lock = await resolveLetterLock(fiscalYear);
    await applyLockedLetterSalary(teacherDoc, letter, lock.letterLocked);
    const teacher = teacherDoc.toObject();

    if (!letter) {
      letter = {
        teacher: teacher._id,
        fiscalYear,
        evaluateeRole,
        status: "draft",
        averages: {
          overall: averages.overall,
          byEvaluatorRole: averages.byEvaluatorRole,
          byCriterion: averages.byCriterion,
        },
        ...deriveIncrementSalary({
          previousBasic: teacher.basicSalary || 0,
          generalIncrement: 0,
          performanceIncrement: 0,
        }),
        generalIncrement: 0,
        performanceIncrement: 0,
        criterionAmounts: criteria.map((criterion) => ({
          criterion: criterion._id,
          titleBn: criterion.titleBn,
          amount: 0,
        })),
        effectiveFromLabel: "",
      };
    }

    res.json({
      teacher: serializeTeacher(teacher),
      evaluateeRole,
      fiscalYear,
      criteria,
      averages,
      letter,
      letterLocked: lock.letterLocked,
      letterLockOn: lock.letterLockOn,
      canManageLetter: ["admin", "head_teacher"].includes(req.user.role),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listLetterBundle = async (req, res) => {
  try {
    if (!canDownloadLetters(req.user)) {
      return res.status(403).json({
        message: "Only admin, head teacher, or coordinator can download shift letters.",
      });
    }

    const fiscalYear = req.query.fiscalYear || getFiscalYearForDate();
    const campusId = req.query.campus;
    if (!campusId) {
      return res.status(400).json({ message: "Campus/shift is required." });
    }

    if (
      req.user.role === "coordinator" &&
      !getUserCampusIds(req.user).includes(String(campusId))
    ) {
      return res.status(403).json({
        message: "You can download letters only for your assigned branches.",
      });
    }

    const campus = await Branch.findById(campusId).select("name location").lean();
    if (!campus) {
      return res.status(404).json({ message: "Campus/shift not found." });
    }

    const teachers = await Teacher.find({
      isActive: { $ne: false },
      campus: campusId,
    })
      .populate("campus", "name location")
      .sort({ name: 1 })
      .lean();

    const roleMap = await resolveEvaluateeRoles(teachers.map((item) => item._id));
    const criteriaRows = await IncrementCriteria.find({ isActive: true })
      .sort({ sortOrder: 1 })
      .lean();
    const criteriaByRole = {
      teacher: criteriaRows.filter((item) => item.evaluateeRole === "teacher"),
      incharge: criteriaRows.filter((item) => item.evaluateeRole === "incharge"),
      coordinator: criteriaRows.filter(
        (item) => item.evaluateeRole === "coordinator"
      ),
    };

    const savedLetters = teachers.length
      ? await IncrementLetter.find({
          teacher: { $in: teachers.map((item) => item._id) },
          fiscalYear,
        }).lean()
      : [];
    const letterMap = new Map(
      savedLetters.map((item) => [String(item.teacher), item])
    );

    const items = teachers.map((teacher) => {
      const evaluateeRole = roleMap.get(String(teacher._id)) || "teacher";
      const criteria = criteriaByRole[evaluateeRole] || [];
      const saved = letterMap.get(String(teacher._id));
      return {
        teacher: serializeTeacher(teacher),
        evaluateeRole,
        criteria,
        letter: saved || buildDefaultLetter(teacher, fiscalYear, evaluateeRole, criteria),
      };
    });

    res.json({
      campus,
      fiscalYear,
      count: items.length,
      items,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getIncrementSettings = async (req, res) => {
  try {
    const fiscalYear = req.query.fiscalYear || getFiscalYearForDate();
    const lock = await resolveLetterLock(fiscalYear);
    res.json({
      ...lock,
      defaultLetterLockOn: defaultLetterLockOn(fiscalYear),
      canSetLetterLock: ["admin", "head_teacher"].includes(req.user.role),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateIncrementSettings = async (req, res) => {
  try {
    if (!["admin", "head_teacher"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Only admin or head teacher can set the letter lock date.",
      });
    }

    const fiscalYear = req.body.fiscalYear || getFiscalYearForDate();
    const letterLockOn = String(req.body.letterLockOn || "").trim();
    if (!endOfLocalDay(letterLockOn)) {
      return res.status(400).json({
        message: "Enter a valid letter lock date (YYYY-MM-DD).",
      });
    }

    const settings = await IncrementSettings.findOneAndUpdate(
      { fiscalYear },
      {
        $set: {
          letterLockOn,
          updatedBy: req.user._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const lock = await resolveLetterLock(fiscalYear);
    const salariesUpdated = await applyFinalLettersIfLocked(
      fiscalYear,
      lock.letterLocked
    );

    res.json({
      ...lock,
      settings,
      salariesUpdated,
      message: lock.letterLocked
        ? `Letters are locked. ${salariesUpdated} teacher salary record(s) updated from finalized letters.`
        : `Letters will lock on ${letterLockOn}. Salary updates apply only after that date.`,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
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
};
