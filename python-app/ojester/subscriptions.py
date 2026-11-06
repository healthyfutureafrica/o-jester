"""Subscription entitlement: current plan, summaries and activation (renewal / upgrade / downgrade)."""

from __future__ import annotations

from datetime import timedelta
from math import ceil

from sqlalchemy import select

from .db import Subscription, db
from .plans import PLAN_RANK, PLANS, SUBSCRIPTION_DAYS
from .util import utc_now


def _live(user_id: str, now) -> list[Subscription]:
    return list(
        db.scalars(
            select(Subscription)
            .where(Subscription.user_id == user_id, Subscription.status == "ACTIVE", Subscription.ends_at > now)
            .order_by(Subscription.starts_at)
        )
    )


def _rank(s: Subscription) -> int:
    return PLAN_RANK.get(s.plan, 0)


def current_plan(user_id: str) -> str | None:
    now = utc_now()
    running = [s for s in _live(user_id, now) if s.starts_at <= now]
    return max(running, key=_rank).plan if running else None


def summary(user_id: str) -> dict | None:
    now = utc_now()
    subs = _live(user_id, now)
    running = [s for s in subs if s.starts_at <= now]
    if not running:
        return None
    current = max(running, key=_rank)
    ends = current.ends_at
    for s in subs:  # follow back-to-back renewals of the same plan
        if s.id != current.id and s.plan == current.plan and s.starts_at <= ends + timedelta(minutes=1) and s.ends_at > ends:
            ends = s.ends_at
    return {
        "plan": current.plan,
        "starts_at": current.starts_at,
        "ends_at": ends,
        "days_left": max(0, ceil((ends - now).total_seconds() / 86400)),
        "queued": [{"plan": s.plan, "starts_at": s.starts_at, "ends_at": s.ends_at} for s in subs if s.starts_at >= ends],
    }


def activate_plan(user_id: str, plan: str, days: int = SUBSCRIPTION_DAYS, payment_id: str | None = None, source: str = "PAYMENT") -> Subscription:
    """Grant `days` of `plan`.

    * No live subscription → starts now.
    * Upgrade → starts now; unused value of current/queued plans becomes extra days (pro rata).
    * Renewal or downgrade → queued after the existing entitlement ends.
    Caller commits.
    """
    now = utc_now()
    live = _live(user_id, now)
    starts, extra = now, timedelta()
    if live and PLAN_RANK[plan] > max(_rank(s) for s in live):
        credit = sum(max(0.0, (s.ends_at - max(s.starts_at, now)).total_seconds()) * PLANS[s.plan].price_xaf for s in live if s.plan in PLANS)
        extra = timedelta(seconds=credit / PLANS[plan].price_xaf)
        for s in live:
            s.status, s.ends_at = "SUPERSEDED", now
    elif live:
        starts = max(s.ends_at for s in live)
    sub = Subscription(user_id=user_id, plan=plan, source=source, starts_at=starts, ends_at=starts + timedelta(days=days) + extra, payment_id=payment_id)
    db.add(sub)
    return sub
