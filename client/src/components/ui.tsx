import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import type { AiStance, PlanId } from "../lib/types";

type Variant = "primary" | "gold" | "outline" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-pitch-500 text-ink-950 hover:bg-pitch-400 shadow-lg shadow-pitch-500/20",
  gold: "bg-gold-500 text-ink-950 hover:bg-gold-400 shadow-lg shadow-gold-500/20",
  outline: "border border-ink-600 text-ink-100 hover:border-ink-400 hover:bg-ink-800",
  ghost: "text-ink-300 hover:text-ink-100 hover:bg-ink-800",
  danger: "bg-loss-500 text-white hover:bg-loss-400",
};
const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2.5 text-sm", lg: "px-6 py-3.5 text-base" };

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant = "primary", size = "md", className = "", children }: { to: string; variant?: Variant; size?: "sm" | "md" | "lg"; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </Link>
  );
}

export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-24 text-pitch-500">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function Badge({ children, tone = "default", className = "" }: { children: ReactNode; tone?: "default" | "green" | "gold" | "purple" | "red" | "blue"; className?: string }) {
  const tones = {
    default: "bg-ink-700/70 text-ink-300",
    green: "bg-pitch-500/15 text-pitch-400",
    gold: "bg-gold-500/15 text-gold-400",
    purple: "bg-jester-500/15 text-jester-400",
    red: "bg-loss-500/15 text-loss-400",
    blue: "bg-sky-500/15 text-sky-300",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>{children}</span>;
}

const PLAN_TONE: Record<PlanId, "green" | "gold" | "purple"> = { STARTER: "green", PRO: "gold", ELITE: "purple" };

/** Translated plan name. */
export function usePlanName() {
  const { t } = useI18n();
  return (p: PlanId) => t(`plan.${p}`);
}

export function PlanBadge({ plan }: { plan: PlanId }) {
  const planName = usePlanName();
  return <Badge tone={PLAN_TONE[plan]}>{planName(plan)}</Badge>;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const tones = {
    info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    error: "border-loss-500/30 bg-loss-500/10 text-loss-400",
    success: "border-pitch-500/30 bg-pitch-500/10 text-pitch-400",
    warning: "border-gold-500/30 bg-gold-500/10 text-gold-400",
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 text-4xl" aria-hidden>
        ⚽
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="mt-2 max-w-md text-sm text-ink-300">{children}</div>}
    </div>
  );
}

/** Three-way 1X2 probability bar. */
export function ProbabilityBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  const seg = (p: number) => `${Math.max(p * 100, 4)}%`;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-ink-700">
        <div className="bg-pitch-500" style={{ width: seg(home) }} />
        <div className="bg-ink-400" style={{ width: seg(draw) }} />
        <div className="bg-jester-500" style={{ width: seg(away) }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-ink-300">
        <span>
          <span className="font-semibold text-pitch-400">1</span> {Math.round(home * 100)}%
        </span>
        <span>
          <span className="font-semibold text-ink-300">X</span> {Math.round(draw * 100)}%
        </span>
        <span>
          <span className="font-semibold text-jester-400">2</span> {Math.round(away * 100)}%
        </span>
      </div>
    </div>
  );
}

export function ConfidenceMeter({ value, size = 52 }: { value: number; size?: number }) {
  const { t } = useI18n();
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 70 ? "#22c55e" : value >= 55 ? "#f5b301" : "#f87171";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`${t("ui.confidence")} ${value}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1c2742" strokeWidth="5" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="5" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">{value}</span>
    </div>
  );
}

export function StanceBadge({ stance }: { stance: AiStance }) {
  const { t } = useI18n();
  const tone = stance === "BACK" ? "green" : stance === "LEAN" ? "gold" : "red";
  return <Badge tone={tone}>✦ {t(`stance.${stance}`)}</Badge>;
}

export function ResultBadge({ result }: { result: string }) {
  const { t } = useI18n();
  if (result === "WON") return <Badge tone="green">✓ {t("result.WON")}</Badge>;
  if (result === "LOST") return <Badge tone="red">✗ {t("result.LOST")}</Badge>;
  if (result === "VOID") return <Badge>{t("result.VOID")}</Badge>;
  if (result === "SETTLED") return <Badge tone="blue">{t("result.SETTLED")}</Badge>;
  return <Badge tone="blue">{t("result.PENDING")}</Badge>;
}

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} className={className}>
      {copied ? `✓ ${t("ui.copied")}` : `⧉ ${t("ui.copy")}`}
    </Button>
  );
}

export function ShareWhatsApp({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <a
      href={`https://wa.me/?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-xl border border-ink-600 px-3 py-1.5 text-sm font-semibold text-ink-100 transition hover:border-pitch-500 hover:text-pitch-400"
    >
      {t("ui.share")}
    </a>
  );
}

/** Localised labels for the copy/share text. */
export function useSlipLabels() {
  const { t } = useI18n();
  return { header: t("copy.header"), total: t("copy.total"), footer: t("copy.footer") };
}

export function UpgradePrompt({ plan, reason, compact }: { plan: PlanId; reason?: string; compact?: boolean }) {
  const { t } = useI18n();
  const planName = usePlanName();
  const text = reason === "EARLY_ACCESS" ? t("lock.early") : reason === "SUBSCRIBE" ? t("lock.subscribe") : t("lock.plan", { plan: planName(plan) });
  return (
    <div className={`flex ${compact ? "flex-row items-center justify-between gap-3" : "flex-col items-center gap-3 text-center"}`}>
      <p className="text-sm text-ink-300">
        <span aria-hidden>🔒 </span>
        {text}
      </p>
      <ButtonLink to={`/pricing?plan=${plan}`} variant={plan === "ELITE" ? "gold" : "primary"} size="sm">
        {reason === "SUBSCRIBE" ? t("lock.seePlans") : t("lock.upgradeTo", { plan: planName(plan) })}
      </ButtonLink>
    </div>
  );
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-300">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** "Prediction tips only · AI can make mistakes · 18+" notice shown on every prediction page. */
export function DisclaimerBar() {
  const { t } = useI18n();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gold-500/25 bg-gold-500/5 px-4 py-2.5 text-xs text-ink-300">
      <span className="rounded border border-loss-400/60 px-1.5 py-0.5 font-bold text-loss-400">18+</span>
      <span className="flex-1">{t("disclaimer.bar")}</span>
      <Link to="/legal#disclaimer" className="font-semibold text-gold-400 hover:underline">
        {t("disclaimer.readMore")}
      </Link>
    </div>
  );
}

/** Reminder attached to every piece of AI-generated content. */
export function AiNotice() {
  const { t } = useI18n();
  return (
    <p className="flex gap-2 rounded-lg bg-ink-850 px-3 py-2 text-xs text-ink-400">
      <span aria-hidden>ⓘ</span>
      <span>{t("ai.mistakes")}</span>
    </p>
  );
}

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={`inline-flex rounded-lg border border-ink-700 p-0.5 text-xs font-bold ${className}`} role="group" aria-label={t("nav.language")}>
      {(["fr", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`rounded-md px-2 py-1 uppercase transition ${lang === l ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
