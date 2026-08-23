/**
 * Fiscal year: 1 July → 30 June (e.g. 2026-27).
 * Evaluation edit (previous FY): until 31 July after FY end.
 * Letter lock date is configurable per fiscal year (default: 3 August after FY end).
 */

const parseFiscalYearStart = (fiscalYear) => {
  const start = parseInt(String(fiscalYear || "").split("-")[0], 10);
  return Number.isFinite(start) ? start : null;
};

const formatFiscalYear = (startYear) =>
  `${startYear}-${String(startYear + 1).slice(-2)}`;

const pad2 = (value) => String(value).padStart(2, "0");

const defaultLetterLockOn = (fiscalYear) => {
  const startYear = parseFiscalYearStart(fiscalYear);
  if (!startYear) return "";
  return `${startYear + 1}-08-03`;
};

const endOfLocalDay = (ymd) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const formatYmd = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
};

const getFiscalYearForDate = (input = new Date()) => {
  const date = input instanceof Date ? input : new Date(input);
  const year = date.getFullYear();
  const month = date.getMonth(); // 0 = Jan
  if (month >= 6) return formatFiscalYear(year);
  return formatFiscalYear(year - 1);
};

const getFiscalYearBounds = (fiscalYear, letterLockOn) => {
  const startYear = parseFiscalYearStart(fiscalYear);
  if (!startYear) return null;
  const lockOn = letterLockOn || defaultLetterLockOn(fiscalYear);
  return {
    start: new Date(startYear, 6, 1, 0, 0, 0, 0),
    end: new Date(startYear + 1, 5, 30, 23, 59, 59, 999),
    editDeadline: new Date(startYear + 1, 6, 31, 23, 59, 59, 999),
    letterLockOn: lockOn,
    letterLockAfter: endOfLocalDay(lockOn),
  };
};

const listRecentFiscalYears = (count = 4, fromDate = new Date()) => {
  const current = getFiscalYearForDate(fromDate);
  const start = parseFiscalYearStart(current);
  return Array.from({ length: count }, (_, index) =>
    formatFiscalYear(start - index)
  );
};

const canEditEvaluationsForFiscalYear = (fiscalYear, now = new Date()) => {
  const bounds = getFiscalYearBounds(fiscalYear);
  if (!bounds) return false;
  const currentFy = getFiscalYearForDate(now);
  if (fiscalYear === currentFy) return true;
  return now <= bounds.editDeadline;
};

const isIncrementLetterLocked = (
  fiscalYear,
  now = new Date(),
  letterLockOn
) => {
  const bounds = getFiscalYearBounds(fiscalYear, letterLockOn);
  if (!bounds?.letterLockAfter) return true;
  const lockStart = new Date(bounds.letterLockAfter);
  lockStart.setHours(0, 0, 0, 0);
  return now >= lockStart;
};

module.exports = {
  formatFiscalYear,
  formatYmd,
  getFiscalYearForDate,
  getFiscalYearBounds,
  listRecentFiscalYears,
  canEditEvaluationsForFiscalYear,
  isIncrementLetterLocked,
  parseFiscalYearStart,
  defaultLetterLockOn,
  endOfLocalDay,
};
