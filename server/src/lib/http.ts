import type { z, ZodTypeAny } from "zod";
import type { MessageKey } from "../i18n/messages.js";

type Vars = Record<string, string | number>;

/**
 * API error. `message` is a message key (see i18n/messages.ts) that the error
 * handler translates into the request's language.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: MessageKey,
    public code = "ERROR",
    public details?: unknown,
    public vars?: Vars,
  ) {
    super(message);
  }
}

export const badRequest = (key: MessageKey, vars?: Vars, details?: unknown) => new HttpError(400, key, "BAD_REQUEST", details, vars);
export const unauthorized = (key: MessageKey = "auth.signIn") => new HttpError(401, key, "UNAUTHORIZED");
export const forbidden = (key: MessageKey = "auth.forbidden", code = "FORBIDDEN", details?: unknown, vars?: Vars) =>
  new HttpError(403, key, code, details, vars);
export const notFound = (key: MessageKey = "error.notFound") => new HttpError(404, key, "NOT_FOUND");
export const tooMany = (key: MessageKey, vars?: Vars) => new HttpError(429, key, "RATE_LIMITED", undefined, vars);

/**
 * Validate `data` against a zod schema, throwing a 400 with per-field errors.
 * Schema messages should be message keys so they can be translated.
 */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
    const first = Object.values(fields)[0];
    const key = (first && /^[a-z]+\.[A-Za-z]+$/.test(first) ? first : "validation.invalid") as MessageKey;
    throw new HttpError(400, key, "BAD_REQUEST", { fields });
  }
  return result.data;
}
