"""Tester feedback: public form, admin list and CSV export."""

from __future__ import annotations

import csv
import io
import time
from collections import defaultdict, deque

from flask import Blueprint, Response, abort, g, redirect, render_template, request, url_for
from sqlalchemy import func, select

from ..db import Feedback, db
from ..i18n import t
from . import safe_next

bp = Blueprint("feedback", __name__)

CATEGORIES = ("bug", "design", "predictions", "payments", "translation", "idea", "other")
_recent: dict[str, deque] = defaultdict(deque)


def _too_many(ip: str) -> bool:
    """At most 10 submissions per IP per hour (spam protection)."""
    q, now = _recent[ip], time.time()
    while q and q[0] < now - 3600:
        q.popleft()
    q.append(now)
    return len(q) > 10


@bp.route("/feedback", methods=["GET", "POST"])
def form():
    page = safe_next(request.values.get("page"), "")
    values = {"name": g.user.name if g.user else "", "contact": g.user.email if g.user else "", "rating": "", "category": "", "message": ""}
    error = None
    if request.method == "POST":
        values = {k: request.form.get(k, "").strip() for k in values}
        rating = int(values["rating"]) if values["rating"].isdigit() else 0
        ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
        if not 1 <= rating <= 5:
            error = t("feedback.errRating", g.lang)
        elif values["category"] not in CATEGORIES:
            error = t("feedback.errCategory", g.lang)
        elif not 5 <= len(values["message"]) <= 2000:
            error = t("feedback.errMessage", g.lang)
        elif _too_many(ip):
            error = t("auth.tooMany", g.lang)
        else:
            db.add(
                Feedback(
                    user_id=g.user.id if g.user else None,
                    name=values["name"][:80] or None,
                    contact=values["contact"][:120] or None,
                    rating=rating,
                    category=values["category"],
                    message=values["message"],
                    page=page or None,
                    lang=g.lang,
                    device=(request.headers.get("User-Agent") or "")[:255],
                )
            )
            db.commit()
            return redirect(url_for("feedback.thanks", page=page or None))
    return render_template("pages/feedback.html", values=values, error=error, page=page, categories=CATEGORIES)


@bp.get("/feedback/thanks")
def thanks():
    return render_template("pages/feedback_thanks.html", back=safe_next(request.args.get("page"), url_for("public.index")))


def _require_admin():
    if not g.user or g.user.role != "ADMIN":
        abort(404)


@bp.get("/admin/feedback")
def admin_list():
    _require_admin()
    category = request.args.get("category", "")
    q = select(Feedback).order_by(Feedback.created_at.desc()).limit(500)
    if category in CATEGORIES:
        q = q.where(Feedback.category == category)
    items = db.scalars(q).all()
    stats = db.execute(select(func.count(), func.avg(Feedback.rating)).select_from(Feedback)).one()
    by_cat = dict(db.execute(select(Feedback.category, func.count()).group_by(Feedback.category)).all())
    return render_template("pages/admin_feedback.html", items=items, total=stats[0], avg=stats[1], by_cat=by_cat, categories=CATEGORIES, category=category)


@bp.get("/admin/feedback.csv")
def admin_csv():
    _require_admin()
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["date_utc", "rating", "category", "message", "name", "contact", "page", "language", "device"])
    for f in db.scalars(select(Feedback).order_by(Feedback.created_at.desc())):
        w.writerow([f.created_at.isoformat(timespec="minutes"), f.rating, f.category, f.message, f.name or "", f.contact or "", f.page or "", f.lang, f.device or ""])
    return Response("﻿" + out.getvalue(), mimetype="text/csv", headers={"Content-Disposition": 'attachment; filename="o-jester-feedback.csv"'})
