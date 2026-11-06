"""Prediction engine: stats-based ratings blended with bookmaker-implied probabilities.

No AI is needed here — this is a pure statistical model.
"""

from __future__ import annotations

from typing import Any

from .markets import BASE_MARKETS, market_group
from .poisson import fit_lambdas, markets_from_matrix, score_matrix, top_scores

MODEL_VERSION = "oj-dixon-coles-1.0"
DEFAULT_LEAGUE = {"avg_home_goals": 1.5, "avg_away_goals": 1.2}
SHRINK_GAMES = 5  # pseudo-games of league-average performance mixed into each rating
MARKET_WEIGHT = 0.55  # weight of the bookmaker-implied model when both sources exist
ESTIMATED_MARGIN = 0.93  # typical bookmaker margin applied to fair odds when real odds are missing

Market = dict[str, Any]


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _shrink(ratio: float, games: float) -> float:
    return (ratio * games + SHRINK_GAMES) / (games + SHRINK_GAMES)


def form_score(form: str | None) -> float | None:
    if not form:
        return None
    recent = "".join(c for c in form.upper() if c in "WDL")[-5:]
    if len(recent) < 3:
        return None
    pts = sum(3 if c == "W" else 1 if c == "D" else 0 for c in recent)
    return pts / (len(recent) * 3)


def stats_lambdas(stats: dict) -> tuple[float, float] | None:
    """Goal expectations from season attack/defence ratings relative to the league average."""
    home, away = stats.get("home"), stats.get("away")
    if not home or not away or home["played"] < 3 or away["played"] < 3:
        return None
    lg = stats.get("league") or DEFAULT_LEAGUE
    if lg.get("avg_home_goals", 0) <= 0 or lg.get("avg_away_goals", 0) <= 0:
        lg = DEFAULT_LEAGUE

    def split(team: dict, venue: str) -> tuple[float, float, float]:
        n = team["home_played"] if venue == "home" else team["away_played"]
        if n >= 2:
            if venue == "home":
                return team["home_gf"] / n, team["home_ga"] / n, n
            return team["away_gf"] / n, team["away_ga"] / n, n
        adv = 1.1 if venue == "home" else 0.9
        return team["gf"] / team["played"] * adv, team["ga"] / team["played"] / adv, team["played"]

    h_gf, h_ga, hn = split(home, "home")
    a_gf, a_ga, an = split(away, "away")
    lh = lg["avg_home_goals"] * _shrink(h_gf / lg["avg_home_goals"], hn) * _shrink(a_ga / lg["avg_home_goals"], an)
    la = lg["avg_away_goals"] * _shrink(a_gf / lg["avg_away_goals"], an) * _shrink(h_ga / lg["avg_away_goals"], hn)

    fh, fa = form_score(home.get("form")), form_score(away.get("form"))
    if fh is not None and fa is not None:
        d = fh - fa
        lh *= 1 + 0.12 * d
        la *= 1 - 0.12 * d
    return _clamp(lh, 0.15, 4.5), _clamp(la, 0.15, 4.5)


def implied_from_odds(odds: dict) -> dict | None:
    """Margin-free probabilities implied by bookmaker odds."""
    h, d, a = odds.get("1X2_H", 0), odds.get("1X2_D", 0), odds.get("1X2_A", 0)
    if not (h > 1 and d > 1 and a > 1):
        return None
    s = 1 / h + 1 / d + 1 / a
    target = {"home": 1 / h / s, "draw": 1 / d / s, "away": 1 / a / s, "over25": None}
    o, u = odds.get("OU25_O", 0), odds.get("OU25_U", 0)
    if o > 1 and u > 1:
        target["over25"] = (1 / o) / (1 / o + 1 / u)
    return target


def effective_odds(m: Market) -> tuple[float, bool]:
    """(odds, estimated) — real bookmaker odds if known, else fair odds minus a typical margin."""
    if m.get("book_odds", 0) > 1:
        return m["book_odds"], False
    return max(1.01, round(m["fair_odds"] * ESTIMATED_MARGIN, 2)), True


def _make_market(key: str, probability: float, book: float | None) -> Market:
    p = _clamp(probability, 0.0001, 0.9999)
    m: Market = {"key": key, "group": market_group(key), "probability": round(p, 4), "fair_odds": round(min(1 / p, 500), 2)}
    if book and book > 1:
        m["book_odds"] = round(book, 2)
        m["edge"] = round(p * book - 1, 3)
    return m


def pick_best(markets: list[Market], groups: tuple[str, ...] | list[str], min_odds: float = 1.3) -> Market | None:
    """Most likely selection that still pays meaningful odds, with a small bonus for positive value."""
    eligible = [m for m in markets if m["group"] in groups and m["group"] != "SCORE"]
    if not eligible:
        return None
    playable = [m for m in eligible if effective_odds(m)[0] >= min_odds] or eligible
    return max(playable, key=lambda m: m["probability"] + 0.3 * max(m.get("edge", 0), 0))


