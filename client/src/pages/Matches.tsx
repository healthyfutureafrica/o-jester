import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DateTabs } from "../components/DateTabs";
import { MatchCard } from "../components/MatchCard";
import { Alert, DisclaimerBar, EmptyState, PageLoader, SectionTitle } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { api, errorMessage } from "../lib/api";
import type { MatchListItem } from "../lib/types";

type Sort = "kickoff" | "confidence";

export default function Matches() {
  const { meta } = useApp();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? meta?.today ?? "";
  const [league, setLeague] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("kickoff");
  const [unlockedOnly, setUnlockedOnly] = useState(false);

  const q = useQuery({
    queryKey: ["matches", date],
    queryFn: () => api.get<{ date: string; matches: MatchListItem[] }>(`/matches?date=${date}`),
    enabled: Boolean(date),
    refetchInterval: 60_000,
  });

  const leagues = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of q.data?.matches ?? []) map.set(m.leagueKey, `${m.leagueName} (${m.country})`);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [q.data]);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = (q.data?.matches ?? []).filter(
      (m) =>
        (league === "all" || m.leagueKey === league) &&
        (!unlockedOnly || m.prediction) &&
        (!term || m.homeTeam.toLowerCase().includes(term) || m.awayTeam.toLowerCase().includes(term)),
    );
    if (sort === "confidence") {
      list = [...list].sort((a, b) => (b.prediction?.confidence ?? -1) - (a.prediction?.confidence ?? -1));
      return [{ key: "all", title: t("matches.highest"), tier: 0, matches: list }];
    }
    const byLeague = new Map<string, { key: string; title: string; tier: number; matches: MatchListItem[] }>();
    for (const m of list) {
      const g = byLeague.get(m.leagueKey) ?? { key: m.leagueKey, title: `${m.leagueName} · ${m.country}`, tier: m.leagueTier, matches: [] };
      g.matches.push(m);
      byLeague.set(m.leagueKey, g);
    }
    return [...byLeague.values()].sort((a, b) => a.tier - b.tier || a.title.localeCompare(b.title));
  }, [q.data, league, search, sort, unlockedOnly, t]);

  return (
    <div className="container-page py-8">
      <SectionTitle
        title={t("matches.title")}
        subtitle={q.data ? t("matches.count", { n: q.data.matches.length, l: leagues.length }) : t("matches.sub")}
        action={<DateTabs value={date} onChange={(d) => setParams({ date: d })} />}
      />
      <DisclaimerBar />

      <div className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input className="input" placeholder={t("matches.search")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("matches.search")} />
        <select className="input" value={league} onChange={(e) => setLeague(e.target.value)} aria-label={t("matches.allLeagues")}>
          <option value="all">{t("matches.allLeagues")}</option>
          {leagues.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("matches.sortConfidence")}>
          <option value="kickoff">{t("matches.groupByLeague")}</option>
          <option value="confidence">{t("matches.sortConfidence")}</option>
        </select>
        <label className="flex items-center gap-2.5 px-1 text-sm text-ink-300">
          <input type="checkbox" className="h-4 w-4 accent-pitch-500" checked={unlockedOnly} onChange={(e) => setUnlockedOnly(e.target.checked)} />
          {t("matches.onlyVisible")}
        </label>
      </div>

      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : !groups.length ? (
        <EmptyState title={t("matches.emptyTitle")}>{t("matches.emptyBody")}</EmptyState>
      ) : (
        <div className="space-y-10">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-300">{g.title}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.matches.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
