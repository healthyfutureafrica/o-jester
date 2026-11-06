import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { env, isProduction } from "./config/env.js";
import { detectLang, msg } from "./i18n/index.js";
import { csrfGuard, loadAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { accountRouter } from "./routes/account.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { paymentsRouter } from "./routes/payments.js";
import { predictionsRouter } from "./routes/predictions.js";
import { publicRouter } from "./routes/public.js";
import { resultsRouter } from "./routes/results.js";
import { slipsRouter } from "./routes/slips.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(detectLang);
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({ error: { code: "RATE_LIMITED", message: msg(req.lang, "error.rateLimited") } });
      },
    }),
  );
  api.use(csrfGuard);
  api.use(loadAuth);
  api.use(publicRouter);
  api.use("/auth", authRouter);
  api.use(predictionsRouter);
  api.use(resultsRouter);
  api.use(slipsRouter);
  api.use(paymentsRouter);
  api.use(accountRouter);
  api.use(adminRouter);
  api.use(notFoundHandler);
  app.use("/api", api);

  // In production the server also hosts the built React client.
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  if (isProduction && existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: "1h", index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
