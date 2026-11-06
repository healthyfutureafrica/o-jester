import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "../i18n";
import { Button, LanguageSwitch } from "./ui";

const STORAGE_KEY = "oj-age-confirmed";

function readConfirmed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "yes";
  } catch {
    return false;
  }
}

/**
 * Mandatory 18+ declaration shown before any content. The legal page stays
 * reachable so visitors can read the notice before confirming.
 */
export function AgeGate() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [confirmed, setConfirmed] = useState(readConfirmed);
  const [denied, setDenied] = useState(false);

  if (confirmed || pathname === "/legal") return null;

  const confirm = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "yes");
    } catch {
      // storage unavailable — the gate will show again next visit
    }
    setConfirmed(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/95 p-4 backdrop-blur" role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div className="card w-full max-w-lg p-7 sm:p-8">
        <div className="flex items-center justify-between">
          <span className="rounded-lg border-2 border-loss-400 px-2.5 py-1 font-display text-xl font-bold text-loss-400">18+</span>
          <LanguageSwitch />
        </div>
        {denied ? (
          <>
            <h2 id="age-gate-title" className="mt-5 text-2xl font-bold">{t("ageGate.blockedTitle")}</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-300">{t("ageGate.blockedBody")}</p>
          </>
        ) : (
          <>
            <h2 id="age-gate-title" className="mt-5 text-2xl font-bold">{t("ageGate.title")}</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-300">{t("ageGate.body1")}</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-300">{t("ageGate.body2")}</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <Button size="lg" onClick={confirm}>{t("ageGate.confirm")}</Button>
              <Button size="lg" variant="outline" onClick={() => setDenied(true)}>{t("ageGate.deny")}</Button>
            </div>
          </>
        )}
        <Link to="/legal#minors" className="mt-5 inline-block text-xs text-ink-400 underline hover:text-ink-100">
          {t("ageGate.legal")}
        </Link>
      </div>
    </div>
  );
}
