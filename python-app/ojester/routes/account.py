"""Accounts (18+ registration, login), profile, checkout and payment return pages."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import date, datetime

from flask import Blueprint, abort, g, redirect, render_template, request, session, url_for
from sqlalchemy import select
from werkzeug.security import check_password_hash, generate_password_hash

from .. import fmt
from ..db import Payment, User, db, utcnow
from ..i18n import t
from ..payments import service as payments
from ..plans import PLAN_IDS, PLAN_RANK, PLANS
from ..config import settings
from ..subscriptions import activate_plan, summary
from ..util import MIN_AGE, age_on
from . import safe_next

bp = Blueprint("account", __name__)

# Simple in-memory login/registration throttle: 20 attempts per IP per 15 minutes.
_attempts: dict[str, deque] = defaultdict(deque)


def _throttled() -> bool:
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
    q = _attempts[ip]
    now = time.time()
    while q and q[0] < now - 900:
        q.popleft()
    q.append(now)
    return len(q) > 20


def _login(user: User) -> None:
    session.clear()
    session.permanent = True
    session["uid"] = user.id


def _require_user():
    if not g.user:
        return redirect(url_for("account.login", next=request.full_path.rstrip("?")))
    return None


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("tips.combos"))
    error = None
    email = request.form.get("email", "").strip().lower()
    if request.method == "POST":
        if _throttled():
            error = t("auth.tooMany", g.lang)
        else:
            user = db.scalar(select(User).where(User.email == email))
            if user and check_password_hash(user.password_hash, request.form.get("password", "")):
                _login(user)
                return redirect(safe_next(request.args.get("next"), url_for("tips.combos")))
            error = t("auth.badCredentials", g.lang)
    return render_template("pages/login.html", error=error, email=email)


@bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("tips.combos"))
    form = {k: request.form.get(k, "").strip() for k in ("name", "email", "phone", "birth_date")}
    errors: dict[str, str] = {}
    error = None
    if request.method == "POST":
        if _throttled():
            error = t("auth.tooMany", g.lang)
        else:
            form["email"] = form["email"].lower()
            password = request.form.get("password", "")
            if not 2 <= len(form["name"]) <= 60:
                errors["name"] = t("validation.name", g.lang)
            if "@" not in form["email"] or "." not in form["email"].split("@")[-1]:
                errors["email"] = t("validation.email", g.lang)
            if len(password) < 8:
                errors["password"] = t("validation.password", g.lang)
            phone = "".join(c for c in form["phone"] if c.isdigit() or c == "+")
            if form["phone"] and not 8 <= len(phone.lstrip("+")) <= 15:
                errors["phone"] = t("validation.phone", g.lang)
            birth = None
            try:
                birth = date.fromisoformat(form["birth_date"])
                if not 0 <= age_on(birth) <= 120:
                    raise ValueError
            except ValueError:
                errors["birth_date"] = t("validation.birthDate", g.lang)
            if request.form.get("accept_terms") != "yes":
                errors["accept_terms"] = t("validation.terms", g.lang)
            # Legal age requirement — enforced on the server.
            if birth and age_on(birth) < MIN_AGE:
                error = t("auth.underage", g.lang)
            elif not errors and db.scalar(select(User).where(User.email == form["email"])):
                error = t("auth.emailTaken", g.lang)
            elif not errors:
                user = User(
                    name=form["name"],
                    email=form["email"],
                    phone=phone or None,
                    birth_date=datetime.combine(birth, datetime.min.time()),
                    terms_accepted_at=utcnow(),
                    password_hash=generate_password_hash(password),
                )
                db.add(user)
                db.commit()
                if settings.beta_mode and settings.beta_trial_plan in PLANS:
                    # Beta testers get a free trial so they can try every feature without paying.
                    activate_plan(user.id, settings.beta_trial_plan, days=settings.beta_trial_days, source="BETA_TRIAL")
                    db.commit()
                _login(user)
                plan = request.args.get("plan")
                return redirect(url_for("account.checkout", plan=plan) if plan in PLANS else url_for("tips.combos"))
            if errors and not error:
                error = next(iter(errors.values()))
    today = date.today()
    max_birth = date(today.year - MIN_AGE, today.month, min(today.day, 28)).isoformat()
    return render_template("pages/register.html", form=form, errors=errors, error=error, max_birth=max_birth)


@bp.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("public.index"))


@bp.route("/account", methods=["GET", "POST"])
def account():
    if (r := _require_user()) is not None:
        return r
    message, error = None, None
    if request.method == "POST":
        action = request.form.get("action")
        if action == "profile":
            name = request.form.get("name", "").strip()
            phone = "".join(c for c in request.form.get("phone", "") if c.isdigit() or c == "+")
            if not 2 <= len(name) <= 60:
                error = t("validation.name", g.lang)
            else:
                g.user.name, g.user.phone = name, phone or None
                db.commit()
                message = t("account.saved", g.lang)
        elif action == "password":
            if not check_password_hash(g.user.password_hash, request.form.get("current", "")):
                error = t("auth.currentPasswordWrong", g.lang)
            elif len(request.form.get("new", "")) < 8:
                error = t("validation.password", g.lang)
            else:
                g.user.password_hash = generate_password_hash(request.form["new"])
                db.commit()
                message = t("account.pwUpdated", g.lang)
    history = db.scalars(select(Payment).where(Payment.user_id == g.user.id).order_by(Payment.created_at.desc()).limit(50)).all()
    return render_template("pages/account.html", sub=summary(g.user.id), payments=history, message=message, error=error)


@bp.route("/checkout/<plan>", methods=["GET", "POST"])
def checkout(plan: str):
    if (r := _require_user()) is not None:
        return r
    if plan not in PLANS:
        abort(404)
    error = None
    method = request.form.get("method", "MOBILE_MONEY")
    phone = request.form.get("phone", g.user.phone or "")
    if request.method == "POST":
        if method not in payments.METHODS:
            error = t("validation.invalid", g.lang)
        elif method == "MOBILE_MONEY" and len("".join(c for c in phone if c.isdigit())) < 8:
            error = t("payment.phoneRequired", g.lang)
        else:
            norm = payments.normalise_phone(phone) if method == "MOBILE_MONEY" else None
            if norm and not g.user.phone:
                g.user.phone = norm
                db.commit()
            try:
                return redirect(payments.create_checkout(g.user, plan, method, norm))
            except payments.PaymentError as err:
                error = t(err.key, g.lang)
    sub = summary(g.user.id)
    note = None
    if sub:
        if sub["plan"] == plan:
            note = t("checkout.renewNote", g.lang, plan=PLANS[plan].name[g.lang], date=fmt.date_(sub["ends_at"]))
        elif PLAN_RANK[plan] > PLAN_RANK[sub["plan"]]:
            note = t("checkout.upgradeNote", g.lang, days=sub["days_left"], current=PLANS[sub["plan"]].name[g.lang], plan=PLANS[plan].name[g.lang])
        else:
            note = t("checkout.downgradeNote", g.lang, plan=PLANS[plan].name[g.lang], current=PLANS[sub["plan"]].name[g.lang], date=fmt.date_(sub["ends_at"]))
    methods = [(m, payments.method_available(m)) for m in payments.METHODS]
    eur = PLANS[plan].price_xaf / payments.XAF_PER_EUR
    return render_template("pages/checkout.html", plan=PLANS[plan], plans=PLAN_IDS, methods=methods, method=method, phone=phone, error=error, note=note, eur=eur)


def _own_payment(reference: str) -> Payment:
    p = db.scalar(select(Payment).where(Payment.reference == reference))
    if not p or p.user_id != g.user.id:
        abort(404)
    return p


@bp.get("/payment/return")
def payment_return():
    if (r := _require_user()) is not None:
        return r
    reference = request.args.get("reference") or request.args.get("tx_ref") or ""
    _own_payment(reference)
    hint = {"cancelled": True} if request.args.get("cancelled") or request.args.get("status") == "cancelled" else None
    try:
        p = payments.verify_payment(reference, hint)
    except Exception:  # noqa: BLE001 — provider unreachable: keep polling
        p = _own_payment(reference)
    attempts = int(request.args.get("n", "0") or 0)
    return render_template("pages/payment_return.html", p=p, sub=summary(g.user.id), attempts=attempts, reference=reference)


@bp.route("/payment/sandbox", methods=["GET", "POST"])
def sandbox_checkout():
    if (r := _require_user()) is not None:
        return r
    reference = request.values.get("reference", "")
    p = _own_payment(reference)
    if request.method == "POST":
        payments.complete_sandbox(reference, g.user.id, "success" if request.form.get("outcome") == "success" else "fail")
        return redirect(url_for("account.payment_return", reference=reference))
    if p.provider != "SANDBOX":
        abort(404)
    return render_template("pages/sandbox.html", p=p)
