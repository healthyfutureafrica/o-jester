import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PlanCards } from "../components/PlanCards";
import { Alert, usePlanName } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";
import { api } from "../lib/api";
import { shortDate } from "../lib/format";
import type { PlanId } from "../lib/types";

interface League {
  key: string;
  name: string;
  country: string;
  tier: number;
}

type Cell = MessageKey | "—" | "✓" | string;
const ROWS: [MessageKey, Cell, Cell, Cell][] = [
  ["pricing.row.leagues", "pricing.c.leagues1", "pricing.c.leagues2", "pricing.c.leagues3"],
  ["pricing.row.markets", "pricing.c.markets1", "pricing.c.markets2", "pricing.c.markets3"],
  ["pricing.row.combos", "2", "5", "9"],
  ["pricing.row.value", "—", "✓", "✓"],
  ["pricing.row.ai", "—", "pricing.c.ai2", "pricing.c.ai3"],
  ["pricing.row.builder", "—", "pricing.c.builder2", "pricing.c.builder3"],
  ["pricing.row.tomorrow", "—", "—", "pricing.c.tomorrow3"],
  ["pricing.row.history", "pricing.c.history1", "pricing.c.history2", "pricing.c.history3"],
];

export default function Pricing() {
  const [params] = useSearchParams();
  const { session } = useApp();
  const { t } = useI18n();
  const planName = usePlanName();
  const leagues = useQuery({ queryKey: ["leagues"], queryFn: () => api.get<{ leagues: League[] }>("/leagues"), staleTime: Infinity });
  const highlight = params.get("plan") as PlanId | null;
  const sub = session?.subscription;
  const cell = (c: Cell) => (c.includes(".") ? t(c as MessageKey) : c);

  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold">{t("pricing.title")}</h1>
        <p className="mt-3 text-ink-300">{t("pricing.sub")}</p>
      </div>
      {sub && (
        <div className="mx-auto mt-6 max-w-xl">
          <Alert tone="success">{t("pricing.current", { plan: planName(sub.plan), date: shortDate(sub.endsAt), days: sub.daysLeft })}</Alert>
        </div>
      )}
      <div className="mt-12">
        <PlanCards highlight={highlight} />
      </div>
      <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-ink-400">{t("pricing.legal")}</p>

      <section className="mt-16">
        <h2 className="mb-5 text-2xl font-bold">{t("pricing.compare")}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-left">
                <th className="p-4 font-semibold text-ink-300">{t("pricing.feature")}</th>
                <th className="p-4 font-semibold text-pitch-400">{planName("STARTER")} · 1 000 XAF</th>
                <th className="p-4 font-semibold text-gold-400">{planName("PRO")} · 2 000 XAF</th>
                <th className="p-4 font-semibold text-jester-400">{planName("ELITE")} · 5 000 XAF</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, ...cells]) => (
                <tr key={label} className="border-b border-ink-800 last:border-0">
                  <td className="p-4 font-medium">{t(label)}</td>
                  {cells.map((c, i) => (
                    <td key={i} className="p-4 text-ink-300">
                      {cell(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {leagues.data && (
        <section className="mt-16">
          <h2 className="mb-5 text-2xl font-bold">{t("pricing.coverage")}</h2>
          <div className="grid gap-5 md:grid-cols-3">
            {([1, 2, 3] as const).map((tier) => (
              <div key={tier} className="card p-5">
                <h3 className={`font-semibold ${tier === 1 ? "text-pitch-400" : tier === 2 ? "text-gold-400" : "text-jester-400"}`}>{t(`pricing.tier${tier}`)}</h3>
                <ul className="mt-3 space-y-1.5 text-sm text-ink-300">
                  {leagues.data.leagues
                    .filter((l) => l.tier === tier)
                    .map((l) => (
                      <li key={l.key}>
                        {l.name} <span className="text-ink-400">· {l.country}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
