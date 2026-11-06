"""Flask application factory: sessions, language, 18+ age gate, CSRF and template helpers."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from flask import Flask, Response, abort, g, redirect, render_template, request, session
from werkzeug.middleware.proxy_fix import ProxyFix

from . import fmt
from .config import settings
from .db import User, db, init_db
from .i18n import LEGAL, pick_lang, t
from .plans import PLANS, limits_for
from .subscriptions import current_plan

AGE_COOKIE = "oj_age"
LANG_COOKIE = "oj_lang"
#: Pages reachable before the visitor has confirmed being 18+.
AGE_GATE_EXEMPT = {"static", "public.legal", "public.age_gate", "public.set_lang", "api.flutterwave_webhook", "api.paypal_webhook", "api.health", "api.ready", "robots"}
CSRF_EXEMPT = {"api.flutterwave_webhook", "api.paypal_webhook"}

def create_app() -> Flask:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
    app = Flask(__name__)
    # Behind a hosting proxy (Render, nginx…) trust X-Forwarded-Proto/Host so HTTPS links and cookies are correct.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    app.config.update(
        SECRET_KEY=settings.secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure cookies whenever the site is served over HTTPS (always the case when hosted online).
        SESSION_COOKIE_SECURE=settings.app_url.startswith("https://"),
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        MAX_CONTENT_LENGTH=200 * 1024,
    )
    if settings.db_auto_create:
        init_db()

    canonical_host = urlsplit(settings.app_url).hostname or ""

    @app.before_request
    def redirect_to_canonical_host():
        # Visitors who open the host's default address (e.g. o-jester.onrender.com) are sent to the
        # public domain. API calls (health checks, payment webhooks) keep working on any host.
        host = request.host.split(":")[0].lower()
        if (
            canonical_host
            and host.endswith(".onrender.com")
            and host != canonical_host
            and request.method in ("GET", "HEAD")
            and not request.path.startswith("/api/")
        ):
            return redirect(settings.app_url + request.full_path.rstrip("?"), code=301)

    @app.before_request
    def load_context():
        g.lang = pick_lang(request.cookies.get(LANG_COOKIE), request.headers.get("Accept-Language"))
        g.user = None
        g.plan = None
        uid = session.get("uid")
        if uid:
            g.user = db.get(User, uid)
            if g.user:
                g.plan = current_plan(g.user.id)
            else:
                session.clear()
        g.limits = limits_for(g.plan)

        # Mandatory 18+ declaration before any content (legal notice stays readable).
        if request.endpoint not in AGE_GATE_EXEMPT and request.cookies.get(AGE_COOKIE) != "yes":
            if request.path.startswith("/api/"):
                abort(403)
            return render_template("pages/age_gate.html", next=request.full_path.rstrip("?"))

        if request.method == "POST" and request.endpoint not in CSRF_EXEMPT:
            sent = request.form.get("csrf") or request.headers.get("X-CSRF-Token")
            if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
                abort(400, description=t("auth.csrf", g.lang))

    @app.teardown_appcontext
    def remove_session(exc=None):
        db.remove()

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'; form-action 'self' https:",
        )
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        if settings.beta_mode:
            resp.headers.setdefault("X-Robots-Tag", "noindex, nofollow")
        return resp

    # --- Template helpers -------------------------------------------------

    def csrf_token() -> str:
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(32)
        return session["csrf"]

    app.jinja_env.globals.update(
        _=lambda key, **kw: t(key, g.lang, **kw),
        plan_name=lambda pid: PLANS[pid].name[g.lang] if pid in PLANS else pid,
        csrf_token=csrf_token,
        fmt_xaf=fmt.xaf,
        fmt_pct=fmt.pct,
        fmt_time=fmt.time_,
        fmt_date=fmt.date_,
        fmt_datetime=fmt.datetime_,
        fmt_euro=fmt.euro,
        settings=settings,
        legal=LEGAL,
        now_year=lambda: datetime.now().year,
    )
    app.jinja_env.filters["odds"] = lambda o: f"{o:.2f}"

    from .routes import account, admin, api, feedback, public, tips

    for bp in (public.bp, tips.bp, account.bp, admin.bp, api.bp, feedback.bp):
        app.register_blueprint(bp)

    @app.get("/robots.txt")
    def robots():
        # The beta test version stays out of search engines.
        rules = ["Disallow: /"] if settings.beta_mode else ["Disallow: /admin", "Disallow: /account"]
        return Response("\n".join(["User-agent: *", *rules]) + "\n", mimetype="text/plain")

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    def http_error(err):
        if request.path.startswith("/api/"):
            return {"error": err.description}, err.code
        return render_template("pages/error.html", code=err.code, message=err.description if err.code == 400 else None), err.code

    return app
