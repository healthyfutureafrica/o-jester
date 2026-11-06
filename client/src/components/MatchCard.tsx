import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { kickoffTime, odds, pct } from "../lib/format";
import type { MatchListItem } from "../lib/types";
import { Badge, ConfidenceMeter, ProbabilityBar, ResultBadge, StanceBadge, UpgradePrompt } from "./ui";

function TeamLogo({ src, name }: { src: string | null; name: string }) {
  if (src) return <img src={src} alt="" className="h-6 w-6 object-contain" loading="lazy" />;
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-700 text-[10px] font-bold text-ink-300" aria-hidden>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function MatchStatusLabel({ m }: { m: Pick<MatchListItem, "status" | "kickoff" | "homeGoals" | "awayGoals"> }) {
  const { t } = useI18n();
  if (m.status === "FINISHED") return <Badge>{t("ui.ft")} {m.homeGoals}-{m.awayGoals}</Badge>;
  if (m.status === "LIVE") return <Badge tone="red">● {t("status.LIVE")} {m.homeGoals !== null ? `${m.homeGoals}-${m.awayGoals}` : ""}</Badge>;
  if (m.status === "POSTPONED") return <Badge tone="gold">{t("status.POSTPONED")}</Badge>;
  if (m.status === "CANCELLED") return <Badge tone="red">{t("status.CANCELLED")}</Badge>;
  return <span className="text-sm font-semibold text-ink-300">{kickoffTime(m.kickoff)}</span>;
}

export function MatchCard({ match }: { match: MatchListItem }) {
  const { t } = useI18n();
  const p = match.prediction;
  return (
    <article className="card p-4 transition hover:border-ink-600">
      <Link to={`/app/matches/${match.id}`} className="block">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold">
              <TeamLogo src={match.homeLogo} name={match.homeTeam} />
              <span className="truncate">{match.homeTeam}</span>
            </div>
            <div className="flex items-center gap-2 font-semibold">
              <TeamLogo src={match.awayLogo} name={match.awayTeam} />
              <span className="truncate">{match.awayTeam}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <MatchStatusLabel m={match} />
            {p && <ConfidenceMeter value={p.confidence} size={44} />}
          </div>
        </div>

        {p && (
          <div className="mt-4 space-y-3">
            <ProbabilityBar {...p.probs} />
            {p.bestPick && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-800/80 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-ink-400">{t("match.aiPick")}</div>
                  <div className="truncate text-sm font-semibold">{p.bestPick.label}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold">
                    <span className="text-pitch-400">{p.bestPick.short}</span>
                    {p.bestPick.bookOdds && <span className="ml-1.5 text-gold-400">@ {odds(p.bestPick.bookOdds)}</span>}
                  </div>
                  <div className="text-xs text-ink-400">{t("match.chance", { p: pct(p.bestPick.probability) })}</div>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {p.aiStance && <StanceBadge stance={p.aiStance} />}
              {p.bestPick?.result && <ResultBadge result={p.bestPick.result} />}
              {p.bestPick?.edge !== undefined && p.bestPick.edge > 0.02 && <Badge tone="gold">{t("match.value", { p: pct(p.bestPick.edge) })}</Badge>}
              <span className="text-xs text-ink-400">
                xG {p.xg.home.toFixed(1)} – {p.xg.away.toFixed(1)}
              </span>
            </div>
          </div>
        )}
      </Link>

      {match.locked && match.requiredPlan && (
        <div className="mt-4 rounded-xl border border-dashed border-ink-600 px-3 py-2.5">
          <UpgradePrompt plan={match.requiredPlan} reason={match.lockReason} compact />
        </div>
      )}
      {!match.locked && !p && match.status === "SCHEDULED" && <p className="mt-3 text-xs text-ink-400">{t("match.soon")}</p>}
    </article>
  );
}
