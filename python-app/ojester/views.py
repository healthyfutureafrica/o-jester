"""Plan-gated, localised view models for templates. Locked data never reaches the page."""

from __future__ import annotations

from .combos.builder import COMBO_BY_TYPE
from .db import Combo, Match
from .leagues import league_tier
from .pipeline import combo_lock_time
from .plans import limits_for, plan_at_least, plan_for_league_tier
from .predictions.engine import confidence_for, pick_best
from .predictions.markets import market_label, market_short, settle_market
from .util import loads, utc_now


def _lock(m: Match, plan: str | None, early_locked: bool) -> dict:
    tier = league_tier(m.league_key)
    required = plan_for_league_tier(tier)
    if not plan:
        return {"locked": True, "lock_reason": "SUBSCRIBE", "required_plan": required}
    if early_locked:
        return {"locked": True, "lock_reason": "EARLY_ACCESS", "required_plan": "ELITE"}
    if limits_for(plan).league_tier < tier:
        return {"locked": True, "lock_reason": "UPGRADE", "required_plan": required}
    return {"locked": False}


def market_view(x: dict, m: Match, plan: str | None, lang: str) -> dict:
    v = {
        "key": x["key"],
        "group": x["group"],
        "label": market_label(x["key"], m.home_team, m.away_team, lang),
        "short": market_short(x["key"], lang),
        "probability": x["probability"],
        "fair_odds": x["fair_odds"],
        "book_odds": x.get("book_odds"),
        "edge": x.get("edge") if limits_for(plan).value_edges else None,
        "result": None,
    }
    if m.status == "FINISHED" and m.home_goals is not None and m.away_goals is not None:
        v["result"] = settle_market(x["key"], m.home_goals, m.away_goals)
    return v


def _base(m: Match) -> dict:
    return {
        "id": m.id,
        "league_key": m.league_key,
        "league_name": m.league_name,
        "country": m.country,
        "league_tier": league_tier(m.league_key),
        "kickoff": m.kickoff,
        "match_date": m.match_date,
        "status": m.status,
        "home_team": m.home_team,
        "away_team": m.away_team,
        "home_logo": m.home_logo,
        "away_logo": m.away_logo,
        "home_goals": m.home_goals,
        "away_goals": m.away_goals,
    }


def _core(m: Match, plan: str | None, lang: str) -> tuple[dict, list[dict], dict | None]:
    p = m.prediction
    limits = limits_for(plan)
    markets = loads(p.markets, [])
    meta = loads(p.meta, {})
    ai = loads(p.ai_analysis)
    best = pick_best(markets, [g for g in limits.market_groups if g != "SCORE"])
    if not best:
        conf = 0
    elif best["key"] == p.best_market:
        conf = p.confidence
    else:
        conf = confidence_for(best, p.data_quality, meta.get("disagreement", 0), (ai or {}).get("confidence_delta", 0))
    prob = {x["key"]: x["probability"] for x in markets}
    view = {
        "best_pick": market_view(best, m, plan, lang) if best else None,
        "confidence": conf,
        "probs": {"home": prob.get("1X2_H", 0), "draw": prob.get("1X2_D", 0), "away": prob.get("1X2_A", 0)},
        "xg": {"home": p.lambda_home, "away": p.lambda_away},
        "data_quality": p.data_quality,
        "ai_stance": ai["stance"] if ai and limits.ai_access != "none" else None,
    }
    return view, markets, ai


def match_list_item(m: Match, plan: str | None, lang: str, early_locked: bool = False) -> dict:
    lock = _lock(m, plan, early_locked)
    item = {**_base(m), **lock, "prediction": None}
    if not lock["locked"] and m.prediction:
        item["prediction"] = _core(m, plan, lang)[0]
    return item


def match_detail(m: Match, plan: str | None, lang: str, early_locked: bool = False) -> dict:
    lock = _lock(m, plan, early_locked)
    out = {**_base(m), **lock, "prediction": None, "stats": None}
    if lock["locked"] or not m.prediction:
        return out
    limits = limits_for(plan)
    view, markets, ai = _core(m, plan, lang)
    ai_view = None
    if ai and limits.ai_access != "none":
        text = ai.get(lang) or ai["en"]
        ai_view = {
            "headline": text["headline"],
            "summary": text["summary"],
            "key_factors": text["key_factors"],
            "stance": ai["stance"],
            "verdict_label": market_label(ai["market"], m.home_team, m.away_team, lang),
            "reasoning": text["reasoning"],
            "deep": limits.ai_access == "deep",
            "team_news": text["team_news"] if limits.ai_access == "deep" else [],
            "risks": text["risks"] if limits.ai_access == "deep" else [],
            "sources": ai.get("sources", []) if limits.ai_access == "deep" else [],
        }
    groups: dict[str, list[dict]] = {}
    for x in markets:
        if x["group"] in limits.market_groups:
            groups.setdefault(x["group"], []).append(market_view(x, m, plan, lang))
    out["prediction"] = {
        **view,
        "summary": (loads(m.prediction.summary, {}) or {}).get(lang, ""),
        "groups": groups,
        "top_scores": loads(m.prediction.top_scores, []) if "SCORE" in limits.market_groups else None,
        "ai": ai_view,
        "ai_locked": "PRO" if limits.ai_access == "none" else "ELITE" if limits.ai_access == "summary" else None,
    }
    stats = loads(m.team_stats)
    if stats:
        out["stats"] = {"home": stats.get("home"), "away": stats.get("away")}
    return out


def combo_view(c: Combo, plan: str | None, lang: str, early_locked: bool = False) -> dict:
    now = utc_now()
    ct = COMBO_BY_TYPE.get(c.type)
    locked = early_locked or not plan_at_least(plan, c.min_plan)
    started = any(s.match.kickoff <= now for s in c.selections)
    view = {
        "id": c.id,
        "date": c.date,
        "type": c.type,
        "title": ct.title[lang] if ct else c.type,
        "description": ct.description[lang] if ct else "",
        "min_plan": "ELITE" if early_locked else c.min_plan,
        "kind": c.kind,
        "total_odds": c.total_odds,
        "probability": c.probability,
        "odds_estimated": c.odds_estimated,
        "status": c.status,
        "provisional": now < combo_lock_time(c.date) and not started,
        "count": len(c.selections),
        "won_count": sum(1 for s in c.selections if s.result == "WON"),
        "locked": locked,
        "lock_reason": "EARLY_ACCESS" if early_locked else ("SUBSCRIBE" if not plan else "UPGRADE"),
        "selections": None,
    }
    if not locked:
        view["selections"] = [
            {
                "match_id": s.match_id,
                "league_name": s.match.league_name,
                "kickoff": s.match.kickoff,
                "home_team": s.match.home_team,
                "away_team": s.match.away_team,
                "market": s.market,
                "short": market_short(s.market, lang),
                "label": market_label(s.market, s.match.home_team, s.match.away_team, lang),
                "odds": s.odds,
                "probability": s.probability,
                "result": s.result,
                "score": f"{s.match.home_goals}-{s.match.away_goals}" if s.match.home_goals is not None else None,
            }
            for s in c.selections
        ]
    return view
