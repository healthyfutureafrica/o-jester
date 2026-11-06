import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Badge, Button, PageLoader, PlanBadge, SectionTitle, usePlanName } from "../components/ui";
import { useI18n } from "../i18n";
import { api, errorMessage } from "../lib/api";
import { dateTime, formatXaf, shortDate } from "../lib/format";
import type { PaymentView, PlanId, User } from "../lib/types";

interface Overview {
  users: number;
  newUsers30d: number;
  subscribers: Record<PlanId, number>;
  revenue30d: { totalXaf: number; byPlan: { plan: PlanId; amountXaf: number; count: number }[] };
  recentPayments: (PaymentView & { email: string })[];
  jobs: { name: string; startedAt: string; finishedAt: string | null; ok: boolean | null; detail: string | null }[];
  today: { matches: number; combos: number };
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-ink-300">{label}</div>
      <div className="mt-1 font-display text-3xl font-bold">{value}</div>
      {sub && <div className="text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

function GrantForm({ user }: { user: User & { plan: PlanId | null } }) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const planName = usePlanName();
  const [plan, setPlan] = useState<PlanId>("PRO");
  const [days, setDays] = useState(30);
  const grant = useMutation({
    mutationFn: () => api.post<{ endsAt: string }>(`/admin/users/${user.id}/grant`, { plan, days }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto py-1.5 text-sm" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} aria-label={t("admin.col.plan")}>
        {(["STARTER", "PRO", "ELITE"] as const).map((p) => (
          <option key={p} value={p}>
            {planName(p)}
          </option>
        ))}
      </select>
      <input type="number" min={1} max={365} className="input w-20 py-1.5 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="days" />
      <Button size="sm" variant="outline" loading={grant.isPending} onClick={() => grant.mutate()}>
        {t("admin.grant")}
      </Button>
      {grant.isSuccess && <span className="text-xs text-pitch-400">{t("admin.until", { date: shortDate(grant.data.endsAt) })}</span>}
      {grant.isError && <span className="text-xs text-loss-400">{errorMessage(grant.error)}</span>}
    </div>
  );
}

export default function Admin() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const planName = usePlanName();
  const [search, setSearch] = useState("");
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: () => api.get<Overview>("/admin/overview"), refetchInterval: 30_000 });
  const users = useQuery({
    queryKey: ["admin-users", search],
    queryFn: () => api.get<{ users: (User & { plan: PlanId | null })[] }>(`/admin/users?q=${encodeURIComponent(search)}`),
  });
  const refresh = useMutation({
    mutationFn: (force: boolean) => api.post("/admin/refresh", { force }),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-overview"] }), 4000),
  });

  if (overview.isLoading) return <PageLoader />;
  if (overview.isError || !overview.data)
    return (
      <div className="container-page py-10">
        <Alert tone="error">{errorMessage(overview.error)}</Alert>
      </div>
    );
  const o = overview.data;
  const totalSubs = o.subscribers.STARTER + o.subscribers.PRO + o.subscribers.ELITE;

  return (
    <div className="container-page py-8">
      <SectionTitle
        title={t("admin.title")}
        subtitle={t("admin.sub")}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" loading={refresh.isPending && refresh.variables === false} onClick={() => refresh.mutate(false)}>
              {t("admin.refresh")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => confirm(t("admin.forceConfirm")) && refresh.mutate(true)}>
              {t("admin.force")}
            </Button>
          </div>
        }
      />
      {refresh.isSuccess && (
        <div className="mb-4">
          <Alert tone="success">{t("admin.started")}</Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("admin.revenue")}
          value={formatXaf(o.revenue30d.totalXaf)}
          sub={o.revenue30d.byPlan.map((r) => `${planName(r.plan)}: ${r.count}`).join(" · ") || t("admin.noSales")}
        />
        <Stat
          label={t("admin.subscribers")}
          value={totalSubs}
          sub={`${planName("STARTER")} ${o.subscribers.STARTER} · ${planName("PRO")} ${o.subscribers.PRO} · ${planName("ELITE")} ${o.subscribers.ELITE}`}
        />
        <Stat label={t("admin.users")} value={o.users} sub={t("admin.new30", { n: o.newUsers30d })} />
        <Stat label={t("admin.today")} value={t("admin.todayMatches", { n: o.today.matches })} sub={t("admin.todayCombos", { n: o.today.combos })} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="text-lg font-semibold">{t("admin.recentPayments")}</h2>
          <div className="mt-3 divide-y divide-ink-800 text-sm">
            {o.recentPayments.map((p) => (
              <div key={p.reference} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate">{p.email}</div>
                  <div className="text-xs text-ink-400">
                    {planName(p.plan)} · {t(`checkout.m.${p.method}`)} · {shortDate(p.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div>{formatXaf(p.amountXaf)}</div>
                  <Badge tone={p.status === "SUCCEEDED" ? "green" : p.status === "PENDING" ? "blue" : "red"}>{t(`pay.status.${p.status}`)}</Badge>
                </div>
              </div>
            ))}
            {!o.recentPayments.length && <p className="py-3 text-ink-400">{t("admin.noPayments")}</p>}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold">{t("admin.runs")}</h2>
          <div className="mt-3 divide-y divide-ink-800 text-sm">
            {o.jobs.map((j, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium">{j.name}</div>
                  <div className="text-xs text-ink-400">{dateTime(j.startedAt)}</div>
                  {j.ok === false && j.detail && <div className="truncate text-xs text-loss-400">{j.detail}</div>}
                </div>
                <Badge tone={j.ok === null ? "blue" : j.ok ? "green" : "red"}>{j.ok === null ? t("admin.running") : j.ok ? t("admin.ok") : t("admin.failed")}</Badge>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card mt-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("admin.users")}</h2>
          <input className="input max-w-xs" placeholder={t("admin.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-left text-ink-400">
                <th className="pb-2 font-medium">{t("admin.col.user")}</th>
                <th className="pb-2 font-medium">{t("admin.col.phone")}</th>
                <th className="pb-2 font-medium">{t("admin.col.joined")}</th>
                <th className="pb-2 font-medium">{t("admin.col.plan")}</th>
                <th className="pb-2 font-medium">{t("admin.col.grant")}</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.users.map((u) => (
                <tr key={u.id} className="border-b border-ink-800 last:border-0">
                  <td className="py-3">
                    <div className="font-medium">
                      {u.name} {u.role === "ADMIN" && <Badge tone="purple">admin</Badge>}
                    </div>
                    <div className="text-xs text-ink-400">{u.email}</div>
                  </td>
                  <td className="py-3 text-ink-300">{u.phone ?? "—"}</td>
                  <td className="py-3 text-ink-300">{shortDate(u.createdAt)}</td>
                  <td className="py-3">{u.plan ? <PlanBadge plan={u.plan} /> : <span className="text-ink-400">—</span>}</td>
                  <td className="py-3">
                    <GrantForm user={u} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
