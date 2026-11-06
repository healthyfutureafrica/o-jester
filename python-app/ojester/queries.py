"""Read-side queries shared by the page routes."""

from __future__ import annotations

from sqlalchemy import func, select

from .combos.builder import COMBO_TYPES
from .db import Combo, Match, Prediction, db
from .leagues import BY_KEY, league_tier
from .pipeline import app_today
from .plans import limits_for
from .predictions.engine import confidence_for, effective_odds, pick_best
from .predictions.markets import is_market_key, market_label, market_short, settle_market
from .util import add_days, is_date_str, loads, utc_now
from .views import combo_view, match_list_item


class AccessError(Exception):
    """Raised when a plan may not view the requested data. `key` is an i18n message key."""

    def __init__(self, key: str, required_plan: str | None = None, **vars):
        super().__init__(key)
        self.key, self.required_plan, self.vars = key, required_plan, vars


def resolve_date(raw: str | None, plan: str | None) -> tuple[str, bool]:
    """Validate a requested date against the plan's history window. Returns (date, early_access_locked)."""
    today = app_today()
    day = raw or today
    if not is_date_str(day):
        raise AccessError("validation.date")
    limits = limits_for(plan)
    if day < add_days(today, -limits.history_days):
        raise AccessError("dates.history", "PRO" if limits.history_days < 30 else "ELITE")
    if day > add_days(today, 1):
        raise AccessError("dates.ahead")
    return day, day > add_days(today, limits.days_ahead)


def list_matches(day: str, plan: str | None, lang: str, early_locked: bool) -> list[dict]:
    matches = db.scalars(select(Match).where(Match.match_date == day).order_by(Match.kickoff, Match.league_name)).all()
    return [match_list_item(m, plan, lang, early_locked) for m in matches]


def list_combos(day: str, plan: str | None, lang: str, early_locked: bool) -> list[dict]:
    order = {c.type: i for i, c in enumerate(COMBO_TYPES)}
    combos = sorted(db.scalars(select(Combo).where(Combo.date == day)), key=lambda c: order.get(c.type, 99))
    return [combo_view(c, plan, lang, early_locked) for c in combos]


def teaser(lang: str) -> dict:
    """Free daily sample tip: the strongest Top-5 result pick of the day (shown on the home page)."""
    today = app_today()
    now = utc_now()
    total = db.scalar(select(func.count()).select_from(Match).where(Match.match_date == today)) or 0
    best = None
    rows = db.execute(
        select(Match, Prediction).join(Prediction, Prediction.match_id == Match.id).where(Match.match_date == today, Match.status == "SCHEDULED", Match.kickoff > now)
    ).all()
    for m, p in rows:
        if league_tier(m.league_key) != 1:
            continue
        pick = pick_best(loads(p.markets, []), ["RESULT"])
        if pick and (best is None or pick["probability"] > best[2]["probability"]):
            best = (m, p, pick)
    if not best:
        return {"fixtures_today": total, "pick": None}
    m, p, pick = best
    return {
        "fixtures_today": total,
        "pick": {
            "match_id": m.id,
            "league_name": m.league_name,
            "kickoff": m.kickoff,
            "home_team": m.home_team,
            "away_team": m.away_team,
            "short": market_short(pick["key"], lang),
            "label": market_label(pick["key"], m.home_team, m.away_team, lang),
            "probability": pick["probability"],
            "odds": pick.get("book_odds"),
            "confidence": confidence_for(pick, p.data_quality, (loads(p.meta) or {}).get("disagreement", 0)),
        },
    }


def _rate(won: int, settled: int):
    return round(won / settled * 100, 1) if settled else None


