import type { Lang, Localized } from "../i18n/index.js";

export const PLAN_IDS = ["STARTER", "PRO", "ELITE"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type MarketGroup = "RESULT" | "GOALS" | "SCORE";
export type AiAccess = "none" | "summary" | "deep";

export interface PlanLimits {
  /** Highest league tier visible (1 = core, 2 = extended, 3 = everything). 0 = none. */
  leagueTier: 0 | 1 | 2 | 3;
  marketGroups: MarketGroup[];
  /** Max selections in the custom slip builder. 0 = builder unavailable. */
  builderMaxPicks: number;
  aiAccess: AiAccess;
  slipReviewsPerDay: number;
  historyDays: number;
  /** 0 = today only, 1 = today + tomorrow. */
  daysAhead: number;
  valueEdges: boolean;
  csvExport: boolean;
}

export interface PlanDef {
  id: PlanId;
  name: Localized;
  priceXaf: number;
  tagline: Localized;
  popular: boolean;
  features: Localized<string[]>;
  limits: PlanLimits;
}

export const SUBSCRIPTION_DAYS = 30;

export const PLAN_RANK: Record<PlanId, number> = { STARTER: 1, PRO: 2, ELITE: 3 };

export const PLANS: Record<PlanId, PlanDef> = {
  STARTER: {
    id: "STARTER",
    name: { en: "Starter", fr: "Starter" },
    priceXaf: 1000,
    tagline: { en: "Daily AI tips for Europe's biggest leagues.", fr: "Des pronostics IA quotidiens sur les grands championnats européens." },
    popular: false,
    features: {
      en: [
        "Daily predictions for the Top-5 European leagues + Champions League",
        "Match result (1X2) & Double Chance tips",
        "2 daily AI combinations: Safe Double & Daily Treble",
        "Win probability & confidence score on every match",
        "One-tap copy of tips to use on the platform of your choice",
        "3-day results history",
      ],
      fr: [
        "Pronostics quotidiens sur le Top 5 européen + Ligue des Champions",
        "Pronostics résultat (1X2) et double chance",
        "2 combinaisons IA par jour : Double Sûr et Triple du Jour",
        "Probabilité de victoire et indice de confiance pour chaque match",
        "Copie des pronostics en un clic pour la plateforme de votre choix",
        "Historique des résultats sur 3 jours",
      ],
    },
    limits: {
      leagueTier: 1,
      marketGroups: ["RESULT"],
      builderMaxPicks: 0,
      aiAccess: "none",
      slipReviewsPerDay: 0,
      historyDays: 3,
      daysAhead: 0,
      valueEdges: false,
      csvExport: false,
    },
  },
  PRO: {
    id: "PRO",
    name: { en: "Pro", fr: "Pro" },
    priceXaf: 2000,
    tagline: { en: "More leagues, goals markets and value tips.", fr: "Plus de championnats, les marchés de buts et les value tips." },
    popular: true,
    features: {
      en: [
        "Everything in Starter",
        "20+ leagues: Europa & Conference League, Eredivisie, Portugal, Turkey, Brazil, Argentina, MLS, Saudi Pro League & more",
        "Goals markets: Over/Under 1.5 · 2.5 · 3.5 and Both Teams To Score",
        "5 daily combinations incl. Goals Galore, BTTS Special & Value Four",
        "Value edges versus bookmaker odds",
        "AI match summaries & key factors",
        "Custom tip builder (up to 6 selections)",
        "30-day results history",
      ],
      fr: [
        "Tout le contenu Starter",
        "20+ championnats : Ligue Europa et Ligue Conférence, Eredivisie, Portugal, Turquie, Brésil, Argentine, MLS, Saudi Pro League et plus",
        "Marchés de buts : plus/moins de 1,5 · 2,5 · 3,5 buts et les deux équipes marquent",
        "5 combinaisons par jour dont Festival de Buts, Spécial GG et Quatre Value",
        "Écarts de valeur face aux cotes des bookmakers",
        "Résumés IA des matchs et facteurs clés",
        "Créateur de combinaisons personnalisées (jusqu'à 6 sélections)",
        "Historique des résultats sur 30 jours",
      ],
    },
    limits: {
      leagueTier: 2,
      marketGroups: ["RESULT", "GOALS"],
      builderMaxPicks: 6,
      aiAccess: "summary",
      slipReviewsPerDay: 0,
      historyDays: 30,
      daysAhead: 0,
      valueEdges: true,
      csvExport: false,
    },
  },
  ELITE: {
    id: "ELITE",
    name: { en: "Elite VIP", fr: "Élite VIP" },
    priceXaf: 5000,
    tagline: { en: "Every league, every market, full AI intelligence.", fr: "Tous les championnats, tous les marchés, toute l'intelligence IA." },
    popular: false,
    features: {
      en: [
        "Everything in Pro",
        "All covered leagues incl. CAF Champions League, AFCON, Egypt, Morocco, South Africa, second divisions & internationals",
        "Correct-score predictions",
        "Elite combos: Mega Accumulator, Elite Banker, Value Five & Correct Score Picks",
        "Deep AI analysis with live team news (injuries, suspensions, line-ups)",
        "AI risk review of your own combinations (10 per day)",
        "Unlimited tip builder",
        "Early access to tomorrow's predictions",
        "Full results history + CSV export",
      ],
      fr: [
        "Tout le contenu Pro",
        "Tous les championnats couverts dont Ligue des Champions CAF, CAN, Égypte, Maroc, Afrique du Sud, deuxièmes divisions et sélections nationales",
        "Pronostics de score exact",
        "Combinaisons Élite : Méga Combiné, Banker Élite, Cinq Value et Scores Exacts",
        "Analyse IA approfondie avec l'actualité des équipes (blessures, suspensions, compositions)",
        "Analyse IA du risque de vos propres combinaisons (10 par jour)",
        "Créateur de combinaisons illimité",
        "Accès anticipé aux pronostics du lendemain",
        "Historique complet + export CSV",
      ],
    },
    limits: {
      leagueTier: 3,
      marketGroups: ["RESULT", "GOALS", "SCORE"],
      builderMaxPicks: 30,
      aiAccess: "deep",
      slipReviewsPerDay: 10,
      historyDays: 3650,
      daysAhead: 1,
      valueEdges: true,
      csvExport: true,
    },
  },
};

/** A plan with its text resolved to one language, as sent to clients. */
export function planView(id: PlanId, lang: Lang) {
  const p = PLANS[id];
  return { ...p, name: p.name[lang], tagline: p.tagline[lang], features: p.features[lang] };
}

/** Limits for visitors and users without an active subscription. */
export const FREE_LIMITS: PlanLimits = {
  leagueTier: 0,
  marketGroups: [],
  builderMaxPicks: 0,
  aiAccess: "none",
  slipReviewsPerDay: 0,
  historyDays: 3,
  daysAhead: 0,
  valueEdges: false,
  csvExport: false,
};

export function limitsFor(plan: PlanId | null | undefined): PlanLimits {
  return plan ? PLANS[plan].limits : FREE_LIMITS;
}

export function planAtLeast(plan: PlanId | null | undefined, min: PlanId): boolean {
  return Boolean(plan) && PLAN_RANK[plan as PlanId] >= PLAN_RANK[min];
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

/** Lowest plan that can see a league of the given tier. */
export function planForLeagueTier(tier: number): PlanId {
  return tier <= 1 ? "STARTER" : tier === 2 ? "PRO" : "ELITE";
}

export function planForMarketGroup(group: MarketGroup): PlanId {
  return group === "RESULT" ? "STARTER" : group === "GOALS" ? "PRO" : "ELITE";
}
