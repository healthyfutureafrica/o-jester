"""Subscription plans — single source of truth for prices and entitlements."""

from __future__ import annotations

from dataclasses import dataclass, field

PLAN_IDS = ("STARTER", "PRO", "ELITE")
PLAN_RANK = {"STARTER": 1, "PRO": 2, "ELITE": 3}
SUBSCRIPTION_DAYS = 30


@dataclass(frozen=True)
class Limits:
    league_tier: int  # highest league tier visible (0 = none)
    market_groups: tuple[str, ...]
    builder_max_picks: int  # 0 = builder unavailable
    ai_access: str  # none | summary | deep
    slip_reviews_per_day: int
    history_days: int
    days_ahead: int  # 0 = today only, 1 = today + tomorrow
    value_edges: bool
    csv_export: bool


@dataclass(frozen=True)
class Plan:
    id: str
    price_xaf: int
    popular: bool
    name: dict[str, str]
    tagline: dict[str, str]
    features: dict[str, list[str]] = field(hash=False)
    limits: Limits = field(hash=False)


PLANS: dict[str, Plan] = {
    "STARTER": Plan(
        id="STARTER",
        price_xaf=1000,
        popular=False,
        name={"en": "Starter", "fr": "Starter"},
        tagline={"en": "Daily AI tips for Europe's biggest leagues.", "fr": "Des pronostics quotidiens sur les grands championnats européens."},
        features={
            "en": [
                "Daily predictions for the Top-5 European leagues + Champions League",
                "Match result (1X2) & Double Chance tips",
                "2 daily combinations: Safe Double & Daily Treble",
                "Win probability & confidence score on every match",
                "One-tap copy of tips to use on the platform of your choice",
                "3-day results history",
            ],
            "fr": [
                "Pronostics quotidiens sur le Top 5 européen + Ligue des Champions",
                "Pronostics résultat (1X2) et double chance",
                "2 combinaisons par jour : Double Sûr et Triple du Jour",
                "Probabilité de victoire et indice de confiance pour chaque match",
                "Copie des pronostics en un clic pour la plateforme de votre choix",
                "Historique des résultats sur 3 jours",
            ],
        },
        limits=Limits(1, ("RESULT",), 0, "none", 0, 3, 0, False, False),
    ),
    "PRO": Plan(
        id="PRO",
        price_xaf=2000,
        popular=True,
        name={"en": "Pro", "fr": "Pro"},
        tagline={"en": "More leagues, goals markets and value tips.", "fr": "Plus de championnats, les marchés de buts et les value tips."},
        features={
            "en": [
                "Everything in Starter",
                "20+ leagues: Europa & Conference League, Eredivisie, Portugal, Turkey, Brazil, Argentina, MLS, Saudi Pro League & more",
                "Goals markets: Over/Under 1.5 · 2.5 · 3.5 and Both Teams To Score",
                "5 daily combinations incl. Goals Galore, BTTS Special & Value Four",
                "Value edges versus bookmaker odds",
                "AI match summaries & key factors (when AI is enabled)",
                "Custom tip builder (up to 6 selections)",
                "30-day results history",
            ],
            "fr": [
                "Tout le contenu Starter",
                "20+ championnats : Ligue Europa et Ligue Conférence, Eredivisie, Portugal, Turquie, Brésil, Argentine, MLS, Saudi Pro League et plus",
                "Marchés de buts : plus/moins de 1,5 · 2,5 · 3,5 buts et les deux équipes marquent",
                "5 combinaisons par jour dont Festival de Buts, Spécial GG et Quatre Value",
                "Écarts de valeur face aux cotes des bookmakers",
                "Résumés IA des matchs et facteurs clés (lorsque l'IA est activée)",
                "Créateur de combinaisons personnalisées (jusqu'à 6 sélections)",
                "Historique des résultats sur 30 jours",
            ],
        },
        limits=Limits(2, ("RESULT", "GOALS"), 6, "summary", 0, 30, 0, True, False),
    ),
    "ELITE": Plan(
        id="ELITE",
        price_xaf=5000,
        popular=False,
        name={"en": "Elite VIP", "fr": "Élite VIP"},
        tagline={"en": "Every league, every market, full intelligence.", "fr": "Tous les championnats, tous les marchés, toute l'analyse."},
        features={
            "en": [
                "Everything in Pro",
                "All covered leagues incl. CAF Champions League, AFCON, Egypt, Morocco, South Africa, second divisions & internationals",
                "Correct-score predictions",
                "Elite combos: Mega Combo, Elite Banker, Value Five & Correct Score Picks",
                "Deep AI analysis with live team news (when AI is enabled)",
                "AI risk review of your own combinations (10 per day, when AI is enabled)",
                "Unlimited tip builder",
                "Early access to tomorrow's predictions",
                "Full results history + CSV export",
            ],
            "fr": [
                "Tout le contenu Pro",
                "Tous les championnats couverts dont Ligue des Champions CAF, CAN, Égypte, Maroc, Afrique du Sud, deuxièmes divisions et sélections nationales",
                "Pronostics de score exact",
                "Combinaisons Élite : Méga Combiné, Banker Élite, Cinq Value et Scores Exacts",
                "Analyse IA approfondie avec l'actualité des équipes (lorsque l'IA est activée)",
                "Analyse IA du risque de vos combinaisons (10 par jour, lorsque l'IA est activée)",
                "Créateur de combinaisons illimité",
                "Accès anticipé aux pronostics du lendemain",
                "Historique complet + export CSV",
            ],
        },
        limits=Limits(3, ("RESULT", "GOALS", "SCORE"), 30, "deep", 10, 3650, 1, True, True),
    ),
}

FREE_LIMITS = Limits(0, (), 0, "none", 0, 3, 0, False, False)


def limits_for(plan: str | None) -> Limits:
    return PLANS[plan].limits if plan in PLANS else FREE_LIMITS


def plan_at_least(plan: str | None, minimum: str) -> bool:
    return plan in PLAN_RANK and PLAN_RANK[plan] >= PLAN_RANK[minimum]


def plan_for_league_tier(tier: int) -> str:
    return "STARTER" if tier <= 1 else "PRO" if tier == 2 else "ELITE"
