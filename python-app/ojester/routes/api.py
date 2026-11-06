"""Machine endpoints: health check, payment webhooks, CSV export."""

from __future__ import annotations

import csv
import io
import logging
import threading

from flask import Blueprint, Response, g, jsonify, redirect, request, url_for
from sqlalchemy import select, text

from ..config import settings
from ..db import Combo, ComboSelection, db
from ..payments.gateways import paypal
from ..payments.service import verify_payment
from ..pipeline import app_today
from ..predictions.markets import market_label

bp = Blueprint("api", __name__)
log = logging.getLogger("ojester.webhooks")


@bp.get("/api/health")
def health():
    """Liveness: the process is up and serving requests."""
    return jsonify(ok=True)


@bp.get("/api/ready")
def ready():
    """Readiness: the database answers. Kubernetes stops routing traffic here while it doesn't."""
    try:
        db.execute(text("SELECT 1"))
        return jsonify(ok=True, database="up")
    except Exception:  # noqa: BLE001
        log.exception("readiness check failed")
        return jsonify(ok=False, database="down"), 503


def _verify_async(reference: str) -> None:
    def run():
        try:
            verify_payment(reference)
        except Exception:  # noqa: BLE001
            log.exception("webhook verification failed for %s", reference)
        finally:
            db.remove()

    threading.Thread(target=run, daemon=True).start()


@bp.post("/api/payments/webhooks/flutterwave")
def flutterwave_webhook():
    if not settings.flutterwave_webhook_hash or request.headers.get("verif-hash") != settings.flutterwave_webhook_hash:
        return "", 401
    body = request.get_json(silent=True) or {}
    ref = (body.get("data") or {}).get("tx_ref") or body.get("txRef")
    if isinstance(ref, str):
        _verify_async(ref)  # re-verify with the provider; never trust the webhook body
    return jsonify(received=True)


@bp.post("/api/payments/webhooks/paypal")
def paypal_webhook():
    event = request.get_json(silent=True) or {}
    try:
        valid = paypal.verify_webhook(dict(request.headers), event)
    except Exception:  # noqa: BLE001
        valid = False
    if not valid:
        return "", 401
    res = event.get("resource") or {}
    units = res.get("purchase_units") or [{}]
    ref = res.get("custom_id") or units[0].get("reference_id") or units[0].get("custom_id")
    if isinstance(ref, str):
        _verify_async(ref)
    return jsonify(received=True)


@bp.get("/results/export.csv")
def export_csv():
    if not g.user or not g.limits.csv_export:
        return redirect(url_for("public.pricing", plan="ELITE"))
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["date", "combo", "combo_status", "combo_odds", "league", "kickoff_utc", "home", "away", "selection", "market", "odds", "model_probability", "score", "result"])
    rows = db.execute(select(ComboSelection, Combo).join(Combo).order_by(Combo.date.desc(), ComboSelection.position).limit(20000)).all()
    for s, c in rows:
        m = s.match
        w.writerow([
            c.date, c.type, c.status, c.total_odds, m.league_name, m.kickoff.isoformat() + "Z", m.home_team, m.away_team,
            market_label(s.market, m.home_team, m.away_team, g.lang), s.market, s.odds, s.probability,
            f"{m.home_goals}-{m.away_goals}" if m.home_goals is not None else "", s.result,
        ])  # fmt: skip
    return Response(
        "﻿" + out.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="o-jester-results-{app_today()}.csv"'},
    )
