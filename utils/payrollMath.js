const { houseRentFromBasic } = require("./salarySplit");

const CL_ANNUAL_QUOTA = 20;
const CL_BENEFIT_USED_LIMIT = 11;
const PAYROLL_MONTH_DAYS = 30;
const PF_RATE = 0.1;

const toNonNegNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return numeric;
};

const toNonNegInt = (value) => Math.round(toNonNegNumber(value));

const roundTaka = (value) => Math.round(toNonNegNumber(value));

const perDayFromBasic = (basicSalary) =>
  roundTaka(basicSalary) / PAYROLL_MONTH_DAYS;

const pfFromBasic = (basicSalary, enabled) => {
  if (!enabled) {
    return { pfEmployee: 0, pfInstitution: 0, pfTotal: 0 };
  }
  const share = roundTaka(roundTaka(basicSalary) * PF_RATE);
  return {
    pfEmployee: share,
    pfInstitution: share,
    pfTotal: share * 2,
  };
};

const applyClOverflow = ({ otherYearClDays = 0, clDays = 0, lwpDays = 0 } = {}) => {
  const other = toNonNegInt(otherYearClDays);
  const requestedCl = toNonNegInt(clDays);
  const requestedLwp = toNonNegInt(lwpDays);
  const remaining = Math.max(0, CL_ANNUAL_QUOTA - other);
  const overflowDays = Math.max(0, requestedCl - remaining);

  return {
    clDays: requestedCl - overflowDays,
    lwpDays: requestedLwp + overflowDays,
    overflowDays,
  };
};

const monthlyPayroll = ({
  basicSalary = 0,
  houseRent,
  presentDays = 0,
  clDays = 0,
  lwpDays = 0,
  providentFundEnabled = false,
} = {}) => {
  const basic = roundTaka(basicSalary);
  const rent =
    houseRent === undefined || houseRent === null
      ? houseRentFromBasic(basic)
      : roundTaka(houseRent);
  const perDay = perDayFromBasic(basic);
  const lwpDeduction = roundTaka(perDay * toNonNegInt(lwpDays));
  const pf = pfFromBasic(basic, providentFundEnabled);
  const gross = basic + rent;
  const deduction = lwpDeduction + pf.pfEmployee;

  return {
    presentDays: toNonNegInt(presentDays),
    clDays: toNonNegInt(clDays),
    lwpDays: toNonNegInt(lwpDays),
    basic,
    houseRent: rent,
    perDay,
    lwpDeduction,
    deduction,
    providentFundEnabled: Boolean(providentFundEnabled),
    ...pf,
    gross,
    net: gross - deduction,
  };
};

const yearClBenefit = ({ basicSalary = 0, clUsed = 0 } = {}) => {
  const used = toNonNegInt(clUsed);
  const unusedCl = Math.max(0, CL_ANNUAL_QUOTA - used);
  const eligible = used < CL_BENEFIT_USED_LIMIT;
  const perDay = perDayFromBasic(basicSalary);
  const benefit = eligible ? roundTaka(perDay * unusedCl) : 0;

  return {
    eligible,
    clUsed: used,
    unusedCl,
    perDay,
    benefit,
  };
};

module.exports = {
  CL_ANNUAL_QUOTA,
  CL_BENEFIT_USED_LIMIT,
  PAYROLL_MONTH_DAYS,
  PF_RATE,
  toNonNegInt,
  roundTaka,
  perDayFromBasic,
  pfFromBasic,
  applyClOverflow,
  monthlyPayroll,
  yearClBenefit,
};
