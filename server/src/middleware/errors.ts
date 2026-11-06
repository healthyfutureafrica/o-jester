import type { NextFunction, Request, Response } from "express";
import { msg } from "../i18n/index.js";
import { HttpError } from "../lib/http.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("http");

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: msg(req.lang ?? "en", "error.route") } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const lang = req.lang ?? "en";
  if (err instanceof HttpError) {
    let details = err.details as { fields?: Record<string, string> } | undefined;
    if (details?.fields) {
      details = { ...details, fields: Object.fromEntries(Object.entries(details.fields).map(([k, v]) => [k, msg(lang, v)])) };
    }
    res.status(err.status).json({ error: { code: err.code, message: msg(lang, err.message, err.vars), details } });
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { code: "BAD_JSON", message: msg(lang, "error.badJson") } });
    return;
  }
  log.error(`${req.method} ${req.path}`, err instanceof Error ? (err.stack ?? err.message) : err);
  res.status(500).json({ error: { code: "INTERNAL", message: msg(lang, "error.internal") } });
}
