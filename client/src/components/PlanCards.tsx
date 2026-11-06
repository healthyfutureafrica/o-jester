import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { formatXaf } from "../lib/format";
import type { PlanId } from "../lib/types";
import { ButtonLink } from "./ui";

const RANK: Record<PlanId, number> = { STARTER: 1, PRO: 2, ELITE: 3 };
const STYLE: Record<PlanId, { ring: string; accent: string; button: "primary" | "gold" | "outline" }> = {
  STARTER: { ring: "border-ink-700", accent: "text-pitch-400", button: "outline" },
  PRO: { ring: "border-gold-500/60 shadow-2xl shadow-gold-500/10", accent: "text-gold-400", button: "gold" },
  ELITE: { ring: "border-jester-500/60 shadow-2xl shadow-jester-500/10", accent: "text-jester-400", button: "primary" },
};

export function PlanCards({ highlight }: { highlight?: PlanId | null }) {
  const { plans, plan: current, session } = useApp();
  const { t } = useI18n();

  return (
    <div className="grid gap-5 md:grid-cols-3">
      {plans.map((p) => {
        const s = STYLE[p.id];
        const isCurrent = current === p.id;
        const isUpgrade = current && RANK[p.id] > RANK[current];
        const cta = isCurrent
          ? t("plans.renew")
          : isUpgrade
            ? t("plans.upgrade", { plan: p.name })
            : current
              ? t("plans.switch", { plan: p.name })
              : t("plans.get", { plan: p.name });
        const to = session ? `/checkout/${p.id}` : `/register?plan=${p.id}`;
        return (
          <div key={p.id} className={`card relative flex flex-col p-6 ${s.ring} ${highlight === p.id ? "ring-2 ring-pitch-500" : ""}`}>
            {p.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold-500 px-3 py-1 text-xs font-bold text-ink-950">
                {t("plans.popular")}
              </span>
            )}
            <div className="flex items-center justify-between">
              <h3 className={`text-xl font-bold ${s.accent}`}>{p.name}</h3>
              {isCurrent && <span className="rounded-full bg-pitch-500/15 px-2 py-0.5 text-xs font-semibold text-pitch-400">{t("plans.current")}</span>}
            </div>
            <p className="mt-1 text-sm text-ink-300">{p.tagline}</p>
            <div className="my-5">
              <span className="font-display text-4xl font-bold">{formatXaf(p.priceXaf)}</span>
              <span className="text-sm text-ink-400">{t("plans.perMonth")}</span>
            </div>
            <ul className="mb-6 flex-1 space-y-2.5 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <span className={`mt-0.5 ${s.accent}`} aria-hidden>
                    ✓
                  </span>
                  <span className="text-ink-100/90">{f}</span>
                </li>
              ))}
            </ul>
            <ButtonLink to={to} variant={s.button} size="lg" className="w-full">
              {cta}
            </ButtonLink>
          </div>
        );
      })}
    </div>
  );
}
