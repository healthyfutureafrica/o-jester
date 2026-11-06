type Level = "debug" | "info" | "warn" | "error";

const quiet = process.env.NODE_ENV === "test";
const verbose = process.env.NODE_ENV !== "production";

function write(level: Level, scope: string, message: string, extra?: unknown) {
  if (quiet && level !== "error") return;
  if (level === "debug" && !verbose) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra === undefined) out(line);
  else out(line, extra instanceof Error ? extra.message : extra);
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => write("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => write("error", scope, msg, extra),
  };
}
