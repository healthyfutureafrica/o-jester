import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { Alert, Button } from "../components/ui";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { api, ApiError, errorMessage } from "../lib/api";
import type { Session } from "../lib/types";

const MIN_AGE = 18;

function ageOf(birthDate: string) {
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="container-page flex justify-center py-14">
      <div className="card w-full max-w-md p-7 sm:p-8">
        <Logo className="mb-6" />
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-ink-300">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function useAfterAuth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setSession } = useApp();
  return (s: Session) => {
    setSession(s);
    const plan = params.get("plan");
    const next = params.get("next");
    navigate(plan ? `/checkout/${plan}` : next && next.startsWith("/") ? next : "/app", { replace: true });
  };
}

export function Login() {
  const { session } = useApp();
  const { t } = useI18n();
  const done = useAfterAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to="/app" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      done(await api.post<Session>("/auth/login", { email, password }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t("auth.welcome")} subtitle={t("auth.welcomeSub")}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <label className="label" htmlFor="email">{t("auth.email")}</label>
          <input id="email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">{t("auth.password")}</label>
          <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {t("auth.login")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-300">
        {t("auth.new")}{" "}
        <Link to={`/register${params.toString() ? `?${params}` : ""}`} className="font-semibold text-pitch-400 hover:underline">
          {t("auth.create")}
        </Link>
      </p>
    </AuthShell>
  );
}

export function Register() {
  const { session } = useApp();
  const { t } = useI18n();
  const done = useAfterAuth();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", phone: "", birthDate: "", password: "", acceptTerms: false });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to="/app" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const today = new Date();
  const maxBirthDate = new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate()).toISOString().slice(0, 10);
  const underage = form.birthDate !== "" && ageOf(form.birthDate) < MIN_AGE;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (underage) {
      setError(t("auth.underageClient"));
      return;
    }
    setLoading(true);
    try {
      done(await api.post<Session>("/auth/register", form));
    } catch (err) {
      if (err instanceof ApiError && err.details?.fields) setFieldErrors(err.details.fields);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fe = (k: string) => fieldErrors[k] && <p className="mt-1 text-xs text-loss-400">{fieldErrors[k]}</p>;

  return (
    <AuthShell title={t("auth.registerTitle")} subtitle={t("auth.registerSub")}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <label className="label" htmlFor="name">{t("auth.name")}</label>
          <input id="name" className="input" autoComplete="name" required value={form.name} onChange={set("name")} />
          {fe("name")}
        </div>
        <div>
          <label className="label" htmlFor="email">{t("auth.email")}</label>
          <input id="email" type="email" className="input" autoComplete="email" required value={form.email} onChange={set("email")} />
          {fe("email")}
        </div>
        <div>
          <label className="label" htmlFor="birthDate">{t("auth.birthDate")}</label>
          <input id="birthDate" type="date" className="input" autoComplete="bday" required max={maxBirthDate} value={form.birthDate} onChange={set("birthDate")} />
          <p className={`mt-1 text-xs ${underage ? "text-loss-400" : "text-ink-400"}`}>{underage ? t("auth.underageClient") : t("auth.birthDateHelp")}</p>
          {fe("birthDate")}
        </div>
        <div>
          <label className="label" htmlFor="phone">
            {t("auth.phone")} <span className="text-ink-400">{t("auth.optional")}</span>
          </label>
          <input id="phone" type="tel" className="input" placeholder="+237 6XX XXX XXX" autoComplete="tel" value={form.phone} onChange={set("phone")} />
          {fe("phone")}
        </div>
        <div>
          <label className="label" htmlFor="password">{t("auth.password")}</label>
          <input id="password" type="password" className="input" autoComplete="new-password" minLength={8} required value={form.password} onChange={set("password")} />
          <p className="mt-1 text-xs text-ink-400">{t("auth.passwordHelp")}</p>
          {fe("password")}
        </div>
        <label className="flex items-start gap-3 text-sm text-ink-300">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-pitch-500" checked={form.acceptTerms} onChange={set("acceptTerms")} required />
          <span>
            {t("auth.accept1")} <strong className="text-ink-100">{t("auth.accept18")}</strong> {t("auth.accept2")}{" "}
            <Link to="/legal#terms" target="_blank" className="text-pitch-400 hover:underline">{t("auth.acceptTerms")}</Link> {t("auth.acceptAnd")}{" "}
            <Link to="/legal" target="_blank" className="text-pitch-400 hover:underline">{t("auth.acceptDisclaimer")}</Link>
            {t("auth.accept3")}
          </span>
        </label>
        {fe("acceptTerms")}
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={underage}>
          {t("auth.createBtn")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-300">
        {t("auth.have")}{" "}
        <Link to={`/login${params.toString() ? `?${params}` : ""}`} className="font-semibold text-pitch-400 hover:underline">
          {t("auth.login")}
        </Link>
      </p>
    </AuthShell>
  );
}
