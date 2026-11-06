import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, ButtonLink, PageLoader, Spinner, usePlanName } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { api, errorMessage } from "../lib/api";
import { formatXaf, shortDate } from "../lib/format";
import type { PaymentView, SubscriptionSummary } from "../lib/types";

export function Checkout() {
  const { plan: planParam } = useParams();
  const { plans, meta, session } = useApp();
  const { t } = useI18n();
  const planName = usePlanName();
  const plan = plans.find((p) => p.id === planParam);

  const checkout = useMutation({
    mutationFn: () =>
      api.post<{ reference: string; redirectUrl: string }>("/payments/checkout", {
        plan: plan!.id,
        method: "ENKAP",
      }),
    onSuccess: ({ redirectUrl }) => {
      window.location.assign(redirectUrl);
    },
  });

  if (!plans.length || !meta) return <PageLoader />;
  if (!plan) return <Navigate to="/pricing" replace />;

  const current = session?.subscription;
  const selected = meta.paymentMethods.find((m) => m.method === "ENKAP");
  const rank = (id: string) => plans.findIndex((p) => p.id === id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    checkout.mutate();
  };

  return (
    <div className="container-page py-10">
      <Link to="/pricing" className="text-sm text-ink-400 hover:text-ink-100">{t("checkout.back")}</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <aside className="card h-fit p-6">
          <div className="text-xs uppercase tracking-wide text-ink-400">{t("checkout.getting")}</div>
          <h1 className="mt-1 text-2xl font-bold">O-Jester {plan.name}</h1>
          <p className="text-sm text-ink-300">{plan.tagline}</p>
          <div className="my-5 font-display text-4xl font-bold">
            {formatXaf(plan.priceXaf)} <span className="text-base font-normal text-ink-400">{t("checkout.per30")}</span>
          </div>
          <ul className="space-y-2 text-sm text-ink-300">
            {plan.features.slice(0, 6).map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-pitch-400">✓</span>
                {f}
              </li>
            ))}
          </ul>
          {current && (
            <div className="mt-5">
              <Alert tone="info">
                {current.plan === plan.id
                  ? t("checkout.renewNote", { plan: planName(current.plan), date: shortDate(current.endsAt) })
                  : rank(plan.id) > rank(current.plan)
                    ? t("checkout.upgradeNote", { days: current.daysLeft, current: planName(current.plan), plan: plan.name })
                    : t("checkout.downgradeNote", { plan: plan.name, current: planName(current.plan), date: shortDate(current.endsAt) })}
              </Alert>
            </div>
          )}
          <p className="mt-5 text-xs text-ink-400">{t("checkout.notBet")}</p>
        </aside>

        <form onSubmit={submit} className="card p-6">
          <h2 className="text-lg font-semibold">{t("checkout.method")}</h2>
          <div className={`mt-4 rounded-xl border p-4 ${selected?.available ? "border-pitch-500 bg-pitch-500/5" : "border-ink-700 opacity-50"}`}>
            <div className="flex items-center gap-4">
              <span className="text-2xl" aria-hidden>🔒</span>
              <span>
                <span className="block font-semibold">{t("checkout.m.ENKAP")}</span>
                <span className="block text-xs text-ink-400">
                  {selected?.available ? t("checkout.m.ENKAP.detail") : t("checkout.unavailable")}
                </span>
              </span>
            </div>
          </div>

          {checkout.isError && (
            <div className="mt-5">
              <Alert tone="error">{errorMessage(checkout.error)}</Alert>
            </div>
          )}

          <Button type="submit" size="lg" className="mt-6 w-full" loading={checkout.isPending} disabled={!selected?.available}>
            {t("checkout.pay", { amount: formatXaf(plan.priceXaf) })}
          </Button>
          <p className="mt-3 text-center text-xs text-ink-400">
            {t("checkout.secure", { provider: "e-nkap", sandbox: meta.sandboxPayments ? t("checkout.sandbox") : "" })}
          </p>
        </form>
      </div>
    </div>
  );
}

