import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AiNotice,
  Alert,
  Badge,
  Button,
  ButtonLink,
  CopyButton,
  DisclaimerBar,
  EmptyState,
  SectionTitle,
  ShareWhatsApp,
  UpgradePrompt,
  useSlipLabels,
} from "../components/ui";
import { useApp } from "../context/AppContext";
import { useSlip } from "../context/SlipContext";
import { useI18n } from "../i18n";
import { api, errorMessage } from "../lib/api";
import { kickoffTime, odds, pct, slipText } from "../lib/format";
import type { SlipEvaluation, SlipReview } from "../lib/types";

const RISK_TONE: Record<SlipReview["overallRisk"], "green" | "gold" | "red"> = { LOW: "green", MEDIUM: "gold", HIGH: "red", VERY_HIGH: "red" };

export default function Builder() {
  const { session, meta } = useApp();
  const { t, lang } = useI18n();
  const labels = useSlipLabels();
  const slip = useSlip();
  const limits = session?.limits;
  const maxPicks = limits?.builderMaxPicks ?? 0;
  const selections = slip.items.map((i) => ({ matchId: i.matchId, market: i.market }));
  const key = selections.map((s) => `${s.matchId}:${s.market}`).join(",");
  const [review, setReview] = useState<(SlipReview & { reviewsLeft: number }) | null>(null);

  const evaluation = useQuery({
    queryKey: ["slip", key, lang],
    queryFn: () => api.post<SlipEvaluation>("/slips/evaluate", { selections }),
    enabled: maxPicks > 0 && selections.length > 0 && selections.length <= maxPicks,
    retry: false,
  });

  const reviewMutation = useMutation({
    mutationFn: () => api.post<SlipEvaluation & { review: SlipReview; reviewsLeft: number }>("/slips/review", { selections }),
    onSuccess: (data) => setReview({ ...data.review, reviewsLeft: data.reviewsLeft }),
  });

  if (!session || maxPicks === 0) {
    return (
      <div className="container-page py-8">
        <SectionTitle title={t("builder.title")} subtitle={t("builder.lockedSub")} />
        <div className="card p-10">
          <UpgradePrompt plan="PRO" reason={session ? "UPGRADE" : "SUBSCRIBE"} />
          <p className="mt-4 text-center text-sm text-ink-400">{t("builder.lockedNote")}</p>
        </div>
      </div>
    );
  }

  const ev = evaluation.data;
  const text = ev ? slipText(labels, t("builder.copyTitle"), ev.selections, ev.totalOdds) : "";
  const isElite = (limits?.slipReviewsPerDay ?? 0) > 0;
  const weak = new Map(review?.weakLinks.map((w) => [w.matchId, w.reason]));

  return (
    <div className="container-page py-8">
      <SectionTitle
        title={t("builder.title")}
        subtitle={t("builder.sub", { limit: maxPicks >= 30 ? t("builder.unlimited") : t("builder.limit", { n: maxPicks }) })}
        action={
          slip.items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                slip.clear();
                setReview(null);
              }}
            >
              {t("builder.clear")}
            </Button>
          )
        }
      />
      <DisclaimerBar />

      {slip.items.length === 0 ? (
        <EmptyState title={t("builder.emptyTitle")}>
          {t("builder.empty1")}{" "}
          <Link to="/app/matches" className="text-pitch-400 hover:underline">
            {t("builder.emptyLink")}
          </Link>{" "}
          {t("builder.empty2")}
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="card h-fit divide-y divide-ink-800">
            {slip.items.map((i) => {
              const leg = ev?.selections.find((s) => s.matchId === i.matchId);
              return (
                <div key={i.matchId} className={`flex items-center justify-between gap-3 p-4 ${weak.has(i.matchId) ? "bg-loss-500/5" : ""}`}>
                  <div className="min-w-0">
                    <Link to={`/app/matches/${i.matchId}`} className="block truncate font-semibold hover:text-pitch-400">
                      {i.homeTeam} {t("ui.vs")} {i.awayTeam}
                    </Link>
                    <div className="text-xs text-ink-400">
                      {leg?.leagueName ? `${leg.leagueName} · ` : ""}
                      {kickoffTime(i.kickoff)}
                    </div>
                    <div className="mt-1 text-sm text-ink-300">{leg?.label ?? i.label}</div>
                    {weak.has(i.matchId) && <div className="mt-1 text-xs text-loss-400">⚠ {weak.get(i.matchId)}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <div className="font-bold">
                        <span className="text-pitch-400">{leg?.short ?? i.short}</span> @ {odds(leg?.odds ?? i.odds)}
                      </div>
                      <div className="text-xs text-ink-400">{pct(leg?.probability ?? i.probability)}</div>
                    </div>
                    <button onClick={() => slip.remove(i.matchId)} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-loss-400" aria-label={t("builder.remove")}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="space-y-4">
            <div className="card p-6">
              {selections.length > maxPicks ? (
                <Alert tone="warning">{t("builder.overLimit", { n: maxPicks, extra: selections.length - maxPicks })}</Alert>
              ) : evaluation.isError ? (
                <Alert tone="error">{errorMessage(evaluation.error)}</Alert>
              ) : (
                <>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-ink-400">{t("builder.total")}</div>
                      <div className="font-display text-4xl font-bold text-gold-400">{ev ? odds(ev.totalOdds) : "…"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-ink-400">{t("builder.chance")}</div>
                      <div className="font-display text-2xl font-bold">{ev ? pct(ev.probability, ev.probability < 0.1 ? 1 : 0) : "…"}</div>
                    </div>
                  </div>
                  {ev?.oddsEstimated && <p className="mt-2 text-xs text-ink-400">{t("builder.estimated")}</p>}
                  {ev?.warnings.map((w) => (
                    <div key={w} className="mt-3">
                      <Alert tone="warning">{w}</Alert>
                    </div>
                  ))}
                  <div className="mt-5 flex flex-wrap gap-2">
                    <CopyButton text={text} />
                    <ShareWhatsApp text={text} />
                  </div>
                </>
              )}
            </div>

            <div className="card space-y-3 p-6">
              <div className="flex items-center gap-2">
                <span className="text-jester-400">✦</span>
                <h2 className="font-semibold">{t("builder.aiTitle")}</h2>
              </div>
              {!isElite ? (
                <UpgradePrompt plan="ELITE" compact />
              ) : !meta?.aiEnabled ? (
                <p className="text-sm text-ink-400">{t("builder.aiDisabled")}</p>
              ) : (
                <>
                  <p className="text-sm text-ink-300">{t("builder.aiIntro")}</p>
                  <Button className="w-full" variant="gold" loading={reviewMutation.isPending} disabled={!ev} onClick={() => reviewMutation.mutate()}>
                    {t("builder.review")}
                  </Button>
                  {reviewMutation.isError && <Alert tone="error">{errorMessage(reviewMutation.error)}</Alert>}
                  {review && (
                    <div className="space-y-3 text-sm">
                      <Badge tone={RISK_TONE[review.overallRisk]}>{t(`risk.${review.overallRisk}`)}</Badge>
                      <p className="text-ink-300">{review.verdict}</p>
                      {review.suggestions.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 text-ink-300">
                          {review.suggestions.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-ink-400">{t("builder.reviewsLeft", { n: review.reviewsLeft })}</p>
                    </div>
                  )}
                  <AiNotice />
                </>
              )}
            </div>
            <ButtonLink to="/app/matches" variant="outline" className="w-full">
              {t("builder.addMore")}
            </ButtonLink>
          </aside>
        </div>
      )}
    </div>
  );
}
