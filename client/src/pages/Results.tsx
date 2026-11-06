import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ComboCard } from "../components/ComboCard";
import { Alert, DisclaimerBar, EmptyState, PageLoader, PlanBadge, SectionTitle } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";
import { api, errorMessage } from "../lib/api";
import type { Combo, PlanId } from "../lib/types";

interface Stat {
  settled: number;
  won: number;
  winRate: number | null;
}

interface ResultsResponse {
  days: number;
  summary: { combos: Stat; selections: Stat; bestPicks: Stat; avgWinningOdds: number | null };
  byType: (Stat & { type: string; title: string; minPlan: PlanId; kind: string })[];
  recent: Combo[];
  historyDays: number;
}

const WINDOWS = [7, 30, 90];

export default function Results() {
  const { session } = useApp();
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["results", days], queryFn: () => api.get<ResultsResponse>(`/results?days=${days}`) });
  const s = q.data?.summary;

  return (
    <div className="container-page py-8">
      <SectionTitle
        title={t("results.title")}
        subtitle={t("results.sub")}
        action={
          <div className="inline-flex rounded-xl border border-ink-700 bg-ink-900 p-1">
            {WINDOWS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${days === d ? "bg-ink-700" : "text-ink-400 hover:text-ink-100"}`}>
                {t("results.days", { n: d })}
              </button>
            ))}
          </div>
        }
      />
      <DisclaimerBar />

      {q.isLoading ? (
        <PageLoader />
      ) : q.isError || !q.data || !s ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["results.combos", s.combos],
                ["results.legs", s.selections],
                ["results.best", s.bestPicks],
              ] as [MessageKey, Stat][]
            ).map(([label, st]) => (
              <div key={label} className="card p-5">
                <div className="text-sm text-ink-300">{t(label)}</div>
                <div className="mt-1 font-display text-3xl font-bold text-pitch-400">{st.winRate != null ? `${st.winRate}%` : "—"}</div>
                <div className="text-xs text-ink-400">{t("results.of", { won: st.won, n: st.settled })}</div>
              </div>
            ))}
            <div className="card p-5">
              <div className="text-sm text-ink-300">{t("results.avgOdds")}</div>
              <div className="mt-1 font-display text-3xl font-bold text-gold-400">{s.avgWinningOdds ?? "—"}</div>
              <div className="text-xs text-ink-400">{t("results.last", { n: days })}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-400">{t("results.past")}</p>

          <section className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">{t("results.byType")}</h2>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-left text-ink-300">
                    <th className="p-4 font-semibold">{t("results.col.combo")}</th>
                    <th className="p-4 font-semibold">{t("results.col.plan")}</th>
                    <th className="p-4 font-semibold">{t("results.col.won")}</th>
                    <th className="p-4 font-semibold">{t("results.col.rate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.byType.map((row) => (
                    <tr key={row.type} className="border-b border-ink-800 last:border-0">
                      <td className="p-4 font-medium">
                        {row.title}
                        {row.kind === "SINGLES" && <span className="ml-2 text-xs text-ink-400">{t("results.perPick")}</span>}
                      </td>
                      <td className="p-4">
                        <PlanBadge plan={row.minPlan} />
                      </td>
                      <td className="p-4 text-ink-300">
                        {row.won} / {row.settled}
                      </td>
                      <td className="p-4">
                        {row.winRate != null ? (
                          <div className="flex items-center gap-3">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-700">
                              <div className="h-full bg-pitch-500" style={{ width: `${row.winRate}%` }} />
                            </div>
                            <span className="font-semibold">{row.winRate}%</span>
                          </div>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-10">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{t("results.recent")}</h2>
              {session?.limits.csvExport && (
                <a href="/api/results/export.csv" className="text-sm font-semibold text-pitch-400 hover:underline">
                  {t("results.export")}
                </a>
              )}
            </div>
            <p className="mb-4 text-xs text-ink-400">{t("results.window", { n: Math.min(q.data.historyDays, days) })}</p>
            {q.data.recent.length ? (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {q.data.recent.map((c) => (
                  <ComboCard key={c.id} combo={c} />
                ))}
              </div>
            ) : (
              <EmptyState title={t("results.empty")} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
