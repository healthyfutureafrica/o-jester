import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { MatchStatusLabel } from "../components/MatchCard";
import { AiNotice, Alert, Badge, ConfidenceMeter, DisclaimerBar, PageLoader, ProbabilityBar, ResultBadge, StanceBadge, UpgradePrompt } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useSlip } from "../context/SlipContext";
import { useI18n } from "../i18n";
import { api, errorMessage } from "../lib/api";
import { longDateTime, odds, pct } from "../lib/format";
import type { MarketView, MatchDetail as Detail, TeamForm } from "../lib/types";

function FormDots({ form }: { form?: string }) {
  if (!form) return <span className="text-ink-400">—</span>;
  return (
    <span className="inline-flex gap-1">
      {[...form.slice(-5)].map((r, i) => (
        <span
          key={i}
          className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
            r === "W" ? "bg-pitch-500/20 text-pitch-400" : r === "D" ? "bg-ink-600 text-ink-300" : "bg-loss-500/20 text-loss-400"
          }`}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

function StatsTable({ home, away, homeName, awayName }: { home: TeamForm | null; away: TeamForm | null; homeName: string; awayName: string }) {
  const { t } = useI18n();
  const row = (label: string, h: React.ReactNode, a: React.ReactNode) => (
    <tr className="border-b border-ink-800 last:border-0">
      <td className="py-2.5 text-right font-semibold">{h}</td>
      <td className="px-4 py-2.5 text-center text-xs uppercase tracking-wide text-ink-400">{label}</td>
      <td className="py-2.5 font-semibold">{a}</td>
    </tr>
  );
  const per = (g?: number, n?: number) => (g !== undefined && n ? (g / n).toFixed(2) : "—");
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-ink-300">
          <th className="pb-2 text-right font-semibold">{homeName}</th>
          <th />
          <th className="pb-2 text-left font-semibold">{awayName}</th>
        </tr>
      </thead>
      <tbody>
        {row(t("detail.stat.position"), home?.position ?? "—", away?.position ?? "—")}
        {row(t("detail.stat.form"), <FormDots form={home?.form} />, <FormDots form={away?.form} />)}
        {row(t("detail.stat.gf"), per(home?.gf, home?.played), per(away?.gf, away?.played))}
        {row(t("detail.stat.ga"), per(home?.ga, home?.played), per(away?.ga, away?.played))}
        {row(t("detail.stat.split"), per(home?.homeGf, home?.homePlayed), per(away?.awayGf, away?.awayPlayed))}
      </tbody>
    </table>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-ink-300">
        {items.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}

export default function MatchDetail() {
  const { id } = useParams();
  const { session } = useApp();
  const { t } = useI18n();
  const slip = useSlip();
  const q = useQuery({ queryKey: ["match", id], queryFn: () => api.get<{ match: Detail }>(`/matches/${id}`) });

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data)
    return (
      <div className="container-page py-10">
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      </div>
    );

  const m = q.data.match;
  const p = m.prediction;
  const canBuild = (session?.limits.builderMaxPicks ?? 0) > 0;
  const open = m.status === "SCHEDULED" && new Date(m.kickoff) > new Date();
  const groups = p
    ? (["RESULT", "GOALS", "SCORE"] as const).map((g) => [g, p.markets.filter((x) => x.group === g)] as const).filter(([, list]) => list.length)
    : [];

  const addToSlip = (x: MarketView) =>
    slip.toggle({
      matchId: m.id,
      market: x.key,
      short: x.short,
      label: x.label,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      kickoff: m.kickoff,
      odds: x.bookOdds ?? x.fairOdds,
      probability: x.probability,
    });

  return (
    <div className="container-page py-8">
      <Link to={`/app/matches?date=${m.matchDate}`} className="text-sm text-ink-400 hover:text-ink-100">
        {t("detail.all")}
      </Link>

      <header className="card mt-4 p-6 sm:p-8">
        <div className="text-center text-xs uppercase tracking-wide text-ink-400">
          {m.leagueName} · {m.country} · {longDateTime(m.kickoff)}
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="text-right text-xl font-bold sm:text-3xl">{m.homeTeam}</div>
          <div className="flex flex-col items-center">
            {m.homeGoals !== null ? (
              <span className="font-display text-3xl font-bold sm:text-4xl">
                {m.homeGoals} - {m.awayGoals}
              </span>
            ) : (
              <span className="font-display text-xl text-ink-400">{t("ui.vs")}</span>
            )}
            <div className="mt-1">
              <MatchStatusLabel m={m} />
            </div>
          </div>
          <div className="text-xl font-bold sm:text-3xl">{m.awayTeam}</div>
        </div>
        {p && (
          <div className="mx-auto mt-6 max-w-md">
            <ProbabilityBar {...p.probs} />
          </div>
        )}
      </header>

      <div className="mt-6">
        <DisclaimerBar />
      </div>

      {m.locked && m.requiredPlan ? (
        <div className="card p-8">
          <UpgradePrompt plan={m.requiredPlan} reason={m.lockReason} />
        </div>
      ) : !p ? (
        <Alert>{t("detail.soon")}</Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <section className="card p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink-400">{t("detail.bestPick")}</div>
                  {p.bestPick ? (
                    <>
                      <div className="mt-1 text-2xl font-bold">
                        <span className="text-pitch-400">{p.bestPick.short}</span> · {p.bestPick.label}
                      </div>
                      <div className="mt-1 text-sm text-ink-300">
                        {t("detail.chance", { p: pct(p.bestPick.probability), f: odds(p.bestPick.fairOdds) })}
                        {p.bestPick.bookOdds ? t("detail.book", { o: odds(p.bestPick.bookOdds) }) : ""}
                      </div>
                    </>
                  ) : (
                    <div className="mt-1 text-ink-300">{t("detail.noPick")}</div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.aiStance && <StanceBadge stance={p.aiStance} />}
                    <Badge tone={p.dataQuality === "HIGH" ? "green" : p.dataQuality === "MEDIUM" ? "gold" : "red"}>
                      {t("detail.data", { q: t(`detail.quality.${p.dataQuality}`) })}
                    </Badge>
                    <Badge>
                      xG {p.xg.home.toFixed(2)} – {p.xg.away.toFixed(2)}
                    </Badge>
                    {p.bestPick?.result && <ResultBadge result={p.bestPick.result} />}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <ConfidenceMeter value={p.confidence} size={68} />
                  <span className="text-xs text-ink-400">{t("ui.confidence")}</span>
                </div>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-ink-300">{p.summary}</p>
            </section>

            {groups.map(([g, list]) => (
              <section key={g} className="card p-6">
                <h2 className="mb-4 text-lg font-semibold">{t(`detail.group.${g}`)}</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {list.map((x) => {
                    const inSlip = slip.has(m.id, x.key);
                    return (
                      <div key={x.key} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${inSlip ? "border-gold-500 bg-gold-500/10" : "border-ink-700 bg-ink-850"}`}>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{x.label}</div>
                          <div className="text-xs text-ink-400">
                            {pct(x.probability, 1)} · {t("detail.fair", { f: odds(x.fairOdds) })}
                            {x.bookOdds ? t("detail.bookShort", { o: odds(x.bookOdds) }) : ""}
                            {x.edge !== undefined && x.edge > 0 && <span className="text-gold-400">{t("detail.value", { p: pct(x.edge, 1) })}</span>}
                          </div>
                        </div>
                        {x.result ? (
                          <ResultBadge result={x.result} />
                        ) : (
                          canBuild &&
                          open && (
                            <button
                              onClick={() => addToSlip(x)}
                              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition ${inSlip ? "bg-gold-500 text-ink-950" : "bg-ink-700 text-ink-100 hover:bg-ink-600"}`}
                              aria-pressed={inSlip}
                            >
                              {inSlip ? t("detail.inSlip") : t("detail.addSlip")}
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {!canBuild && session && open && (
              <div className="card p-5">
                <UpgradePrompt plan="PRO" compact />
                <p className="mt-2 text-xs text-ink-400">{t("detail.upgradeHint")}</p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <section className="card p-6">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-jester-400">✦</span>
                <h2 className="text-lg font-semibold">{t("detail.aiTitle")}</h2>
              </div>
              {p.ai ? (
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="font-semibold">{p.ai.headline}</div>
                    <p className="mt-1.5 leading-relaxed text-ink-300">{p.ai.summary}</p>
                  </div>
                  <div className="rounded-xl bg-ink-800 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StanceBadge stance={p.ai.verdict.stance} />
                      <span className="font-semibold">{p.ai.verdict.label}</span>
                    </div>
                    <p className="mt-2 text-ink-300">{p.ai.verdict.reasoning}</p>
                  </div>
                  <List title={t("detail.keyFactors")} items={p.ai.keyFactors} />
                  <List title={t("detail.teamNews")} items={p.ai.teamNews} />
                  <List title={t("detail.risks")} items={p.ai.risks} />
                  {p.ai.sources && p.ai.sources.length > 0 && (
                    <div className="text-xs text-ink-400">
                      {t("detail.sources")}{" "}
                      {p.ai.sources.map((s, i) => (
                        <span key={s.url}>
                          {i > 0 && " · "}
                          <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-ink-100 hover:underline">
                            {new URL(s.url).hostname.replace(/^www\./, "")}
                          </a>
                        </span>
                      ))}
                    </div>
                  )}
                  <AiNotice />
                  {p.aiLocked === "ELITE" && (
                    <div className="border-t border-ink-800 pt-4">
                      <UpgradePrompt plan="ELITE" compact />
                      <p className="mt-1 text-xs text-ink-400">{t("detail.eliteHint")}</p>
                    </div>
                  )}
                </div>
              ) : p.aiLocked ? (
                <UpgradePrompt plan={p.aiLocked} />
              ) : (
                <p className="text-sm text-ink-300">{t("detail.aiPending")}</p>
              )}
            </section>

            {p.topScores && (
              <section className="card p-6">
                <h2 className="mb-4 text-lg font-semibold">{t("detail.scores")}</h2>
                <div className="grid grid-cols-3 gap-2">
                  {p.topScores.map((s) => (
                    <div key={`${s.home}-${s.away}`} className="rounded-xl bg-ink-800 py-3 text-center">
                      <div className="font-display text-xl font-bold">
                        {s.home}-{s.away}
                      </div>
                      <div className="text-xs text-ink-400">{pct(s.probability, 1)}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {m.stats && (m.stats.home || m.stats.away) && (
              <section className="card p-6">
                <h2 className="mb-4 text-lg font-semibold">{t("detail.form")}</h2>
                <StatsTable home={m.stats.home} away={m.stats.away} homeName={m.homeTeam} awayName={m.awayTeam} />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
