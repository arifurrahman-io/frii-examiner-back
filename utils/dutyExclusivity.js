/**
 * Per-year exclusivity for examination examiner duties.
 * Once a teacher has any duty from a group in a year, no further
 * assignment from that group is allowed (even for other class/subject).
 * Each group can be toggled via App Settings.
 */
const DEFAULT_DUTY_EXCLUSIVITY = {
  hyPreTest: true,
  eTest: true,
  eAnnual: true,
};

const EXCLUSIVE_DUTY_GROUPS = [
  {
    id: "hyPreTest",
    label: "E-HY or E-Pre-Test",
    types: ["E-HY", "E-Pre-Test"],
  },
  {
    id: "eTest",
    label: "E-Test",
    types: ["E-Test"],
  },
  {
    id: "eAnnual",
    label: "E-Annual",
    types: ["E-Annual"],
  },
];

const normalizeDutyExclusivity = (rules = {}) => ({
  hyPreTest:
    typeof rules.hyPreTest === "boolean"
      ? rules.hyPreTest
      : DEFAULT_DUTY_EXCLUSIVITY.hyPreTest,
  eTest:
    typeof rules.eTest === "boolean"
      ? rules.eTest
      : DEFAULT_DUTY_EXCLUSIVITY.eTest,
  eAnnual:
    typeof rules.eAnnual === "boolean"
      ? rules.eAnnual
      : DEFAULT_DUTY_EXCLUSIVITY.eAnnual,
});

const getExclusiveGroup = (typeName, rules = DEFAULT_DUTY_EXCLUSIVITY) => {
  const enabled = normalizeDutyExclusivity(rules);
  const group = EXCLUSIVE_DUTY_GROUPS.find((item) =>
    item.types.includes(typeName)
  );
  if (!group || !enabled[group.id]) return null;
  return group;
};

const isActiveAssignmentStatus = (status) => status && status !== "Cancelled";

module.exports = {
  DEFAULT_DUTY_EXCLUSIVITY,
  EXCLUSIVE_DUTY_GROUPS,
  normalizeDutyExclusivity,
  getExclusiveGroup,
  isActiveAssignmentStatus,
};
