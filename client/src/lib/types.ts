export type PlanId = "STARTER" | "PRO" | "ELITE";
export type MarketGroup = "RESULT" | "GOALS" | "SCORE";
export type PayMethod = "ENKAP" | "MOBILE_MONEY" | "CARD" | "PAYPAL";

export interface PlanLimits {
  leagueTier: number;
  marketGroups: MarketGroup[];
  builderMaxPicks: number;
  aiAccess: "none" | "summary" | "deep";
  slipReviewsPerDay: number;
  historyDays: number;
  daysAhead: number;
  valueEdges: boolean;
  csvExport: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  priceXaf: number;
  tagline: string;
  popular: boolean;
  features: string[];
  limits: PlanLimits;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "USER" | "ADMIN";
  createdAt: string;
}

export interface SubscriptionSummary {
  plan: PlanId;
  startsAt: string;
  endsAt: string;
  daysLeft: number;
  queued: { plan: PlanId; startsAt: string; endsAt: string }[];
}

export interface Session {
  user: User;
  subscription: SubscriptionSummary | null;
  limits: PlanLimits;
}

export interface Meta {
  today: string;
  tomorrow: string;
  timezone: string;
  provider: string;
  aiEnabled: boolean;
  sandboxPayments: boolean;
  paymentMethods: { method: PayMethod; available: boolean; currency?: string }[];
  comboLockHour: number;
}

export interface MarketView {
  key: string;
  group: MarketGroup;
  label: string;
  short: string;
  probability: number;
  fairOdds: number;
  bookOdds?: number;
  edge?: number;
  result?: "WON" | "LOST";
}

export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
export type LockReason = "SUBSCRIBE" | "UPGRADE" | "EARLY_ACCESS";
export type AiStance = "BACK" | "LEAN" | "AVOID";

export interface MatchBase {
  id: string;
  leagueKey: string;
  leagueName: string;
  country: string;
  leagueTier: number;
  kickoff: string;
  matchDate: string;
  status: MatchStatus;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  locked: boolean;
  lockReason?: LockReason;
  requiredPlan?: PlanId;
  hasPrediction: boolean;
}

export interface PredictionSummary {
  bestPick: MarketView | null;
  confidence: number;
  probs: { home: number; draw: number; away: number };
  xg: { home: number; away: number };
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  aiStance: AiStance | null;
}

export interface MatchListItem extends MatchBase {
  prediction: PredictionSummary | null;
}

export interface TeamForm {
  played: number;
  gf: number;
  ga: number;
  homePlayed: number;
  homeGf: number;
  homeGa: number;
  awayPlayed: number;
  awayGf: number;
  awayGa: number;
  form?: string;
  position?: number;
  points?: number;
}

export interface AiAnalysisView {
  headline: string;
  summary: string;
  keyFactors: string[];
  teamNews?: string[];
  risks?: string[];
  verdict: { stance: AiStance; market: string; label: string; reasoning: string };
  confidenceDelta?: number;
  sources?: { title: string; url: string }[];
  generatedAt: string;
}

export interface MatchDetail extends MatchBase {
  prediction:
    | (PredictionSummary & {
        summary: string;
        markets: MarketView[];
        topScores: { home: number; away: number; probability: number }[] | null;
        modelVersion: string;
        updatedAt: string;
        ai: AiAnalysisView | null;
        aiLocked: PlanId | null;
      })
    | null;
  stats?: { home: TeamForm | null; away: TeamForm | null } | null;
}

export type SelectionResult = "PENDING" | "WON" | "LOST" | "VOID";

export interface ComboSelection {
  matchId: string;
  leagueName: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  short: string;
  label: string;
  odds: number;
  probability: number;
  oddsEstimated: boolean;
  result: SelectionResult;
  matchStatus: MatchStatus;
  score: { home: number; away: number } | null;
}

export interface Combo {
  id: string;
  date: string;
  type: string;
  title: string;
  description: string;
  minPlan: PlanId;
  kind: "ACCA" | "SINGLES";
  totalOdds: number;
  probability: number;
  oddsEstimated: boolean;
  status: "PENDING" | "WON" | "LOST" | "VOID" | "SETTLED";
  provisional: boolean;
  selectionsCount: number;
  wonCount: number;
  locked: boolean;
  lockReason?: LockReason;
  selections: ComboSelection[] | null;
}

export interface PaymentView {
  reference: string;
  plan: PlanId;
  amountXaf: number;
  chargeAmount: string;
  chargeCurrency: string;
  method: PayMethod;
  provider: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SlipEvaluation {
  selections: {
    matchId: string;
    leagueName: string;
    kickoff: string;
    homeTeam: string;
    awayTeam: string;
    market: string;
    short: string;
    label: string;
    odds: number;
    oddsEstimated: boolean;
    probability: number;
    edge: number | null;
  }[];
  totalOdds: number;
  probability: number;
  oddsEstimated: boolean;
  warnings: string[];
}

export interface SlipReview {
  overallRisk: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  verdict: string;
  weakLinks: { matchId: string; reason: string }[];
  suggestions: string[];
}
