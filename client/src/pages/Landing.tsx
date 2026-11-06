import { useQuery } from "@tanstack/react-query";
import { PlanCards } from "../components/PlanCards";
import { Badge, ButtonLink, ConfidenceMeter, DisclaimerBar } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";
import { api } from "../lib/api";
import { kickoffTime, odds, pct } from "../lib/format";

interface Teaser {
  date: string;
  fixturesToday: number;
  pick: {
    matchId: string;
    leagueName: string;
    kickoff: string;
    homeTeam: string;
    awayTeam: string;
    short: string;
    label: string;
    probability: number;
    odds: number | null;
    confidence: number;
  } | null;
}

interface Stat {
  settled: number;
  won: number;
  winRate: number | null;
}

interface ResultsSummary {
  summary: { combos: Stat; selections: Stat; bestPicks: Stat };
}

const STEPS = [1, 2, 3] as const;
const FEATURES: [string, MessageKey, MessageKey][] = [
  ["📊", "landing.f1.title", "landing.f1.text"],
  ["🧠", "landing.f2.title", "landing.f2.text"],
  ["💎", "landing.f3.title", "landing.f3.text"],
  ["🌍", "landing.f4.title", "landing.f4.text"],
  ["🧾", "landing.f5.title", "landing.f5.text"],
  ["✅", "landing.f6.title", "landing.f6.text"],
];
const FAQ = [1, 2, 3, 4, 5] as const;

