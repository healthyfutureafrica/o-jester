"""Beta test version: feedback form, tester trial, robots and hosting config."""

import importlib
import os

import pytest

from ojester import config as config_module
from ojester.app import create_app
from ojester.db import Feedback, User, db
from ojester.subscriptions import current_plan


@pytest.fixture()
def beta(monkeypatch):
    """Turn beta mode on for one test (settings is a frozen dataclass, so swap it)."""
    from dataclasses import replace

    from ojester import app as app_module
    from ojester.routes import account

    beta_settings = replace(config_module.settings, beta_mode=True, beta_trial_plan="ELITE", beta_trial_days=14)
    for mod in (config_module, app_module, account):
        monkeypatch.setattr(mod, "settings", beta_settings)
    application = create_app()
    application.config["TESTING"] = True
    return application


def _client(app, lang="en"):
    c = app.test_client()
    c.set_cookie("oj_age", "yes")
    c.set_cookie("oj_lang", lang)
    with c.session_transaction() as s:
        s["csrf"] = "tok"
    return c


def test_beta_banner_feedback_and_noindex(beta):
    c = _client(beta, "fr")
    res = c.get("/pricing")
    html = res.get_data(as_text=True)
    assert "Version de test" in html and "/feedback?page=/pricing" in html
    assert res.headers.get("X-Robots-Tag") == "noindex, nofollow"
    assert "Disallow: /" in c.get("/robots.txt").get_data(as_text=True)


def test_feedback_submission_and_admin_view(beta):
    c = _client(beta)
    bad = c.post("/feedback", data={"csrf": "tok", "rating": "0", "category": "bug", "message": "hello there"})
    assert "Please choose a star rating." in bad.get_data(as_text=True)
    ok = c.post("/feedback", data={"csrf": "tok", "rating": "4", "category": "design", "message": "Love the gold colours!", "name": "Ama", "page": "/pricing"})
    assert ok.status_code == 302 and "/feedback/thanks" in ok.headers["Location"]
    fb = db.query(Feedback).filter_by(name="Ama").one()
    assert (fb.rating, fb.category, fb.page, fb.lang) == (4, "design", "/pricing", "en")

    assert c.get("/admin/feedback").status_code == 404  # admins only
    from werkzeug.security import generate_password_hash

    admin = User(email="fb-admin@test.cm", name="Admin", role="ADMIN", password_hash=generate_password_hash("password123"))
    db.add(admin)
    db.commit()
    with c.session_transaction() as s:
        s["uid"] = admin.id
    page = c.get("/admin/feedback").get_data(as_text=True)
    assert "Love the gold colours!" in page
    assert "Love the gold colours!" in c.get("/admin/feedback.csv").get_data(as_text=True)
    db.remove()


def test_beta_testers_get_trial(beta):
    c = _client(beta)
    res = c.post(
        "/register",
        data={"csrf": "tok", "name": "Tester", "email": "tester@beta.cm", "password": "password123", "birth_date": "1990-01-01", "accept_terms": "yes"},
    )
    assert res.status_code == 302
    user = db.query(User).filter_by(email="tester@beta.cm").one()
    assert current_plan(user.id) == "ELITE"
    db.remove()


def test_postgres_url_and_hosted_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@db.example:5432/ojester")
    monkeypatch.delenv("APP_URL", raising=False)
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://o-jester-beta.onrender.com/")
    s = config_module.load_settings()
    assert s.database_url == "postgresql+psycopg://u:p@db.example:5432/ojester"
    assert s.app_url == "https://o-jester-beta.onrender.com"
    monkeypatch.setenv("BETA_TRIAL_PLAN", "gold")
    with pytest.raises(config_module.ConfigError):
        config_module.load_settings()


def test_payment_redirects_use_known_host_only(monkeypatch):
    """Payment return URLs follow the visitor's address only for our own hosts (Host header is untrusted)."""
    from dataclasses import replace

    from flask import Flask

    from ojester.payments import gateways

    monkeypatch.setattr(gateways, "settings", replace(config_module.settings, app_url="https://www.o-jester.com"))
    monkeypatch.setenv("RENDER_EXTERNAL_HOSTNAME", "o-jester.onrender.com")
    app = Flask(__name__)
    for host, expected in [
        ("www.o-jester.com", "https://www.o-jester.com"),
        ("o-jester.com", "https://o-jester.com"),
        ("o-jester.onrender.com", "https://o-jester.onrender.com"),
        ("evil.example", "https://www.o-jester.com"),
    ]:
        with app.test_request_context("/checkout/PRO", base_url=f"https://{host}"):
            assert gateways._base_url() == expected, host
    assert gateways._base_url() == "https://www.o-jester.com"  # outside a request


@pytest.mark.parametrize(
    "typed, keys, expected",
    [
        ("Football-Data", {"FOOTBALL_DATA_KEY": "k"}, "football-data"),
        ('  "football-data" ', {"FOOTBALL_DATA_KEY": "k"}, "football-data"),
        ("API_FOOTBALL", {"API_FOOTBALL_KEY": "k"}, "api-football"),
        ("", {"FOOTBALL_DATA_KEY": "k"}, "football-data"),  # inferred from the key
        ("", {"API_FOOTBALL_KEY": "k"}, "api-football"),
    ],
)
def test_football_provider_is_forgiving(monkeypatch, typed, keys, expected):
    monkeypatch.setenv("FOOTBALL_PROVIDER", typed)
    for name in ("API_FOOTBALL_KEY", "FOOTBALL_DATA_KEY"):
        monkeypatch.setenv(name, keys.get(name, ""))
    assert config_module.load_settings().football_provider == expected


def test_missing_provider_and_keys_still_fails(monkeypatch):
    for name in ("FOOTBALL_PROVIDER", "API_FOOTBALL_KEY", "FOOTBALL_DATA_KEY"):
        monkeypatch.setenv(name, "")
    with pytest.raises(config_module.ConfigError):
        config_module.load_settings()


def test_onrender_address_redirects_to_public_domain(monkeypatch):
    from dataclasses import replace

    from ojester import app as app_module

    monkeypatch.setattr(app_module, "settings", replace(config_module.settings, app_url="https://www.o-jester.com"))
    c = create_app().test_client()
    res = c.get("/pricing?x=1", base_url="https://o-jester.onrender.com")
    assert res.status_code == 301 and res.headers["Location"] == "https://www.o-jester.com/pricing?x=1"
    assert c.get("/api/health", base_url="https://o-jester.onrender.com").status_code == 200  # health checks unaffected
    assert c.get("/pricing", base_url="https://www.o-jester.com").status_code != 301
