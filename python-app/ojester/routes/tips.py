"""Prediction pages: daily combos, match list, match detail and the custom tip builder."""

from __future__ import annotations

from datetime import timedelta

from flask import Blueprint, abort, g, redirect, render_template, request, session, url_for
from sqlalchemy import func, select

from .. import queries
from ..ai import service as ai
from ..db import AiUsage, Match, db
from ..i18n import t
from ..pipeline import app_today, combo_lock_time
from ..plans import PLANS
from ..predictions.markets import is_market_key
from ..util import add_days, utc_now
from ..views import match_detail
from . import safe_next

bp = Blueprint("tips", __name__)


def _date_or_error(template: str, **ctx):
    try:
        return queries.resolve_date(request.args.get("date"), g.plan), None
    except queries.AccessError as err:
        return None, render_template(template, error=t(err.key, g.lang), required_plan=err.required_plan, **ctx)


def _day_tabs() -> list[tuple[str, str]]:
    today = app_today()
    return [(add_days(today, -1), "date.yesterday"), (today, "date.today"), (add_days(today, 1), "date.tomorrow")]


@bp.get("/app")
def combos():
    resolved, err = _date_or_error("pages/combos.html", combos=[], tabs=_day_tabs(), day=None)
    if err:
        return err
    day, early = resolved
    return render_template(
        "pages/combos.html",
        combos=queries.list_combos(day, g.plan, g.lang, early),
        day=day,
        tabs=_day_tabs(),
        lock_at=combo_lock_time(day),
        now=utc_now(),
    )


@bp.get("/app/matches")
def matches():
    resolved, err = _date_or_error("pages/matches.html", groups=[], tabs=_day_tabs(), day=None, leagues=[])
    if err:
        return err
    day, early = resolved
    items = queries.list_matches(day, g.plan, g.lang, early)
    league = request.args.get("league", "all")
    q = request.args.get("q", "").strip().lower()
    sort = request.args.get("sort", "league")
    leagues = sorted({(m["league_key"], f"{m['league_name']} ({m['country']})") for m in items}, key=lambda x: x[1])
    filtered = [
        m
        for m in items
        if (league == "all" or m["league_key"] == league) and (not q or q in m["home_team"].lower() or q in m["away_team"].lower())
    ]
    if sort == "confidence":
        filtered.sort(key=lambda m: -(m["prediction"]["confidence"] if m["prediction"] else -1))
        groups = [(t("matches.highest", g.lang), filtered)] if filtered else []
    else:
        by_league: dict[str, list] = {}
        for m in filtered:
            by_league.setdefault(f"{m['league_tier']}|{m['league_name']} · {m['country']}", []).append(m)
        groups = [(k.split("|", 1)[1], v) for k, v in sorted(by_league.items())]
    return render_template(
        "pages/matches.html",
        groups=groups,
        day=day,
        tabs=_day_tabs(),
        leagues=leagues,
        total=len(items),
        league=league,
        q=q,
        sort=sort,
    )


@bp.get("/app/matches/<match_id>")
def match(match_id: str):
    m = db.get(Match, match_id)
    if not m:
        abort(404)
    try:
        _, early = queries.resolve_date(m.match_date, g.plan)
    except queries.AccessError as err:
        return render_template("pages/match.html", m=None, error=t(err.key, g.lang), required_plan=err.required_plan)
    detail = match_detail(m, g.plan, g.lang, early)
    slip_keys = {(s["match_id"], s["market"]) for s in session.get("slip", [])}
    return render_template(
        "pages/match.html",
        m=detail,
        slip_keys=slip_keys,
        can_build=g.limits.builder_max_picks > 0,
        open=m.status == "SCHEDULED" and m.kickoff > utc_now(),
    )


# --- Tip builder (selections kept in the signed session cookie) -------------


@bp.post("/slip/toggle")
def slip_toggle():
    match_id, market = request.form.get("match_id", ""), request.form.get("market", "")
    if g.user and g.limits.builder_max_picks > 0 and is_market_key(market):
        slip = [s for s in session.get("slip", []) if s["match_id"] != match_id]
        if not any(s["match_id"] == match_id and s["market"] == market for s in session.get("slip", [])):
            slip.append({"match_id": match_id, "market": market})
        session["slip"] = slip[-30:]
    return redirect(safe_next(request.form.get("next"), url_for("tips.builder")))


@bp.post("/slip/remove")
def slip_remove():
    match_id = request.form.get("match_id", "")
    session["slip"] = [s for s in session.get("slip", []) if s["match_id"] != match_id]
    return redirect(url_for("tips.builder"))


@bp.post("/slip/clear")
def slip_clear():
    session["slip"] = []
    return redirect(url_for("tips.builder"))


def _builder_page(review: dict | None = None, review_error: str | None = None):
    selections = session.get("slip", [])
    evaluation, error = None, None
    if g.user and g.limits.builder_max_picks > 0 and selections:
        try:
            evaluation = queries.evaluate_slip(selections, g.plan, g.lang)
        except queries.AccessError as err:
            error = t(err.key, g.lang, **err.vars)
    reviews_left = None
    if g.user and g.limits.slip_reviews_per_day:
        used = db.scalar(
            select(func.count()).select_from(AiUsage).where(AiUsage.user_id == g.user.id, AiUsage.kind == "SLIP_REVIEW", AiUsage.created_at >= utc_now() - timedelta(hours=24))
        )
        reviews_left = max(0, g.limits.slip_reviews_per_day - (used or 0))
    return render_template(
        "pages/builder.html",
        evaluation=evaluation,
        error=error,
        review=review,
        review_error=review_error,
        reviews_left=reviews_left,
        ai_enabled=ai.ai_enabled,
    )


@bp.get("/app/builder")
def builder():
    return _builder_page()


@bp.post("/slip/review")
def slip_review():
    if not g.user or g.plan != "ELITE":
        return redirect(url_for("public.pricing", plan="ELITE"))
    if not ai.ai_enabled:
        return _builder_page(review_error=t("slip.aiDisabled", g.lang))
    per_day = PLANS["ELITE"].limits.slip_reviews_per_day
    used = db.scalar(
        select(func.count()).select_from(AiUsage).where(AiUsage.user_id == g.user.id, AiUsage.kind == "SLIP_REVIEW", AiUsage.created_at >= utc_now() - timedelta(hours=24))
    )
    if (used or 0) >= per_day:
        return _builder_page(review_error=t("slip.reviewLimit", g.lang, n=per_day))
    try:
        ev = queries.evaluate_slip(session.get("slip", []), g.plan, g.lang)
    except queries.AccessError as err:
        return _builder_page(review_error=t(err.key, g.lang, **err.vars))
    legs = [
        {
            "match_id": leg["match_id"],
            "fixture": f"{leg['home_team']} v {leg['away_team']}",
            "competition": leg["league_name"],
            "selection": leg["label"],
            "model_probability_pct": round(leg["probability"] * 100, 1),
            "odds": leg["odds"],
            "ai_stance": (leg["ai"] or {}).get("stance"),
            "team_news": ((leg["ai"] or {}).get("en") or {}).get("team_news"),
        }
        for leg in ev["legs"]
    ]
    review = ai.review_slip(legs, {"odds": ev["total_odds"], "probability_pct": round(ev["probability"] * 100, 1)}, g.lang)
    if not review:
        return _builder_page(review_error=t("slip.aiUnavailable", g.lang))
    db.add(AiUsage(user_id=g.user.id, kind="SLIP_REVIEW"))
    db.commit()
    return _builder_page(review=review)
