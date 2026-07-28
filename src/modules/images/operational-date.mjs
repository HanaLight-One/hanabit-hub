const DEFAULT_TIMEZONE = "Asia/Seoul";
const DEFAULT_START_HOUR = 2;

function formatDateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function operationalDate(
  date = new Date(),
  { timezone = DEFAULT_TIMEZONE, dayStartsAtHour = DEFAULT_START_HOUR } = {},
) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("유효한 Date가 필요합니다.");
  }

  if (!Number.isInteger(dayStartsAtHour) || dayStartsAtHour < 0 || dayStartsAtHour > 23) {
    throw new RangeError("dayStartsAtHour는 0부터 23 사이의 정수여야 합니다.");
  }

  const shifted = new Date(date.getTime() - dayStartsAtHour * 60 * 60 * 1000);
  return formatDateInTimezone(shifted, timezone);
}
