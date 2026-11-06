"""Builds the day's tip combinations from predicted fixtures (pure functions, unit-tested)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable

from ..predictions.engine import Market, effective_odds


@dataclass(frozen=True)
class ComboType:
    type: str
    min_plan: str
    kind: str  # ACCA | SINGLES
    league_tier: int
    title: dict[str, str]
    description: dict[str, str]


COMBO_TYPES: list[ComboType] = [
    ComboType("SAFE_DOUBLE", "STARTER", "ACCA", 1, {"en": "Safe Double", "fr": "Double Sûr"},
              {"en": "The two highest-probability result picks of the day.", "fr": "Les deux pronostics de résultat les plus probables du jour."}),
    ComboType("DAILY_TREBLE", "STARTER", "ACCA", 1, {"en": "Daily Treble", "fr": "Triple du Jour"},
              {"en": "Three strong result picks for a better return.", "fr": "Trois pronostics de résultat solides pour une meilleure cote."}),
    ComboType("GOALS_GALORE", "PRO", "ACCA", 2, {"en": "Goals Galore", "fr": "Festival de Buts"},
              {"en": "Over-goals selections from the most attacking fixtures.", "fr": "Sélections « plus de buts » sur les matchs les plus offensifs."}),
    ComboType("BTTS_SPECIAL", "PRO", "ACCA", 2, {"en": "BTTS Special", "fr": "Spécial GG"},
              {"en": "Matches where both teams are most likely to score.", "fr": "Les matchs où les deux équipes ont le plus de chances de marquer."}),
    ComboType("VALUE_FOUR", "PRO", "ACCA", 2, {"en": "Value Four", "fr": "Quatre Value"},
              {"en": "Four picks where our model beats the bookmaker's price.", "fr": "Quatre pronostics où notre modèle bat la cote du bookmaker."}),
    ComboType("ELITE_BANKER", "ELITE", "SINGLES", 3, {"en": "Elite Banker", "fr": "Banker Élite"},
              {"en": "The single most reliable selection on today's card.", "fr": "La sélection la plus fiable du programme du jour."}),
    ComboType("MEGA_ACCA", "ELITE", "ACCA", 3, {"en": "Mega Combo", "fr": "Méga Combiné"},
              {"en": "High-odds combination built from solid picks.", "fr": "Combiné à grosse cote construit à partir de pronostics solides."}),
    ComboType("VALUE_FIVE", "ELITE", "ACCA", 3, {"en": "Value Five", "fr": "Cinq Value"},
              {"en": "Five positive-expected-value picks across all markets.", "fr": "Cinq pronostics à espérance positive sur tous les marchés."}),
    ComboType("CORRECT_SCORE", "ELITE", "SINGLES", 3, {"en": "Correct Score Picks", "fr": "Scores Exacts"},
              {"en": "The most likely exact scores — single tips.", "fr": "Les scores exacts les plus probables — pronostics simples."}),
]  # fmt: skip
COMBO_BY_TYPE = {c.type: c for c in COMBO_TYPES}


@dataclass
class Candidate:
    match_id: str
    league_key: str
    league_tier: int
    kickoff: datetime
    markets: list[Market]
    data_quality: str
    disagreement: float = 0.0
    ai_stance: str | None = None  # BACK | LEAN | AVOID (only when the optional AI layer ran)
    ai_market: str | None = None


@dataclass
class Pick:
    cand: Candidate
    market: Market
    odds: float
    estimated: bool
    score: float


@dataclass
class BuiltCombo:
    type: str
    min_plan: str
    kind: str
    selections: list[dict] = field(default_factory=list)
    total_odds: float = 1.0
    probability: float = 1.0
    odds_estimated: bool = False


Accept = Callable[[Market, float, bool], bool]
Score = Callable[[Market, float], float]


def _quality(c: Candidate) -> float:
    base = 1.0 if c.data_quality == "HIGH" else 0.97 if c.data_quality == "MEDIUM" else 0.85
    return base - min(c.disagreement, 0.3) * 0.5


def _ai_factor(c: Candidate, m: Market) -> float:
    if c.ai_market != m["key"]:
        return 1.0
    return 1.05 if c.ai_stance == "BACK" else 1.02 if c.ai_stance == "LEAN" else 1.0


def _best_pick(c: Candidate, groups: tuple[str, ...], accept: Accept, score: Score) -> Pick | None:
    best: Pick | None = None
    for m in c.markets:
        if m["group"] not in groups:
            continue
        odds, est = effective_odds(m)
        if not accept(m, odds, est):
            continue
        s = score(m, odds) * _quality(c) * _ai_factor(c, m)
        if best is None or s > best.score:
            best = Pick(c, m, odds, est, s)
    return best


def _assemble(
    cands: list[Candidate],
    groups: tuple[str, ...],
    accept: Accept,
    count: int,
    score: Score = lambda m, o: m["probability"],
    max_per_league: int | None = None,
    avoid: set[str] | None = None,
    target_odds: float | None = None,
) -> list[Pick]:
    ranked = sorted((p for c in cands if (p := _best_pick(c, groups, accept, score))), key=lambda p: p.score, reverse=True)
    if avoid:  # prefer matches not already used by sibling combos
        ranked = [p for p in ranked if p.cand.match_id not in avoid] + [p for p in ranked if p.cand.match_id in avoid]
    chosen: list[Pick] = []
    per_league: dict[str, int] = {}
    total = 1.0
    for p in ranked:
        if len(chosen) >= count:
            break
        if target_odds and total >= target_odds and len(chosen) >= 3:
            break
        n = per_league.get(p.cand.league_key, 0)
        if max_per_league and n >= max_per_league:
            continue
        chosen.append(p)
        per_league[p.cand.league_key] = n + 1
        total *= p.odds
    return sorted(chosen, key=lambda p: p.cand.kickoff)


def _to_combo(ct: ComboType, picks: list[Pick]) -> BuiltCombo:
    sels = [
        {"match_id": p.cand.match_id, "market": p.market["key"], "odds": round(p.odds, 2), "probability": p.market["probability"], "odds_estimated": p.estimated}
        for p in picks
    ]
    if ct.kind == "ACCA":
        total, prob = 1.0, 1.0
        for s in sels:
            total *= s["odds"]
            prob *= s["probability"]
    else:
        total = sum(s["odds"] for s in sels) / len(sels)
        prob = sum(s["probability"] for s in sels) / len(sels)
    return BuiltCombo(ct.type, ct.min_plan, ct.kind, sels, round(total, 2), round(prob, 4), any(s["odds_estimated"] for s in sels))


def build_daily_combos(candidates: list[Candidate], now: datetime) -> list[BuiltCombo]:
    """Assumes selections are independent (one pick per match) when combining probabilities."""
    cutoff = now + timedelta(minutes=10)
    pool = [c for c in candidates if c.kickoff > cutoff and c.ai_stance != "AVOID"]

    def tier(t: int) -> list[Candidate]:
        return [c for c in pool if c.league_tier <= t]

    result_only, playable = ("RESULT",), ("RESULT", "GOALS")
    out: list[BuiltCombo] = []
    used: set[str] = set()

    def add(type_: str, picks: list[Pick], minimum: int, mark: bool = False) -> None:
        if len(picks) >= minimum:
            out.append(_to_combo(COMBO_BY_TYPE[type_], picks))
            if mark:
                used.update(p.cand.match_id for p in picks)

    add("SAFE_DOUBLE", _assemble(tier(1), result_only, lambda m, o, e: 1.2 <= o <= 1.8, 2, max_per_league=1), 2, mark=True)
    add("DAILY_TREBLE", _assemble(tier(1), result_only, lambda m, o, e: 1.3 <= o <= 2.3, 3, max_per_league=2, avoid=used), 3, mark=True)

    add(
        "GOALS_GALORE",
        _assemble(
            tier(2),
            ("GOALS",),
            lambda m, o, e: (m["key"] == "OU25_O" and m["probability"] >= 0.56) or (m["key"] == "OU15_O" and m["probability"] >= 0.76 and o >= 1.15),
            4,
            score=lambda m, o: m["probability"] * (1.12 if m["key"] == "OU25_O" else 1),
            max_per_league=2,
        ),
        3,
    )
    add("BTTS_SPECIAL", _assemble(tier(2), ("GOALS",), lambda m, o, e: m["key"] == "BTTS_Y" and m["probability"] >= 0.54, 3, max_per_league=2), 3)
    value: Score = lambda m, o: m["probability"] * (1 + m.get("edge", 0))
    add(
        "VALUE_FOUR",
        _assemble(tier(2), playable, lambda m, o, e: not e and m.get("edge", 0) >= 0.03 and m["probability"] >= 0.42, 4, score=value, max_per_league=2),
        3,
    )

    add("ELITE_BANKER", _assemble(tier(3), playable, lambda m, o, e: o >= 1.3, 1), 1)
    add("MEGA_ACCA", _assemble(tier(3), playable, lambda m, o, e: m["probability"] >= 0.6 and o >= 1.25, 8, max_per_league=2, target_odds=10), 5)
    add(
        "VALUE_FIVE",
        _assemble(tier(3), playable, lambda m, o, e: not e and m.get("edge", 0) >= 0.02 and m["probability"] >= 0.38, 5, score=value, max_per_league=2),
        4,
    )
    add("CORRECT_SCORE", _assemble(tier(3), ("SCORE",), lambda m, o, e: True, 3), 2)
    return out
