"""Locale-aware formatting helpers (use the request language in `g.lang`)."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from flask import g

from .config import settings

MONTHS = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "fr": ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
}
WEEKDAYS = {"en": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "fr": ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]}


def _lang() -> str:
    return getattr(g, "lang", "en")


def _local(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(settings.timezone))


def xaf(n: int) -> str:
    return f"{n:,}".replace(",", " ") + " XAF"


def pct(p: float, dp: int = 0) -> str:
    s = f"{p * 100:.{dp}f}"
    return (s.replace(".", ",") if _lang() == "fr" else s) + "%"


def time_(dt: datetime) -> str:
    return _local(dt).strftime("%H:%M")


def date_(dt: datetime) -> str:
    d = _local(dt)
    return f"{d.day} {MONTHS[_lang()][d.month - 1]} {d.year}"


def datetime_(dt: datetime) -> str:
    d = _local(dt)
    return f"{WEEKDAYS[_lang()][d.weekday()]} {d.day} {MONTHS[_lang()][d.month - 1]} · {d:%H:%M}"


def euro(amount: float) -> str:
    s = f"{amount:.2f}"
    return f"{s.replace('.', ',')} €" if _lang() == "fr" else f"€{s}"