def results(days: int, plan: str | None, lang: str) -> dict:
    today = app_today()
    start = add_days(today, -days)
    combos = db.scalars(select(Combo).where(Combo.date >= start, Combo.date <= today, Combo.status != "PENDING").order_by(Combo.date.desc())).all()
    preds = db.execute(
        select(Prediction.best_market, Match.home_goals, Match.away_goals).join(Match).where(Match.match_date >= start, Match.match_date <= today, Match.status == "FINISHED")
    ).all()

    accas = [c for c in combos if c.kind == "ACCA" and c.status != "VOID"]
    won_accas = [c for c in accas if c.status == "WON"]
    legs = [s for c in combos for s in c.selections if s.result in ("WON", "LOST")]
    best = [(mk, h, a) for mk, h, a in preds if h is not None and a is not None]
    best_won = sum(1 for mk, h, a in best if settle_market(mk, h, a) == "WON")

    by_type = []
    for ct in COMBO_TYPES:
        of_type = [c for c in combos if c.type == ct.type and c.status != "VOID"]
        type_legs = [s for c in of_type for s in c.selections if s.result in ("WON", "LOST")]
        if ct.kind == "ACCA":
            won, settled = sum(1 for c in of_type if c.status == "WON"), len(of_type)
        else:
            won, settled = sum(1 for s in type_legs if s.result == "WON"), len(type_legs)
        by_type.append({"type": ct.type, "title": ct.title[lang], "min_plan": ct.min_plan, "kind": ct.kind, "won": won, "settled": settled, "rate": _rate(won, settled)})

    history_from = add_days(today, -limits_for(plan).history_days)
    return {
        "days": days,
        "combos": {"won": len(won_accas), "settled": len(accas), "rate": _rate(len(won_accas), len(accas))},
        "legs": {"won": sum(1 for s in legs if s.result == "WON"), "settled": len(legs), "rate": _rate(sum(1 for s in legs if s.result == "WON"), len(legs))},
        "best": {"won": best_won, "settled": len(best), "rate": _rate(best_won, len(best))},
        "avg_odds": round(sum(c.total_odds for c in won_accas) / len(won_accas), 2) if won_accas else None,
        "by_type": by_type,
        "recent": [combo_view(c, plan, lang) for c in combos if c.date >= history_from][:60],
        "history_days": limits_for(plan).history_days,
    }


def evaluate_slip(selections: list[dict], plan: str | None, lang: str) -> dict:
    """Validate and price a user-built combination. Raises AccessError on entitlement problems."""
    limits = limits_for(plan)
    if len(selections) > limits.builder_max_picks:
        raise AccessError("slip.maxPicks", "ELITE", n=limits.builder_max_picks)
    ids = [s["match_id"] for s in selections]
    matches = {m.id: m for m in db.scalars(select(Match).where(Match.id.in_(ids)))}
    now = utc_now()
    warnings, legs = [], []
    for s in selections:
        m = matches.get(s["match_id"])
        if not m or not m.prediction or not is_market_key(s["market"]):
            continue
        fixture = f"{m.home_team} – {m.away_team}"
        if league_tier(m.league_key) > limits.league_tier:
            raise AccessError("slip.leagueNotInPlan", league=m.league_name)
        market = next((x for x in loads(m.prediction.markets, []) if x["key"] == s["market"]), None)
        if not market or market["group"] not in limits.market_groups:
            raise AccessError("slip.marketNotInPlan")
        if m.status != "SCHEDULED" or m.kickoff <= now:
            warnings.append(("slip.warnStarted", {"match": fixture}))
        ai = loads(m.prediction.ai_analysis)
        if ai and ai.get("stance") == "AVOID":
            warnings.append(("slip.warnAvoid", {"match": fixture}))
        odds, est = effective_odds(market)
        legs.append(
            {
                "match_id": m.id,
                "league_name": m.league_name,
                "kickoff": m.kickoff,
                "home_team": m.home_team,
                "away_team": m.away_team,
                "market": market["key"],
                "short": market_short(market["key"], lang),
                "label": market_label(market["key"], m.home_team, m.away_team, lang),
                "odds": round(odds, 2),
                "estimated": est,
                "probability": market["probability"],
                "edge": market.get("edge") if limits.value_edges else None,
                "ai": ai,
            }
        )
    total, prob = 1.0, 1.0
    for leg in legs:
        total *= leg["odds"]
        prob *= leg["probability"]
    if len(legs) >= 6 and prob < 0.05:
        warnings.append(("slip.warnLong", {}))
    return {"legs": legs, "total_odds": round(total, 2), "probability": round(prob, 4), "estimated": any(l["estimated"] for l in legs), "warnings": warnings}


def league_catalogue() -> dict[int, list]:
    out: dict[int, list] = {1: [], 2: [], 3: []}
    for lg in BY_KEY.values():
        out[lg.tier].append(lg)
    return out
