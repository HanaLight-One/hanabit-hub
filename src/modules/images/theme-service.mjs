import { operationalDate } from "./operational-date.mjs";

export function createThemeService({
  history,
  source,
  timezone = "Asia/Seoul",
  dayStartsAtHour = 2,
  now = () => new Date(),
}) {
  if (!history?.get) throw new TypeError("테마 기록 저장소가 필요합니다.");

  async function get(date) {
    await source?.capture();
    const requestedDate =
      date ??
      operationalDate(now(), {
        timezone,
        dayStartsAtHour,
      });

    return {
      date: requestedDate,
      theme: await history.get(requestedDate),
    };
  }

  return Object.freeze({ get });
}