/** Landing page after the provider redirects back. Polls until the payment is final. */
export function PaymentReturn() {
  const [params] = useSearchParams();
  const reference = params.get("reference") ?? params.get("tx_ref") ?? "";
  const cancelled = params.get("cancelled") || params.get("status") === "cancelled";
  const { refreshSession } = useApp();
  const { t } = useI18n();
  const planName = usePlanName();
  const [attempts, setAttempts] = useState(0);

  const q = useQuery({
    queryKey: ["payment", reference],
    queryFn: () => api.get<{ payment: PaymentView; subscription: SubscriptionSummary | null }>(`/payments/${reference}${cancelled ? "?cancelled=1" : ""}`),
    enabled: Boolean(reference),
    refetchInterval: (query) => (query.state.data?.payment.status === "PENDING" && attempts < 40 ? 3000 : false),
  });
  const status = q.data?.payment.status;

  useEffect(() => {
    if (status === "PENDING") setAttempts((a) => a + 1);
    if (status === "SUCCEEDED") void refreshSession();
  }, [q.dataUpdatedAt, status, refreshSession]);

  if (!reference) return <Navigate to="/pricing" replace />;

  return (
    <div className="container-page flex justify-center py-16">
      <div className="card w-full max-w-md p-8 text-center">
        {q.isError ? (
          <Alert tone="error">{errorMessage(q.error)}</Alert>
        ) : !q.data || status === "PENDING" ? (
          <>
            <Spinner className="mx-auto h-10 w-10 text-pitch-500" />
            <h1 className="mt-5 text-xl font-bold">{t("return.confirming")}</h1>
            <p className="mt-2 text-sm text-ink-300">{attempts >= 40 ? t("return.slow") : t("return.approve")}</p>
          </>
        ) : status === "SUCCEEDED" ? (
          <>
            <div className="text-5xl" aria-hidden>🎉</div>
            <h1 className="mt-4 text-2xl font-bold">{t("return.success")}</h1>
            {q.data.subscription && (
              <p className="mt-2 text-ink-300">{t("return.active", { plan: planName(q.data.payment.plan), date: shortDate(q.data.subscription.endsAt) })}</p>
            )}
            <p className="mt-1 text-xs text-ink-400">{t("return.ref", { ref: q.data.payment.reference })}</p>
            <ButtonLink to="/app" size="lg" className="mt-6 w-full">{t("return.see")}</ButtonLink>
          </>
        ) : (
          <>
            <div className="text-5xl" aria-hidden>⚠️</div>
            <h1 className="mt-4 text-xl font-bold">{status === "CANCELLED" ? t("return.cancelled") : t("return.failed")}</h1>
            <p className="mt-2 text-sm text-ink-300">{t("return.failedBody")}</p>
            <ButtonLink to={`/checkout/${q.data.payment.plan}`} size="lg" className="mt-6 w-full">{t("return.retry")}</ButtonLink>
          </>
        )}
      </div>
    </div>
  );
}

/** Mock gateway used when the server runs with PAYMENTS_SANDBOX=true. */
export function SandboxCheckout() {
  const [params] = useSearchParams();
  const reference = params.get("reference") ?? "";
  const navigate = useNavigate();
  const { t } = useI18n();
  const planName = usePlanName();
  const payments = useQuery({ queryKey: ["payments"], queryFn: () => api.get<{ payments: PaymentView[] }>("/payments") });
  const payment = payments.data?.payments.find((p) => p.reference === reference);
  const complete = useMutation({
    mutationFn: (outcome: "success" | "fail") => api.post("/payments/sandbox/complete", { reference, outcome }),
    onSuccess: () => navigate(`/payment/return?reference=${encodeURIComponent(reference)}`, { replace: true }),
  });

  if (payments.isLoading) return <PageLoader />;
  if (!payment)
    return (
      <div className="container-page py-16">
        <Alert tone="error">{t("sandbox.notFound")}</Alert>
      </div>
    );

  return (
    <div className="container-page flex justify-center py-16">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-gold-500/40 bg-white text-slate-900 shadow-2xl">
        <div className="bg-gold-500 px-5 py-3 text-sm font-bold text-ink-950">{t("sandbox.header")}</div>
        <div className="p-6">
          <div className="text-xs uppercase tracking-wide text-slate-500">O-Jester · {planName(payment.plan)}</div>
          <div className="mt-1 text-3xl font-bold">
            {payment.chargeCurrency === "XAF" ? formatXaf(Number(payment.chargeAmount)) : `${payment.chargeAmount} ${payment.chargeCurrency}`}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {t(`checkout.m.${payment.method}`)} · ref {payment.reference}
          </div>
          {complete.isError && <p className="mt-3 text-sm text-red-600">{errorMessage(complete.error)}</p>}
          <div className="mt-6 grid gap-2">
            <Button loading={complete.isPending && complete.variables === "success"} onClick={() => complete.mutate("success")}>
              {t("sandbox.approve")}
            </Button>
            <button className="rounded-xl border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100" onClick={() => complete.mutate("fail")}>
              {t("sandbox.decline")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