export default function Landing() {
  const { session } = useApp();
  const { t } = useI18n();
  const teaser = useQuery({ queryKey: ["teaser"], queryFn: () => api.get<Teaser>("/teaser") });
  const results = useQuery({ queryKey: ["results", 30], queryFn: () => api.get<ResultsSummary>("/results?days=30") });
  const pick = teaser.data?.pick;
  const s = results.data?.summary;

  return (
    <div>
      <section className="container-page grid items-center gap-10 pb-10 pt-14 lg:grid-cols-[1.15fr_1fr] lg:pt-20">
        <div>
          <Badge tone="purple" className="mb-5">{t("landing.badge")}</Badge>
          <h1 className="text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            {t("landing.title1")}
            <br />
            <span className="bg-gradient-to-r from-pitch-400 via-gold-400 to-jester-400 bg-clip-text text-transparent">{t("landing.title2")}</span>
            <br />
            {t("landing.title3")}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-300">{t("landing.lead")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink to={session ? "/app" : "/register"} size="lg">
              {session ? t("landing.ctaApp") : t("landing.ctaStart")}
            </ButtonLink>
            <ButtonLink to="/pricing" variant="outline" size="lg">
              {t("landing.ctaPlans")}
            </ButtonLink>
          </div>
          <div className="mt-8 flex flex-wrap gap-6 text-sm text-ink-300">
            <div>
              <div className="font-display text-2xl font-bold text-ink-100">{teaser.data?.fixturesToday ?? "—"}</div>
              {t("landing.statFixtures")}
            </div>
            <div>
              <div className="font-display text-2xl font-bold text-ink-100">37</div>
              {t("landing.statLeagues")}
            </div>
            <div>
              <div className="font-display text-2xl font-bold text-ink-100">{s?.selections.winRate != null ? `${s.selections.winRate}%` : "—"}</div>
              {t("landing.statLegs")}
            </div>
          </div>
        </div>

        <div className="card relative overflow-hidden p-6">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-pitch-500/20 blur-3xl" aria-hidden />
          <div className="relative">
            <Badge tone="green">{t("landing.freePick")}</Badge>
            {pick ? (
              <>
                <div className="mt-5 text-xs uppercase tracking-wide text-ink-400">
                  {pick.leagueName} · {kickoffTime(pick.kickoff)}
                </div>
                <div className="mt-2 text-2xl font-bold">
                  {pick.homeTeam} <span className="text-ink-400">{t("ui.vs")}</span> {pick.awayTeam}
                </div>
                <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-ink-800 p-4">
                  <div>
                    <div className="text-xs text-ink-400">{t("landing.ourPick")}</div>
                    <div className="text-lg font-bold">
                      <span className="text-pitch-400">{pick.short}</span> · {pick.label}
                    </div>
                    <div className="mt-1 text-sm text-ink-300">
                      {t("match.chance", { p: pct(pick.probability) })}
                      {pick.odds ? t("landing.oddsSuffix", { o: odds(pick.odds) }) : ""}
                    </div>
                  </div>
                  <ConfidenceMeter value={pick.confidence} />
                </div>
                <p className="mt-4 text-sm text-ink-300">{t("landing.freePickMore")}</p>
                <p className="mt-3 text-xs text-ink-400">{t("ai.mistakes")}</p>
              </>
            ) : (
              <p className="mt-6 text-ink-300">{teaser.isLoading ? t("ui.loading") : t("landing.freePickEmpty")}</p>
            )}
          </div>
        </div>
      </section>

      <div className="container-page">
        <DisclaimerBar />
      </div>

      <section className="container-page py-14">
        <h2 className="text-center text-3xl font-bold">{t("landing.howTitle")}</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((n) => (
            <div key={n} className="card p-6">
              <div className="font-display text-3xl font-bold text-gold-500/80">0{n}</div>
              <h3 className="mt-3 text-lg font-semibold">{t(`landing.step${n}.title`)}</h3>
              <p className="mt-2 text-sm text-ink-300">{t(`landing.step${n}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container-page py-14">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([icon, title, text]) => (
            <div key={title} className="rounded-2xl border border-ink-800 p-6">
              <div className="text-2xl" aria-hidden>
                {icon}
              </div>
              <h3 className="mt-3 font-semibold">{t(title)}</h3>
              <p className="mt-1.5 text-sm text-ink-300">{t(text)}</p>
            </div>
          ))}
        </div>
      </section>

      {s && s.combos.settled > 0 && (
        <section className="container-page py-14">
          <div className="card grid gap-6 p-8 md:grid-cols-4 md:items-center">
            <div>
              <h2 className="text-2xl font-bold">{t("landing.recordTitle")}</h2>
              <p className="mt-2 text-sm text-ink-300">{t("landing.recordSub")}</p>
            </div>
            {(
              [
                ["landing.recordCombos", s.combos],
                ["landing.recordLegs", s.selections],
                ["landing.recordBest", s.bestPicks],
              ] as [MessageKey, Stat][]
            ).map(([label, stat]) => (
              <div key={label} className="rounded-2xl bg-ink-800 p-5 text-center">
                <div className="font-display text-3xl font-bold text-pitch-400">{stat.winRate != null ? `${stat.winRate}%` : "—"}</div>
                <div className="mt-1 text-sm text-ink-300">{t(label)}</div>
                <div className="text-xs text-ink-400">
                  {stat.won}/{stat.settled}
                </div>
              </div>
            ))}
            <p className="text-xs text-ink-400 md:col-span-4">{t("results.past")}</p>
          </div>
        </section>
      )}

      <section className="container-page py-14" id="pricing">
        <h2 className="text-center text-3xl font-bold">{t("landing.pricingTitle")}</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-ink-300">{t("landing.pricingSub")}</p>
        <div className="mt-10">
          <PlanCards />
        </div>
      </section>

      <section className="container-page py-14">
        <h2 className="text-center text-3xl font-bold">{t("landing.faqTitle")}</h2>
        <div className="mx-auto mt-8 max-w-3xl space-y-3">
          {FAQ.map((n) => (
            <details key={n} className="card group p-5" open={n === 1}>
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="mr-2 text-pitch-400 group-open:hidden">+</span>
                <span className="mr-2 hidden text-pitch-400 group-open:inline">−</span>
                {t(`landing.faq${n}.q`)}
              </summary>
              <p className="mt-3 text-sm text-ink-300">{t(`landing.faq${n}.a`)}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
