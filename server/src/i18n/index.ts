import type { NextFunction, Request, Response } from "express";
import { MESSAGES } from "./messages.js";

export const LANGS = ["en", "fr"] as const;
export type Lang = (typeof LANGS)[number];
/** A string available in every supported language. */
export type Localized<T = string> = Record<Lang, T>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      lang: Lang;
    }
  }
}

export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

export function interpolate(template: string, vars?: Record<string, string | number>) {
  return vars ? template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : template;
}

/** Translate a message key; unknown keys (e.g. raw zod messages) are returned unchanged. */
export function msg(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const table = MESSAGES[lang] as Record<string, string>;
  return interpolate(table[key] ?? (MESSAGES.en as Record<string, string>)[key] ?? key, vars);
}

/** Resolve the request language from the client header, then Accept-Language. */
export function detectLang(req: Request, _res: Response, next: NextFunction) {
  const explicit = req.get("x-oj-lang");
  // acceptsLanguages() returns the first option when the header is absent, so only consult it if present.
  const preferred = req.get("accept-language") ? req.acceptsLanguages("en", "fr") : false;
  req.lang = isLang(explicit) ? explicit : preferred === "fr" ? "fr" : "en";
  next();
}
