/** Timezone-aware calendar helpers. All functions are pure (timezone passed explicitly). */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Calendar date (YYYY-MM-DD) of `at` as seen in timezone `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Offset of `tz` from UTC at instant `at`, in minutes (e.g. +60 for Africa/Douala). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant corresponding to wall-clock `hour:minute` on `date` in `tz`. */
export function zonedTimeToUtc(date: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  const offset = tzOffsetMinutes(guess, tz);
  const result = new Date(guess.getTime() - offset * 60000);
  // Re-check once in case the offset differs at the corrected instant (DST edges).
  const offset2 = tzOffsetMinutes(result, tz);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2 * 60000);
}

/** Day of week (0 = Sunday) for a YYYY-MM-DD date. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