def confidence_for(pick: Market, quality: str, disagreement: float = 0, ai_delta: int = 0) -> int:
    c = pick["probability"] * 100
    if quality == "HIGH":
        c += 4
    if quality == "LOW":
        c -= 12
    c -= disagreement * 50
    c += ai_delta
    return round(_clamp(c, 5, 97))


def _pct(p: float) -> str:
    return f"{round(p * 100)}%"


def build_summary(lang: str, home: str, away: str, lh: float, la: float, probs: dict) -> str:
    fr = lang == "fr"
    num = (lambda n: f"{n:.2f}".replace(".", ",")) if fr else (lambda n: f"{n:.2f}")
    xg = f"(buts attendus {num(lh)} – {num(la)})." if fr else f"(expected goals {num(lh)} – {num(la)})."
    h, d, a = probs["1X2_H"], probs["1X2_D"], probs["1X2_A"]
    if abs(h - a) < 0.08:
        parts = [f"Match équilibré entre {home} et {away} {xg}" if fr else f"An evenly matched contest between {home} and {away} {xg}"]
    elif h > a:
        parts = [f"{home} part favori à domicile face à {away} {xg}" if fr else f"{home} are favoured at home against {away} {xg}"]
    else:
        parts = [f"{away} part favori à l'extérieur chez {home} {xg}" if fr else f"{away} are favoured on the road at {home} {xg}"]
    parts.append(
        f"Modèle : {_pct(h)} victoire à domicile, {_pct(d)} nul, {_pct(a)} victoire à l'extérieur."
        if fr
        else f"Model: {_pct(h)} home win, {_pct(d)} draw, {_pct(a)} away win."
    )
    if probs["OU25_O"] >= 0.58:
        parts.append(f"Des buts sont attendus — plus de 2,5 buts à {_pct(probs['OU25_O'])}." if fr else f"Goals are expected — Over 2.5 at {_pct(probs['OU25_O'])}.")
    elif probs["OU25_U"] >= 0.58:
        parts.append(
            f"Un match serré et fermé est probable — moins de 2,5 buts à {_pct(probs['OU25_U'])}."
            if fr
            else f"A tight, low-scoring game is likely — Under 2.5 at {_pct(probs['OU25_U'])}."
        )
    else:
        parts.append("La ligne des 2,5 buts est très équilibrée." if fr else "The 2.5 goal line is finely balanced.")
    if probs["BTTS_Y"] >= 0.58:
        parts.append(f"Les deux équipes devraient marquer ({_pct(probs['BTTS_Y'])})." if fr else f"Both teams to score looks likely ({_pct(probs['BTTS_Y'])}).")
    return " ".join(parts)


def predict_match(home_team: str, away_team: str, stats: dict | None, odds: dict | None) -> dict:
    odds = odds or {}
    from_stats = stats_lambdas(stats) if stats else None
    target = implied_from_odds(odds) if odds else None
    from_market = fit_lambdas(target["home"], target["draw"], target["away"], target["over25"]) if target else None

    if from_stats and from_market:
        lh = MARKET_WEIGHT * from_market[0] + (1 - MARKET_WEIGHT) * from_stats[0]
        la = MARKET_WEIGHT * from_market[1] + (1 - MARKET_WEIGHT) * from_stats[1]
        quality = "HIGH"
    elif from_market or from_stats:
        lh, la = from_market or from_stats  # type: ignore[misc]
        quality = "MEDIUM"
    else:
        lh, la, quality = 1.45, 1.15, "LOW"

    disagreement = 0.0
    if from_stats and target:
        s = markets_from_matrix(score_matrix(*from_stats))
        disagreement = (abs(s["1X2_H"] - target["home"]) + abs(s["1X2_D"] - target["draw"]) + abs(s["1X2_A"] - target["away"])) / 3

    matrix = score_matrix(lh, la)
    probs = markets_from_matrix(matrix)
    scores = top_scores(matrix, 6)
    markets = [_make_market(k, probs[k], odds.get(k)) for k in BASE_MARKETS]
    for s in scores:
        key = f"CS_{s['home']}-{s['away']}"
        markets.append(_make_market(key, s["probability"], odds.get(key)))

    best = pick_best(markets, ("RESULT", "GOALS"))
    assert best is not None
    return {
        "lambda_home": round(lh, 3),
        "lambda_away": round(la, 3),
        "markets": markets,
        "top_scores": [{**s, "probability": round(s["probability"], 4)} for s in scores],
        "data_quality": quality,
        "best": best,
        "confidence": confidence_for(best, quality, disagreement),
        "summary": {lang: build_summary(lang, home_team, away_team, lh, la, probs) for lang in ("en", "fr")},
        "meta": {
            "stats_lambdas": [round(x, 3) for x in from_stats] if from_stats else None,
            "market_lambdas": [round(x, 3) for x in from_market] if from_market else None,
            "disagreement": round(disagreement, 4),
        },
        "model_version": MODEL_VERSION,
    }
