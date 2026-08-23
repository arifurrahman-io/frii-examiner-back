const HOUSE_RENT_RATIO = 0.5;
const BASIC_INCREMENT_SHARE = 2 / 3;

const toAmount = (value) => Math.max(0, Number(value) || 0);

const houseRentFromBasic = (basic) =>
  Math.round(toAmount(basic) * HOUSE_RENT_RATIO);

const deriveIncrementSalary = ({
  previousBasic = 0,
  generalIncrement = 0,
  performanceIncrement = 0,
} = {}) => {
  const basic = toAmount(previousBasic);
  const totalIncrement =
    toAmount(generalIncrement) + toAmount(performanceIncrement);
  const newBasic = basic + Math.round(totalIncrement * BASIC_INCREMENT_SHARE);
  const previousHouseRent = houseRentFromBasic(basic);
  const newHouseRent = houseRentFromBasic(newBasic);

  return {
    previousBasic: basic,
    previousHouseRent,
    totalIncrement,
    newBasic,
    newHouseRent,
    totalMonthly: newBasic + newHouseRent,
  };
};

module.exports = {
  HOUSE_RENT_RATIO,
  BASIC_INCREMENT_SHARE,
  houseRentFromBasic,
  deriveIncrementSalary,
};
