import { createApp } from "./app.js";
import { env, paymentConfig } from "./config/env.js";
import { startScheduler } from "./jobs/scheduler.js";
import { createLogger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { aiEnabled } from "./services/ai/analyst.js";
import { footballProvider } from "./services/football/index.js";

const log = createLogger("server");

const server = createApp().listen(env.PORT, () => {
  log.info(`O-Jester API listening on ${env.API_URL} (${env.NODE_ENV})`);
  log.info(`data: ${footballProvider.name} · AI: ${aiEnabled ? env.AI_MODEL : "off"}`);
  const paymentMode = paymentConfig.sandbox ? (paymentConfig.enkap ? "ENKAP sandbox" : "local sandbox") : "live";
  log.info(
    `payments: ${paymentMode} · ENKAP ${paymentConfig.enkap ? "on" : "off"} · flutterwave ${paymentConfig.flutterwave ? "on" : "off"} · paypal ${paymentConfig.paypal ? "on" : "off"}`,
  );
  if (env.NODE_ENV === "production" && paymentConfig.sandbox) log.warn("PAYMENTS_SANDBOX is enabled in production!");
  if (env.ENABLE_SCHEDULER) startScheduler().catch((err) => log.error("scheduler failed to start", err));
});

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
