import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { kickoffTime, odds, pct, slipText } from "../lib/format";
import type { Combo } from "../lib/types";
import { Badge, CopyButton, PlanBadge, ResultBadge, ShareWhatsApp, UpgradePrompt, useSlipLabels } from "./ui";

const ACCENT: Record<string, string> = {
  STARTER: "from-pitch-500/25",
  PRO: "from-gold-500/25",
  ELITE: "from-jester-500/30",
};

export function ComboCard({ combo }: { combo: Combo }) {
  const { t } = useI18n();
  const labels = useSlipLabels();
  const isAcca = combo.kind === "ACCA";
  const text = combo.selections ? slipText(labels, combo.title, combo.selections, isAcca ? combo.totalOdds : undefined) : "";

  return (
    <article className="card relative flex flex-col overflow-hidden">
      <div className={`bg-gradient-to-br ${ACCENT[combo.minPlan]} to-transparent px-5 pb-4 pt-5`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <PlanBadge plan={combo.minPlan} />
              {combo.provisional && !combo.locked && <Badge tone="blue">{t("combo.provisional")}</Badge>}
              {combo.status !== "PENDING" && <ResultBadge result={combo.status} />}
            </div>
            <h3 className="text-lg font-bold">{combo.title}</h3>
            <p className="mt-0.5 text-sm text-ink-300">{combo.description}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs uppercase tracking-wide text-ink-400">{isAcca ? t("combo.totalOdds") : t("combo.avgOdds")}</div>
            <div className="font-display text-3xl font-bold text-gold-400">{odds(combo.totalOdds)}</div>
            <div className="text-xs text-ink-400">
              {isAcca ? t("combo.winChance") : t("combo.avgChance")} {pct(combo.probability, combo.probability < 0.1 ? 1 : 0)}
            </div>
          </div>
        </div>
      </div>

      {combo.locked || !combo.selections ? (
        <div className="relative flex-1 px-5 pb-5">
          <div className="pointer-events-none select-none space-y-2 blur-[6px]" aria-hidden>
            {Array.from({ length: combo.selectionsCount }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-ink-800 px-3 py-3 text-sm">
                <span>████████ – ████████</span>
                <span className="font-semibold">1X @ 1.45</span>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center px-5">
            <div className="rounded-2xl border border-ink-600 bg-ink-900/95 p-4 shadow-xl">
              <UpgradePrompt plan={combo.minPlan} reason={combo.lockReason} />
              <p className="mt-2 text-center text-xs text-ink-400">{t("combo.inside", { n: combo.selectionsCount })}</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <ul className="flex-1 divide-y divide-ink-800 px-5">
            {combo.selections.map((s) => (
              <li key={s.matchId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link to={`/app/matches/${s.matchId}`} className="block truncate text-sm font-semibold hover:text-pitch-400">
                    {s.homeTeam} <span className="text-ink-400">{t("ui.vs")}</span> {s.awayTeam}
                  </Link>
                  <div className="mt-0.5 truncate text-xs text-ink-400">
                    {s.leagueName} · {s.score ? `${t("ui.ft")} ${s.score.home}-${s.score.away}` : kickoffTime(s.kickoff)}
                  </div>
                  <div className="mt-1 text-xs text-ink-300">{s.label}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-2.5 py-1 text-sm font-bold">
                    <span className="text-pitch-400">{s.short}</span>
                    <span className="text-ink-400">@</span>
                    <span>{odds(s.odds)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-ink-400">
                    {s.result !== "PENDING" ? <ResultBadge result={s.result} /> : <span>{pct(s.probability)}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 px-5 py-3">
            <span className="text-xs text-ink-400">
              {combo.oddsEstimated ? t("combo.estimated") : ""}
              {combo.kind === "SINGLES" ? t("combo.singles") : t("combo.acca", { n: combo.selectionsCount })}
              {combo.status === "SETTLED" ? t("combo.wonOf", { won: combo.wonCount, n: combo.selectionsCount }) : ""}
            </span>
            <div className="flex gap-2">
              <ShareWhatsApp text={text} />
              <CopyButton text={text} />
            </div>
          </div>
        </>
      )}
    </article>
  );
}
