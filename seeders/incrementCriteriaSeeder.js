const IncrementCriteria = require("../models/IncrementCriteriaModel");

const DEFAULT_CRITERIA = [
  {
    evaluateeRole: "teacher",
    code: "annual_performance",
    titleBn: "সাংবৎসরিক পারফরমেন্স মূল্যায়ন",
    descriptionBn:
      "বিষয়ভিত্তিক শিক্ষাদান, অন্যান্য অর্পিত দায়িত্ব, অ্যাডজাস্টমেন্ট ক্লাস, নির্দেশনা পালন, অনুষ্ঠান ও ক্লাবে অংশগ্রহণ।",
    sortOrder: 1,
  },
  {
    evaluateeRole: "teacher",
    code: "lesson_plan",
    titleBn: "লেসন প্ল্যানের প্রয়োগ",
    descriptionBn:
      "আদর্শ লেসন প্ল্যান নিয়মিত প্রস্তুতকরণ এবং অংশগ্রহণমূলক শ্রেণিকক্ষ নিশ্চিতকরণ।",
    sortOrder: 2,
  },
  {
    evaluateeRole: "teacher",
    code: "class_teacher",
    titleBn: "শ্রেণি শিক্ষকের দায়িত্ব",
    descriptionBn:
      "শিক্ষার্থী ফাইল হালনাগাদ, সমস্যাগ্রস্ত/দুর্বল ও প্রতিভাবান শিক্ষার্থী চিহ্নিতকরণ এবং নিবিড় তদারকি।",
    sortOrder: 3,
  },
  {
    evaluateeRole: "teacher",
    code: "examiner",
    titleBn: "পরীক্ষক ও নিরীক্ষকের দায়িত্ব",
    descriptionBn:
      "সময়মতো ও সঠিকভাবে খাতা মূল্যায়ন এবং সততার সাথে রিপোর্টিং।",
    sortOrder: 4,
  },
  {
    evaluateeRole: "incharge",
    code: "leadership",
    titleBn: "নেতৃত্ব",
    descriptionBn:
      "প্রাতিষ্ঠানিক সিদ্ধান্ত ও কর্মসূচি বাস্তবায়নে প্রয়োজনে অতিরিক্ত সময় দিয়ে সক্রিয় নেতৃত্ব।",
    sortOrder: 1,
  },
  {
    evaluateeRole: "incharge",
    code: "supervision",
    titleBn: "সুপারভিশন",
    descriptionBn:
      "শিক্ষকদের শ্রেণিকক্ষ শিক্ষাদান ও অন্যান্য কার্যক্রম নিয়মিত তদারকি এবং ফাইল হালনাগাদ।",
    sortOrder: 2,
  },
  {
    evaluateeRole: "incharge",
    code: "admin_mgmt",
    titleBn: "প্রশাসন ও ব্যবস্থাপনা",
    descriptionBn:
      "অফিস ও প্রশাসনিক কাজে অংশগ্রহণ এবং শিক্ষক-শিক্ষার্থী ও অভিভাবক সম্পর্ক সক্রিয় ব্যবস্থাপনা।",
    sortOrder: 3,
  },
  {
    evaluateeRole: "incharge",
    code: "mission",
    titleBn: "মিশন বাস্তবায়ন",
    descriptionBn:
      "আল্লাহর সাথে সংযোগ বৃদ্ধির মিশন বাস্তবায়নে ব্যক্তিগত ও দলগত সক্রিয়তা।",
    sortOrder: 4,
  },
  {
    evaluateeRole: "incharge",
    code: "teaching",
    titleBn: "শিক্ষাদান মান",
    descriptionBn:
      "সাপ্তাহিক শ্রেণিকক্ষ শিক্ষাদানে অংশগ্রহণ এবং আদর্শ লেসন প্ল্যান অনুসরণ।",
    sortOrder: 5,
  },
  {
    evaluateeRole: "coordinator",
    code: "leadership_supervision",
    titleBn: "নেতৃত্ব ও সুপারভিশন",
    descriptionBn:
      "সকল শিফট ইনচার্জের তদারকি, সমন্বয় ও নেতৃত্ব প্রদান।",
    sortOrder: 1,
  },
  {
    evaluateeRole: "coordinator",
    code: "implementation",
    titleBn: "বাস্তবায়ন",
    descriptionBn:
      "প্রাতিষ্ঠানিক নীতি, সিদ্ধান্ত ও কর্মসূচি বাস্তবায়নে সক্রিয় নেতৃত্ব।",
    sortOrder: 2,
  },
  {
    evaluateeRole: "coordinator",
    code: "admin_mgmt",
    titleBn: "প্রশাসনিক ও ব্যবস্থাপনা",
    descriptionBn:
      "অফিস ও প্রশাসনিক কাজ, শিক্ষক-শিক্ষার্থী ও অভিভাবক ব্যবস্থাপনা এবং প্রয়োজনীয় ডকুমেন্টেশন।",
    sortOrder: 3,
  },
  {
    evaluateeRole: "coordinator",
    code: "mission",
    titleBn: "মিশন বাস্তবায়ন",
    descriptionBn:
      "আল্লাহর সাথে সংযোগ বৃদ্ধির মিশন বাস্তবায়নে ব্যক্তিগত ও দলগত সক্রিয়তা।",
    sortOrder: 4,
  },
];

const ensureIncrementCriteria = async () => {
  for (const item of DEFAULT_CRITERIA) {
    await IncrementCriteria.updateOne(
      { evaluateeRole: item.evaluateeRole, code: item.code },
      { $set: { ...item, isActive: true } },
      { upsert: true }
    );
  }
  return IncrementCriteria.find({ isActive: true })
    .sort({ evaluateeRole: 1, sortOrder: 1 })
    .lean();
};

module.exports = {
  DEFAULT_CRITERIA,
  ensureIncrementCriteria,
};
