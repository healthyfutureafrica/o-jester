import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { limitsFor } from "../config/plans.js";
import { unauthorized, validate } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { subscriptionSummary } from "../services/subscriptions.js";
import { phoneSchema, userView } from "./auth.js";

export const accountRouter = Router();
accountRouter.use("/account", requireAuth);

accountRouter.patch("/account", async (req, res) => {
  const body = validate(
    z.object({
      name: z.string().trim().min(2, "validation.name").max(60, "validation.name").optional(),
      phone: phoneSchema.optional().or(z.literal("").transform(() => null)),
    }),
    req.body,
  );
  const user = await prisma.user.update({ where: { id: req.auth!.user.id }, data: body });
  res.json({ user: userView(user), subscription: await subscriptionSummary(user.id), limits: limitsFor(req.auth!.plan) });
});

accountRouter.post("/account/password", async (req, res) => {
  const body = validate(
    z.object({
      currentPassword: z.string().min(1, "validation.passwordRequired"),
      newPassword: z.string().min(8, "validation.password").max(128, "validation.password"),
    }),
    req.body,
  );
  const user = req.auth!.user;
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw unauthorized("auth.currentPasswordWrong");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12) } });
  res.json({ ok: true });
});
