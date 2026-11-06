"""Application settings, read from environment variables (and a .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class ConfigError(RuntimeError):
    pass


def _str(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or default


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    return int(value) if value else default


@dataclass(frozen=True)
class Settings:
    env: str
    secret_key: str
    database_url: str
    app_url: str
    timezone: str
    # Real-world match data (mandatory)
    football_provider: str
    api_football_key: str | None
    api_football_bookmaker: int
    football_data_key: str | None
    # Optional AI layer (Claude). The app works fully without it.
    anthropic_api_key: str | None
    ai_model: str
    ai_web_search: bool
    ai_max_per_run: int
    # Payments
    payments_sandbox: bool
    flutterwave_secret_key: str | None
    flutterwave_webhook_hash: str | None
    paypal_client_id: str | None
    paypal_client_secret: str | None
    paypal_webhook_id: str | None
    paypal_mode: str
    paypal_currency: str
    xaf_per_usd: float
    # Jobs
    enable_scheduler: bool
    db_auto_create: bool  # create tables at start-up (disable when a migration job does it)
    full_refresh_cron: str
    scores_cron: str
    # Beta test version (feedback form, test banner, free trial for testers)
    beta_mode: bool
    beta_trial_plan: str
    beta_trial_days: int
    # Optional admin account created/updated at start-up (useful on hosts without a shell)
    admin_email: str | None
    admin_password: str | None

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def ai_enabled(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def flutterwave_enabled(self) -> bool:
        return bool(self.flutterwave_secret_key)

    @property
    def paypal_enabled(self) -> bool:
        return bool(self.paypal_client_id and self.paypal_client_secret)


def load_settings() -> Settings:
    env = _str("APP_ENV", "development")
    errors: list[str] = []

    secret = _str("SECRET_KEY", "")
    if len(secret) < 32:
        errors.append("SECRET_KEY must be at least 32 characters (generate one with: python -c \"import secrets;print(secrets.token_hex(32))\")")

    # Forgiving about how the provider was typed ("Football-Data", " football-data ", quotes…),
    # and inferred from the key that was filled in when left empty.
    provider = (_str("FOOTBALL_PROVIDER", "") or "").strip().strip("'\"").lower().replace("_", "-").replace(" ", "-")
    provider = {"apifootball": "api-football", "footballdata": "football-data", "football-data.org": "football-data"}.get(provider, provider)
    if not provider:
        if _str("API_FOOTBALL_KEY"):
            provider = "api-football"
        elif _str("FOOTBALL_DATA_KEY"):
            provider = "football-data"
    if provider not in {"api-football", "football-data"}:
        errors.append('FOOTBALL_PROVIDER must be "api-football" or "football-data" — a real match data provider is required')
    if provider == "api-football" and not _str("API_FOOTBALL_KEY"):
        errors.append("API_FOOTBALL_KEY is required when FOOTBALL_PROVIDER=api-football")
    if provider == "football-data" and not _str("FOOTBALL_DATA_KEY"):
        errors.append("FOOTBALL_DATA_KEY is required when FOOTBALL_PROVIDER=football-data")

    if errors:
        raise ConfigError("Invalid configuration:\n  - " + "\n  - ".join(errors))

    instance = BASE_DIR / "instance"
    instance.mkdir(exist_ok=True)

    database_url = _str("DATABASE_URL", f"sqlite:///{(instance / 'ojester.db').as_posix()}")
    # Hosting providers hand out postgres:// URLs; SQLAlchemy needs the psycopg (v3) driver name.
    for prefix in ("postgres://", "postgresql://"):
        if database_url.startswith(prefix):
            database_url = "postgresql+psycopg://" + database_url[len(prefix):]

    trial_plan = _str("BETA_TRIAL_PLAN", "ELITE").upper()
    if trial_plan not in {"NONE", "STARTER", "PRO", "ELITE"}:
        raise ConfigError("Invalid configuration:\n  - BETA_TRIAL_PLAN must be NONE, STARTER, PRO or ELITE")

    return Settings(
        env=env,
        secret_key=secret,
        database_url=database_url,
        # Render sets RENDER_EXTERNAL_URL automatically for hosted services.
        app_url=(_str("APP_URL") or _str("RENDER_EXTERNAL_URL") or "http://localhost:5080").rstrip("/"),
        timezone=_str("APP_TIMEZONE", "Africa/Douala"),
        football_provider=provider,
        api_football_key=_str("API_FOOTBALL_KEY"),
        api_football_bookmaker=_int("API_FOOTBALL_BOOKMAKER", 8),
        football_data_key=_str("FOOTBALL_DATA_KEY"),
        anthropic_api_key=_str("ANTHROPIC_API_KEY"),
        ai_model=_str("AI_MODEL", "claude-opus-5-5"),
        ai_web_search=_bool("AI_WEB_SEARCH", True),
        ai_max_per_run=_int("AI_MAX_MATCH_ANALYSES_PER_RUN", 20),
        payments_sandbox=_bool("PAYMENTS_SANDBOX", env != "production"),
        flutterwave_secret_key=_str("FLUTTERWAVE_SECRET_KEY"),
        flutterwave_webhook_hash=_str("FLUTTERWAVE_WEBHOOK_HASH"),
        paypal_client_id=_str("PAYPAL_CLIENT_ID"),
        paypal_client_secret=_str("PAYPAL_CLIENT_SECRET"),
        paypal_webhook_id=_str("PAYPAL_WEBHOOK_ID"),
        paypal_mode=_str("PAYPAL_MODE", "sandbox"),
        paypal_currency=_str("PAYPAL_CURRENCY", "EUR"),
        xaf_per_usd=float(_str("XAF_PER_USD", "600")),
        enable_scheduler=_bool("ENABLE_SCHEDULER", True),
        db_auto_create=_bool("DB_AUTO_CREATE", True),
        full_refresh_cron=_str("FULL_REFRESH_CRON", "5 */3 * * *"),
        scores_cron=_str("SCORES_CRON", "*/15 * * * *"),
        beta_mode=_bool("BETA_MODE", False),
        beta_trial_plan=trial_plan,
        beta_trial_days=_int("BETA_TRIAL_DAYS", 14),
        admin_email=(_str("ADMIN_EMAIL") or "").lower() or None,
        admin_password=_str("ADMIN_PASSWORD"),
    )


try:
    settings = load_settings()
except ConfigError as _exc:  # show a clean message instead of a traceback
    raise SystemExit(str(_exc)) from None
