/** Minimum legal age to use the service. */
export const MIN_AGE = 18;

/** Age in whole years on `today` for a YYYY-MM-DD birth date. */
export function ageOn(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}
