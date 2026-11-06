"""Start O-Jester: web server + background data refresh.

    python run.py            production-grade server (Waitress) on http://localhost:5080
    python run.py --debug    Flask development server with auto-reload
"""

from __future__ import annotations

import os
import signal
import sys

from ojester.app import create_app
from ojester.bootstrap import ensure_admin
from ojester.config import settings


def _graceful_shutdown(signum, frame):  # noqa: ARG001
    """Kubernetes/Docker stop containers with SIGTERM; exit cleanly instead of waiting to be killed."""
    raise SystemExit(0)


def main() -> None:
    signal.signal(signal.SIGTERM, _graceful_shutdown)
    app = create_app()
    if settings.db_auto_create:  # on Kubernetes the init container does this instead
        if email := ensure_admin():
            print(f"Admin account ready: {email}")
    port = int(os.environ.get("PORT", "5080"))
    debug = "--debug" in sys.argv

    # In debug mode the reloader runs the app twice; only schedule jobs in the serving process.
    if settings.enable_scheduler and (not debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true"):
        from ojester.pipeline import start_scheduler

        start_scheduler()

    if debug:
        app.run(host="127.0.0.1", port=port, debug=True)
    else:
        from waitress import serve

        print(f"O-Jester running on http://localhost:{port}  (data: {settings.football_provider}, AI: {'on' if settings.ai_enabled else 'off'})")
        serve(app, listen=f"*:{port}", threads=8)


if __name__ == "__main__":
    main()
