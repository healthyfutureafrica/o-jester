"""Public pages: home, pricing, track record, legal notice, language and age confirmation."""

from __future__ import annotations

from flask import Blueprint, g, make_response, redirect, render_template, request

from ..app import AGE_COOKIE, LANG_COOKIE
from ..i18n import LANGS, LEGAL
from ..plans import PLAN_IDS, PLANS
from .. import queries
from . import safe_next

bp = Blueprint("public", __name__)
ONE_YEAR = 365 * 24 * 3600


@bp.get("/")
def index():
    return render_template(
        "pages/landing.html",
        teaser=queries.teaser(g.lang),
        record=queries.results(30, g.plan, g.lang),
        plans=[PLANS[p] for p in PLAN_IDS],
    )


@bp.get("/pricing")
def pricing():
    return render_template(
        "pages/pricing.html",
        plans=[PLANS[p] for p in PLAN_IDS],
        highlight=request.args.get("plan"),
        leagues=queries.league_catalogue(),
    )


@bp.get("/results")
def results():
    days = request.args.get("days", "30")
    days = int(days) if days in ("7", "30", "90") else 30
    return render_template("pages/results.html", r=queries.results(days, g.plan, g.lang))


@bp.get("/legal")
def legal():
    pub = LEGAL["publisher"]
    # Details still in [brackets] are unfilled placeholders and are not shown publicly.
    contact = [v for v in (pub.get("address"), pub.get("email")) if v and not v.startswith("[")]
    return render_template("pages/legal.html", doc=LEGAL["docs"][g.lang], contact=contact)


@bp.route("/age-check", methods=["GET", "POST"])
def age_gate():
    nxt = safe_next(request.values.get("next"))
    if request.method == "GET":
        return render_template("pages/age_gate.html", next=nxt)
    if request.form.get("answer") == "adult":
        resp = make_response(redirect(nxt))
        resp.set_cookie(AGE_COOKIE, "yes", max_age=ONE_YEAR, httponly=True, samesite="Lax", secure=request.is_secure)
        return resp
    return render_template("pages/age_gate.html", next=nxt, denied=True)


@bp.get("/lang/<code>")
def set_lang(code: str):
    resp = make_response(redirect(safe_next(request.args.get("next"))))
    if code in LANGS:
        resp.set_cookie(LANG_COOKIE, code, max_age=ONE_YEAR, samesite="Lax")
    return resp
