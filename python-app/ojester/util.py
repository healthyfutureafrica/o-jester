"""Small shared helpers: JSON, dates and time zones."""

from __future__ import annotations

import json
import re
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def loads(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def is_date_str(value: object) -> bool:
    if not isinstance(value, str) or not DATE_RE.match(value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def local_date(at: datetime, tz: str) -> str:
    """Calendar date of a naive-UTC or aware datetime in time zone `tz`."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return at.astimezone(ZoneInfo(tz)).date().isoformat()


def add_days(day: str, n: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


def zoned_to_utc(day: str, hour: int, minute: int, tz: str) -> datetime:
    """Naive-UTC instant of wall-clock time `hour:minute` on `day` in `tz`."""
    local = datetime.fromisoformat(day).replace(hour=hour, minute=minute, tzinfo=ZoneInfo(tz))
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def parse_utc(value: str) -> datetime:
    """Parse an ISO timestamp into naive UTC."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def payment_reference() -> str:
    """Human-friendly unique reference, e.g. OJ-M2K8F1A-7QX3ZB."""
    stamp = _base36(int(time.time() * 1000))
    return f"OJ-{stamp}-{secrets.token_hex(3).upper()}"


def _base36(n: int) -> str:
    chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = chars[r] + out
    return out or "0"


MIN_AGE = 18


def age_on(birth: date, today: date | None = None) -> int:
    today = today or date.today()
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
