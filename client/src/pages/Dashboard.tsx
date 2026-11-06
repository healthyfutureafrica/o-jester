import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ComboCard } from "../components/ComboCard";
import { DateTabs } from "../components/DateTabs";
import { Alert, ButtonLink, DisclaimerBar, EmptyState, PageLoader, SectionTitle, usePlanName } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { api, errorMessage } from "../lib/api";
import { kickoffTime } from "../lib/format";
import type { Combo } from "../lib/types";

interface CombosResponse {
  date: string;
  earlyAccessLocked: boolean;
  lockAt: string;
  combos: Combo[];
}

export default function Dashboard() {
  const { meta, session } = useApp();
  const { t } = useI18n();
  const planName = usePlanName();
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? meta?.today ?? "";
  const q = useQuery({
    queryKey: ["combos", date],
    queryFn: () => api.get<CombosResponse>(`/combos?date=${date}`),
    enabled: Boolean(date),
    refetchInterval: 120_000,
  });
  const sub = session?.subscription;
  const unlocked = q.data?.combos.filter((c) => !c.locked).length ?? 0;

  return (
    <div className="container-page py-8">
      <SectionTitle
        title={t("dash.title")}
        subtitle={q.data && new Date(q.data.lockAt) > new Date() ? t("dash.provisional", { time: kickoffTime(q.data.lockAt) }) : t("dash.sub")}
        action={<DateTabs value={date} onChange={(d) => setParams({ date: d })} />}
      />
      <DisclaimerBar />

      {!session && (
        <div className="mb-6">
          <Alert tone="info">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{t("dash.guest")}</span>
              <ButtonLink to="/register" size="sm">{t("nav.getStarted")}</ButtonLink>
            </div>
          </Alert>
        </div>
      )}
      {sub && sub.daysLeft <= 3 && (
        <div className="mb-6">
          <Alert tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{t("dash.expiring", { plan: planName(sub.plan), days: sub.daysLeft })}</span>
              <ButtonLink to={`/checkout/${sub.plan}`} size="sm" variant="gold">{t("dash.renew")}</ButtonLink>
            </div>
          </Alert>
        </div>
      )}

      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : !q.data?.combos.length ? (
        <EmptyState title={t("dash.emptyTitle")}>{t("dash.emptyBody")}</EmptyState>
      ) : (
        <>
          {session && unlocked === 0 && !q.data.earlyAccessLocked && <p className="mb-4 text-sm text-ink-300">{t("dash.subscribeHint")}</p>}
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {q.data.combos.map((c) => (
              <ComboCard key={c.id} combo={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
