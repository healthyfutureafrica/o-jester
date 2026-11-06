import { describe, expect, it } from "vitest";
import { msg } from "../src/i18n/index.js";
import { MESSAGES } from "../src/i18n/messages.js";
import { ageOn } from "../src/lib/age.js";
import { COMBO_TYPES, comboText } from "../src/services/combos/builder.js";
import { PLAN_IDS, planView } from "../src/config/plans.js";

describe("i18n", () => {
  it("has a French translation for every English message", () => {
    expect(Object.keys(MESSAGES.fr).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it("translates and interpolates messages", () => {
    expect(msg("fr", "slip.maxPicks", { n: 6 })).toBe("Votre formule autorise jusqu'à 6 sélections par ticket.");
    expect(msg("en", "slip.maxPicks", { n: 6 })).toBe("Your plan allows up to 6 selections per slip.");
    expect(msg("fr", "not.a.key")).toBe("not.a.key");
  });

  it("localises combos and plans in both languages", () => {
    for (const t of COMBO_TYPES) {
      expect(comboText(t.type, "fr")!.title).toBeTruthy();
      expect(comboText(t.type, "en")!.title).not.toBe("");
    }
    for (const id of PLAN_IDS) {
      expect(planView(id, "fr").features.length).toBe(planView(id, "en").features.length);
    }
    expect(planView("ELITE", "fr").name).toBe("Élite VIP");
  });
});

describe("age check", () => {
  const today = new Date("2026-10-21T12:00:00Z");
  it("computes age in whole years", () => {
    expect(ageOn("2008-10-21", today)).toBe(18);
    expect(ageOn("2008-10-22", today)).toBe(17);
    expect(ageOn("1990-01-01", today)).toBe(36);
  });
});
