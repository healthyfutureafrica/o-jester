import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setApiLang } from "../lib/api";
import { setFormatLocale } from "../lib/format";
import { en, type MessageKey } from "./en";
import { fr } from "./fr";

export type Lang = "en" | "fr";
export type { MessageKey };
type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, fr };
const STORAGE_KEY = "oj-lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    // storage unavailable — fall back to the browser language
  }
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function apply(lang: Lang) {
  setApiLang(lang);
  setFormatLocale(lang);
  document.documentElement.lang = lang;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = initialLang();
    apply(l);
    return l;
  });
  const qc = useQueryClient();

  useEffect(() => {
    apply(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  const setLang = useCallback(
    (l: Lang) => {
      apply(l);
      setLangState(l);
      // Server responses (plans, labels, AI analysis, errors) are localised — refetch them.
      void qc.invalidateQueries();
    },
    [qc],
  );

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => {
      const template = DICTS[lang][key] ?? en[key] ?? key;
      return vars ? template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : template;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
