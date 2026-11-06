import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Alert, Badge, Button, ButtonLink, PlanBadge, SectionTitle, usePlanName } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { api, errorMessage } from "../lib/api";
import { formatXaf, shortDate } from "../lib/format";
import type { PaymentView, Session } from "../lib/types";

const STATUS_TONE = { SUCCEEDED: "green", PENDING: "blue", FAILED: "red", CANCELLED: "default" } as const;

export default function Account() {
  const { session, setSession } = useApp();
  const { t } = useI18n();
  const planName = usePlanName();
  const payments = useQuery({ queryKey: ["payments"], queryFn: () => api.get<{ payments: PaymentView[] }>("/payments") });
  const [profile, setProfile] = useState({ name: session?.user.name ?? "", phone: session?.user.phone ?? "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });

  const saveProfile = useMutation({
    mutationFn: () => api.patch<Session>("/account", profile),
    onSuccess: (s) => setSession(s),
  });
  const changePassword = useMutation({
    mutationFn: () => api.post("/account/password", pw),
    onSuccess: () => setPw({ currentPassword: "", newPassword: "" }),
  });

  if (!session) return null;
  const sub = session.subscription;

  return (
    <div className="container-page py-8">
      <SectionTitle title={t("account.title")} subtitle={session.user.email} />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="card p-6">
          <h2 className="text-lg font-semibold">{t("account.subscription")}</h2>
          {sub ? (
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-3">
                <PlanBadge plan={sub.plan} />
                <span className="text-sm text-ink-300">
                  {t("account.activeUntil")} <strong className="text-ink-100">{shortDate(sub.endsAt)}</strong> · {t("account.daysLeft", { n: sub.daysLeft })}
                </span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full bg-pitch-500" style={{ width: `${Math.min(100, (sub.daysLeft / 30) * 100)}%` }} />
              </div>
              {sub.queued.length > 0 && (
                <ul className="mt-4 space-y-1 text-sm text-ink-300">
                  {sub.queued.map((q) => (
                    <li key={q.startsAt}>{t("account.then", { plan: planName(q.plan), from: shortDate(q.startsAt), to: shortDate(q.endsAt) })}</li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <ButtonLink to={`/checkout/${sub.plan}`} size="sm">{t("account.renew")}</ButtonLink>
                {sub.plan !== "ELITE" && <ButtonLink to="/pricing" size="sm" variant="gold">{t("account.upgrade")}</ButtonLink>}
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-ink-300">{t("account.none")}</p>
              <ButtonLink to="/pricing" className="mt-4">{t("account.choose")}</ButtonLink>
            </div>
          )}
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold">{t("account.profile")}</h2>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              saveProfile.mutate();
            }}
          >
            {saveProfile.isError && <Alert tone="error">{errorMessage(saveProfile.error)}</Alert>}
            {saveProfile.isSuccess && <Alert tone="success">{t("account.saved")}</Alert>}
            <div>
              <label className="label" htmlFor="name">{t("account.name")}</label>
              <input id="name" className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="phone">{t("auth.phone")}</label>
              <input id="phone" className="input" placeholder="+237 6XX XXX XXX" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </div>
            <Button type="submit" loading={saveProfile.isPending}>{t("account.save")}</Button>
          </form>
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold">{t("account.payments")}</h2>
          {payments.data?.payments.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-left text-ink-400">
                    <th className="pb-2 font-medium">{t("account.col.date")}</th>
                    <th className="pb-2 font-medium">{t("account.col.plan")}</th>
                    <th className="pb-2 font-medium">{t("account.col.amount")}</th>
                    <th className="pb-2 font-medium">{t("account.col.method")}</th>
                    <th className="pb-2 font-medium">{t("account.col.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.payments.map((p) => (
                    <tr key={p.reference} className="border-b border-ink-800 last:border-0">
                      <td className="py-2.5">{shortDate(p.createdAt)}</td>
                      <td className="py-2.5">{planName(p.plan)}</td>
                      <td className="py-2.5">{p.chargeCurrency === "XAF" ? formatXaf(p.amountXaf) : `${p.chargeAmount} ${p.chargeCurrency}`}</td>
                      <td className="py-2.5">{t(`checkout.m.${p.method}`)}</td>
                      <td className="py-2.5">
                        <Badge tone={STATUS_TONE[p.status]}>{t(`pay.status.${p.status}`)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-400">{t("account.noPayments")}</p>
          )}
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold">{t("account.password")}</h2>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              changePassword.mutate();
            }}
          >
            {changePassword.isError && <Alert tone="error">{errorMessage(changePassword.error)}</Alert>}
            {changePassword.isSuccess && <Alert tone="success">{t("account.pwUpdated")}</Alert>}
            <div>
              <label className="label" htmlFor="cur">{t("account.current")}</label>
              <input id="cur" type="password" className="input" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="new">{t("account.new")}</label>
              <input id="new" type="password" className="input" autoComplete="new-password" minLength={8} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </div>
            <Button type="submit" variant="outline" loading={changePassword.isPending}>{t("account.update")}</Button>
          </form>
        </section>
      </div>
    </div>
  );
}
