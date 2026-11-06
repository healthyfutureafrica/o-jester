import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useSlip } from "../context/SlipContext";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";
import { AgeGate } from "./AgeGate";
import { Logo } from "./Logo";
import { ButtonLink, LanguageSwitch, PlanBadge } from "./ui";

const NAV: { to: string; label: MessageKey; end?: boolean }[] = [
  { to: "/app", label: "nav.combos", end: true },
  { to: "/app/matches", label: "nav.matches" },
  { to: "/app/builder", label: "nav.builder" },
  { to: "/results", label: "nav.results" },
  { to: "/pricing", label: "nav.pricing" },
];

function Navbar() {
  const { session, plan, logout } = useApp();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-ink-800 text-ink-100" : "text-ink-300 hover:text-ink-100"}`;
  const doLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>
              {t(n.label)}
            </NavLink>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <LanguageSwitch />
          {session ? (
            <>
              {plan ? <PlanBadge plan={plan} /> : <ButtonLink to="/pricing" size="sm" variant="gold">{t("nav.subscribe")}</ButtonLink>}
              {session.user.role === "ADMIN" && (
                <NavLink to="/admin" className={linkCls}>
                  {t("nav.admin")}
                </NavLink>
              )}
              <NavLink to="/account" className={linkCls}>
                {session.user.name.split(" ")[0]}
              </NavLink>
              <button className="text-sm text-ink-400 hover:text-ink-100" onClick={doLogout}>
                {t("nav.logout")}
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={linkCls}>
                {t("nav.login")}
              </NavLink>
              <ButtonLink to="/register" size="sm">
                {t("nav.getStarted")}
              </ButtonLink>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <LanguageSwitch />
          <button className="rounded-lg p-2 text-ink-300" onClick={() => setOpen((o) => !o)} aria-label={t("nav.menu")} aria-expanded={open}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-ink-800 px-4 pb-4 pt-2 lg:hidden" aria-label="Mobile" onClick={() => setOpen(false)}>
          <div className="flex flex-col gap-1">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>
                {t(n.label)}
              </NavLink>
            ))}
            {session ? (
              <>
                {session.user.role === "ADMIN" && (
                  <NavLink to="/admin" className={linkCls}>
                    {t("nav.admin")}
                  </NavLink>
                )}
                <NavLink to="/account" className={linkCls}>
                  {t("nav.account")} {plan && <PlanBadge plan={plan} />}
                </NavLink>
                <button className="rounded-lg px-3 py-2 text-left text-sm text-ink-400" onClick={doLogout}>
                  {t("nav.logout")}
                </button>
              </>
            ) : (
              <div className="mt-2 flex gap-2">
                <ButtonLink to="/login" variant="outline" size="sm" className="flex-1">
                  {t("nav.login")}
                </ButtonLink>
                <ButtonLink to="/register" size="sm" className="flex-1">
                  {t("nav.getStarted")}
                </ButtonLink>
              </div>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}

function SlipFab() {
  const { items } = useSlip();
  const { t } = useI18n();
  const { pathname } = useLocation();
  if (!items.length || pathname === "/app/builder") return null;
  return (
    <Link
      to="/app/builder"
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gold-500 px-5 py-3 font-semibold text-ink-950 shadow-xl shadow-gold-500/30 transition hover:bg-gold-400"
    >
      🧾 {t("slipFab.label")} <span className="rounded-full bg-ink-950 px-2 py-0.5 text-xs text-gold-400">{items.length}</span>
    </Link>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-20 border-t border-ink-800 bg-ink-950/60">
      <div className="container-page grid gap-8 py-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-md text-sm text-ink-400">{t("footer.tagline")}</p>
          <p className="mt-3 text-xs text-ink-400">{t("footer.pay")}</p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold">{t("footer.product")}</h4>
          <ul className="space-y-2 text-sm text-ink-400">
            <li><Link to="/app" className="hover:text-ink-100">{t("footer.todayCombos")}</Link></li>
            <li><Link to="/results" className="hover:text-ink-100">{t("nav.results")}</Link></li>
            <li><Link to="/pricing" className="hover:text-ink-100">{t("nav.pricing")}</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold">{t("footer.legal")}</h4>
          <ul className="space-y-2 text-sm text-ink-400">
            <li><Link to="/legal" className="hover:text-ink-100">{t("footer.notice")}</Link></li>
            <li><Link to="/legal#minors" className="hover:text-ink-100">{t("footer.minors")}</Link></li>
            <li><Link to="/legal#responsible" className="hover:text-ink-100">{t("footer.responsible")}</Link></li>
            <li><Link to="/legal#terms" className="hover:text-ink-100">{t("footer.terms")}</Link></li>
            <li><Link to="/legal#privacy" className="hover:text-ink-100">{t("footer.privacy")}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-800">
        <div className="container-page flex gap-3 py-5 text-xs leading-relaxed text-ink-400">
          <span className="h-fit shrink-0 rounded border border-loss-400/60 px-1.5 py-0.5 font-bold text-loss-400">18+</span>
          <p>
            {t("footer.strip")} © {new Date().getFullYear()} O-Jester
          </p>
        </div>
      </div>
    </footer>
  );
}

export function Layout() {
  const { meta } = useApp();
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col">
      {meta?.sandboxPayments && <div className="bg-gold-500/10 px-4 py-1.5 text-center text-xs text-gold-400">{t("banner.sandbox")}</div>}
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <SlipFab />
      <AgeGate />
    </div>
  );
}
