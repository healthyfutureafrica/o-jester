"""Admin dashboard: revenue, subscribers, payments, pipeline runs, access grants."""

from __future__ import annotations

import threading
from datetime import timedelta

from flask import Blueprint, abort, g, redirect, render_template, request, url_for
from sqlalchemy import func, or_, select

from ..db import Combo, JobRun, Match, Payment, Subscription, User, db
from ..pipeline import app_today, run_full_refresh
from ..plans import PLAN_IDS
from ..subscriptions import activate_plan, current_plan
from ..util import utc_now

bp = Blueprint("admin", __name__, url_prefix="/admin")


@bp.before_request
def require_admin():
    if not g.user or g.user.role != "ADMIN":
        abort(404)


@bp.get("")
def dashboard():
    now = utc_now()
    since = now - timedelta(days=30)
    subs = db.execute(select(Subscription.user_id, Subscription.plan).where(Subscription.status == "ACTIVE", Subscription.starts_at <= now, Subscription.ends_at > now)).all()
    subscribers = {p: 0 for p in PLAN_IDS}
    seen = set()
    for uid, plan in subs:
        if uid not in seen:
            seen.add(uid)
            subscribers[plan] = subscribers.get(plan, 0) + 1
    revenue = db.execute(
        select(Payment.plan, func.count(), func.sum(Payment.amount_xaf)).where(Payment.status == "SUCCEEDED", Payment.completed_at >= since).group_by(Payment.plan)
    ).all()
    q = request.args.get("q", "").strip()
    users_q = select(User).order_by(User.created_at.desc()).limit(100)
    if q:
        like = f"%{q}%"
        users_q = users_q.where(or_(User.email.ilike(like), User.name.ilike(like), User.phone.ilike(like)))
    users = [(u, current_plan(u.id)) for u in db.scalars(users_q)]
    return render_template(
        "pages/admin.html",
        subscribers=subscribers,
        revenue=revenue,
        revenue_total=sum(r[2] or 0 for r in revenue),
        user_count=db.scalar(select(func.count()).select_from(User)),
        new_users=db.scalar(select(func.count()).select_from(User).where(User.created_at >= since)),
        recent=db.scalars(select(Payment).order_by(Payment.created_at.desc()).limit(10)).all(),
        jobs=db.scalars(select(JobRun).order_by(JobRun.started_at.desc()).limit(8)).all(),
        matches_today=db.scalar(select(func.count()).select_from(Match).where(Match.match_date == app_today())),
        combos_today=db.scalar(select(func.count()).select_from(Combo).where(Combo.date == app_today())),
        users=users,
        q=q,
        started=request.args.get("started"),
        granted=request.args.get("granted"),
    )


@bp.post("/refresh")
def refresh():
    force = request.form.get("force") == "1"
    threading.Thread(target=run_full_refresh, kwargs={"force": force}, daemon=True).start()
    return redirect(url_for("admin.dashboard", started=1))


@bp.post("/grant/<user_id>")
def grant(user_id: str):
    user = db.get(User, user_id)
    plan = request.form.get("plan")
    days = int(request.form.get("days", "30") or 30)
    if not user or plan not in PLAN_IDS or not 1 <= days <= 365:
        abort(400)
    activate_plan(user.id, plan, days=days, source="ADMIN_GRANT")
    db.commit()
    return redirect(url_for("admin.dashboard", granted=user.email))
