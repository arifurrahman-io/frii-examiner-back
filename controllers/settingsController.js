const AppSettings = require("../models/AppSettingsModel");
const {
  DEFAULT_DUTY_EXCLUSIVITY,
  normalizeDutyExclusivity,
} = require("../utils/dutyExclusivity");

const SETTINGS_KEY = "global";

const getOrCreateSettings = async () => {
  let settings = await AppSettings.findOne({ key: SETTINGS_KEY });
  if (!settings) {
    settings = await AppSettings.create({
      key: SETTINGS_KEY,
      dutyExclusivity: DEFAULT_DUTY_EXCLUSIVITY,
    });
  }
  return settings;
};

const serializeSettings = (settings) => ({
  dutyExclusivity: normalizeDutyExclusivity(settings.dutyExclusivity),
  updatedAt: settings.updatedAt,
  updatedBy: settings.updatedBy,
});

const getAppSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json(serializeSettings(settings));
  } catch (error) {
    res.status(500).json({
      message: "Failed to load app settings: " + error.message,
    });
  }
};

const updateAppSettings = async (req, res) => {
  try {
    const { dutyExclusivity } = req.body || {};
    if (!dutyExclusivity || typeof dutyExclusivity !== "object") {
      return res.status(400).json({
        message: "dutyExclusivity settings object is required.",
      });
    }

    const nextRules = normalizeDutyExclusivity(dutyExclusivity);
    const settings = await AppSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      {
        $set: {
          dutyExclusivity: nextRules,
          updatedBy: req.user?._id || null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      message: "Duty exclusivity settings saved.",
      ...serializeSettings(settings),
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update app settings: " + error.message,
    });
  }
};

module.exports = {
  getAppSettings,
  updateAppSettings,
  getOrCreateSettings,
};
