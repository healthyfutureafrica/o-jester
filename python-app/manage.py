"""Admin commands.

    python manage.py wait-db [SECONDS]                     wait until the database is reachable (default 120 s)
    python manage.py init-db                               create the database tables (+ admin from ADMIN_EMAIL/ADMIN_PASSWORD)
    python manage.py refresh [--force]                     fetch real fixtures, predict, build combos now
    python manage.py scores                                update live scores & settle results
    python manage.py create-admin EMAIL PASSWORD [NAME]    create or promote an admin account
"""

from __future__ import annotations

import json
import sys

from ojester.db import User, db, init_db


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    cmd, args = argv[0], argv[1:]
    if cmd == "wait-db":
        from ojester.bootstrap import wait_for_db

        ok = wait_for_db(float(args[0]) if args else 120.0)
        print("Database reachable." if ok else "Database NOT reachable.")
        return 0 if ok else 1
    if cmd in ("refresh", "scores"):
        # Scheduled jobs can start while the database is restarting; give it a moment.
        from ojester.bootstrap import wait_for_db

        if not wait_for_db(90):
            return 1
    init_db()
    if cmd == "init-db":
        from ojester.bootstrap import ensure_admin

        print("Database ready.")
        if email := ensure_admin():
            print(f"Admin account ready: {email}")
    elif cmd == "refresh":
        import logging

        from ojester.pipeline import run_full_refresh

        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
        result = run_full_refresh(force="--force" in args)
        print(json.dumps(result, indent=2, default=str))
        if result is None:
            return 2  # job failed or was already running — non-zero so schedulers flag it
    elif cmd == "scores":
        import logging

        from ojester.pipeline import run_scores_refresh

        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
        result = run_scores_refresh()
        print(json.dumps(result, indent=2, default=str))
        if result is None:
            return 2
    elif cmd == "create-admin":
        from sqlalchemy import select
        from werkzeug.security import generate_password_hash

        if len(args) < 2 or len(args[1]) < 8:
            print('Usage: python manage.py create-admin EMAIL PASSWORD(8+ chars) ["Name"]')
            return 1
        email, password = args[0].lower(), args[1]
        user = db.scalar(select(User).where(User.email == email)) or User(email=email, name=args[2] if len(args) > 2 else "Administrator")
        user.password_hash, user.role = generate_password_hash(password), "ADMIN"
        db.add(user)
        db.commit()
        print(f"Admin ready: {email}")
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
