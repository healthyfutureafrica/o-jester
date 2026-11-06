"""End-to-end tests with Flask's test client. Fixtures are inserted directly — test data only."""

import re
from datetime import timedelta
from pathlib import Path

import pytest

from ojester.app import create_app
from ojester.db import Match, Prediction, User, db
from ojester.i18n import MESSAGES
from ojester.pipeline import app_today, generate_combos
from ojester.predictions.engine import predict_match
from ojester.util import dumps, utc_now

TEMPLATES = Path(__file__).resolve().parent.parent / "ojester" / "templates"


@pytest.fixture(scope="module")
def app():
    application = create_app()
    application.config["TESTING"] = True
    _seed()
    return application


def _seed():
    odds = {"1X2_H": 1.8, "1X2_D": 3.6, "1X2_A": 4.4, "OU25_O": 1.85, "OU25_U": 1.95, "BTTS_Y": 1.8, "BTTS_N": 2.0}
    for i, (league, home, away) in enumerate([("eng-pl", "Arsenal", "Chelsea"), ("esp-laliga", "Barcelona", "Sevilla"), ("caf-cl", "Al Ahly", "Coton Sport")]):
        m = Match(
            external_id=f"test:{i}", league_key=league, league_name=league, country="X", kickoff=utc_now() + timedelta(hours=6 + i),
            match_date=app_today(), status="SCHEDULED", home_team=home, away_team=away, odds=dumps(odds),
        )  # fmt: skip
        r = predict_match(home, away, None, odds)
        m.prediction = Prediction(
            lambda_home=r["lambda_home"], lambda_away=r["lambda_away"], markets=dumps(r["markets"]), top_scores=dumps(r["top_scores"]),
            best_market=r["best"]["key"], best_prob=r["best"]["probability"], confidence=r["confidence"], data_quality=r["data_quality"],
            meta=dumps(r["meta"]), summary=dumps(r["summary"]), model_version=r["model_version"],
        )  # fmt: skip
        db.add(m)
    db.commit()
    generate_combos(app_today(), force=True)
    db.remove()


def _csrf(client) -> str:
    with client.session_transaction() as s:
        s.setdefault("csrf", "test-csrf-token")
        return s["csrf"]


def _adult(client, lang="en"):
    client.set_cookie("oj_age", "yes")
    client.set_cookie("oj_lang", lang)


def _register(client, email, birth="1995-03-10", lang="en"):
    return client.post(
        "/register",
        data={"csrf": _csrf(client), "name": "Test User", "email": email, "password": "password123", "birth_date": birth, "accept_terms": "yes"},
        headers={"Accept-Language": lang},
    )


def test_every_template_key_is_translated():
    keys = set()
    for path in TEMPLATES.rglob("*.html"):
        keys |= set(re.findall(r"_\('([a-zA-Z0-9_.]+)'", path.read_text(encoding="utf-8")))
    dynamic_prefixes = ("stance.", "result.", "status.", "checkout.m.", "pay.status.", "detail.quality.", "detail.group.", "risk.", "landing.")
    missing = {k for k in keys if not k.endswith(".") and k not in MESSAGES["en"] and not k.startswith(dynamic_prefixes)}
    assert not missing, missing
    assert set(MESSAGES["en"]) == set(MESSAGES["fr"])


def test_age_gate_blocks_until_confirmed(app):
    c = app.test_client()
    page = c.get("/app").get_data(as_text=True)
    assert "18+" in page and 'name="answer"' in page
    assert c.get("/legal").status_code == 200  # legal notice stays readable
    res = c.post("/age-check", data={"csrf": _csrf(c), "answer": "adult", "next": "/pricing"})
    assert res.status_code == 302 and res.headers["Location"].endswith("/pricing")
    assert "oj_age=yes" in res.headers.get("Set-Cookie", "")
    denied = c.post("/age-check", data={"csrf": _csrf(c), "answer": "minor"}).get_data(as_text=True)
    assert MESSAGES["en"]["ageGate.blockedTitle"] in denied


