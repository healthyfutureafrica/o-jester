"""Start-up helpers shared by run.py, manage.py and the Kubernetes init containers."""

from __future__ import annotations

import logging
import time

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from werkzeug.security import check_password_hash, generate_password_hash

from .config import settings
from .db import User, db, engine

log = logging.getLogger("ojester.bootstrap")


def wait_for_db(timeout: float = 120.0) -> bool:
    """Block until the database accepts connections (or the timeout expires)."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except OperationalError as exc:
            if time.monotonic() >= deadline:
                log.error("database not reachable after %.0fs: %s", timeout, exc.orig)
                return False
            log.info("waiting for database…")
            time.sleep(2)


def ensure_admin() -> str | None:
    """Create or update the admin account from ADMIN_EMAIL / ADMIN_PASSWORD, if both are set."""
    if not (settings.admin_email and settings.admin_password):
        return None
    if len(settings.admin_password) < 8:
        log.error("ADMIN_PASSWORD must be at least 8 characters — admin account not created")
        return None
    try:
        user = db.scalar(select(User).where(User.email == settings.admin_email)) or User(email=settings.admin_email, name="Administrator")
        user.role = "ADMIN"
        if not user.password_hash or not check_password_hash(user.password_hash, settings.admin_password):
            user.password_hash = generate_password_hash(settings.admin_password)
        db.add(user)
        db.commit()
        return settings.admin_email
    except IntegrityError:  # another replica created it at the same moment
        db.rollback()
        return settings.admin_email
    finally:
        db.remove()
