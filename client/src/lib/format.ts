/** Locale used for dates and numbers; kept in sync with the UI language by I18nProvider. */
let locale = "en-GB";
export function setFormatLocale(lang: string) {
  locale = lang === "fr" ? "fr-FR" : "en-GB";
}

export const formatXaf = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} XAF`;

export const pct = (p: number, dp = 0) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: dp, minimumFractionDigits: dp }).format(p * 100)}%`;

export const odds = (o: number) => o.toFixed(2);

export function kickoffTime(iso: string) {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function longDateTime(iso: string) {
  return new Date(iso).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString(locale);
}

export function weekdayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Plain-text tips for pasting elsewhere or sharing on WhatsApp. */
export function slipText(
  labels: { header: string; total: string; footer: string },
  title: string,
  legs: { homeTeam: string; awayTeam: string; short: string; label: string; odds: number; kickoff: string }[],
  totalOdds?: number,
) {
  const lines = legs.map(
    (l, i) => `${i + 1}. ${l.homeTeam} – ${l.awayTeam} (${kickoffTime(l.kickoff)}) — ${l.short} · ${l.label} @ ${odds(l.odds)}`,
  );
  return [`🃏 ${labels.header} · ${title}`, ...lines, totalOdds ? `${labels.total}: ${odds(totalOdds)}` : "", labels.footer]
    .filter(Boolean)
    .join("\n");
}