def test_csrf_required(app):
    c = app.test_client()
    _adult(c)
    assert c.post("/login", data={"email": "x@y.z", "password": "x"}).status_code == 400


def test_underage_registration_refused_in_both_languages(app):
    for lang in ("en", "fr"):
        c = app.test_client()
        _adult(c, lang)
        page = _register(c, f"kid-{lang}@test.cm", birth="2010-05-01", lang=lang).get_data(as_text=True)
        assert MESSAGES[lang]["auth.underage"].split(".")[0].replace("'", "&#39;") in page
    assert db.query(User).filter(User.email.like("kid-%")).count() == 0


def test_full_subscription_flow_and_gating(app):
    c = app.test_client()
    _adult(c, "fr")
    assert _register(c, "adult@test.cm").status_code == 302

    page = c.get("/app/matches").get_data(as_text=True)
    assert "Arsenal" in page and MESSAGES["fr"]["lock.subscribe"].replace("'", "&#39;") in page

    res = c.post("/checkout/PRO", data={"csrf": _csrf(c), "method": "MOBILE_MONEY", "phone": "670000000"})
    assert res.status_code == 302 and "/payment/sandbox" in res.headers["Location"]
    ref = res.headers["Location"].split("reference=")[1]
    res = c.post("/payment/sandbox", data={"csrf": _csrf(c), "reference": ref, "outcome": "success"})
    done = c.get(res.headers["Location"]).get_data(as_text=True)
    assert MESSAGES["fr"]["return.success"].replace("'", "&#39;") in done

    match_id = db.query(Match).filter_by(home_team="Arsenal").one().id
    detail = c.get(f"/app/matches/{match_id}").get_data(as_text=True)
    assert "Victoire Arsenal" in detail and "Plus de 2,5 buts" in detail  # Pro sees goals markets, in French
    elite_match = db.query(Match).filter_by(home_team="Al Ahly").one().id
    assert MESSAGES["fr"]["lock.upgradeTo"].split(" ")[0] in c.get(f"/app/matches/{elite_match}").get_data(as_text=True)

    c.post("/slip/toggle", data={"csrf": _csrf(c), "match_id": match_id, "market": "BTTS_Y", "next": "/app/builder"})
    builder = c.get("/app/builder").get_data(as_text=True)
    assert "Les deux équipes marquent — Oui" in builder

    assert c.get("/admin").status_code == 404  # not an admin
    db.remove()


def test_legal_notice_shows_publisher(app):
    c = app.test_client()
    page = c.get("/legal").get_data(as_text=True)
    assert "O-BBLYS Finance Ltd" in page and "TPPRR/RC/BUA/2026/B/0170" in page
    c.set_cookie("oj_lang", "fr")
    assert "Protection des mineurs" in c.get("/legal").get_data(as_text=True)


def test_every_page_renders_in_both_languages(app):
    from werkzeug.security import generate_password_hash

    admin = User(email="admin@test.cm", name="Admin", role="ADMIN", password_hash=generate_password_hash("password123"))
    db.add(admin)
    db.commit()
    match_id = db.query(Match).filter_by(home_team="Barcelona").one().id
    pages = ["/", "/pricing", "/results", "/results?days=7", "/legal", "/app", "/app/matches", "/app/matches?sort=confidence",
             f"/app/matches/{match_id}", "/app/builder", "/login", "/register", "/nope"]  # fmt: skip
    for lang in ("en", "fr"):
        visitor = app.test_client()
        _adult(visitor, lang)
        for url in pages:
            res = visitor.get(url)
            assert res.status_code in (200, 404), (lang, url, res.status_code)
        member = app.test_client()
        _adult(member, lang)
        member.post("/login", data={"csrf": _csrf(member), "email": "admin@test.cm", "password": "password123"})
        for url in pages + ["/account", "/checkout/ELITE", "/admin", "/admin?q=adult", f"/app?date={app_today()}"]:
            res = member.get(url)
            assert res.status_code in (200, 302, 404), (lang, url, res.status_code)
            if url != "/nope":
                assert res.status_code != 404 or url == "/nope", url
    db.remove()
