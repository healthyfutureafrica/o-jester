from datetime import date, datetime, timedelta

from ojester.combos.builder import Candidate, build_daily_combos
from ojester.predictions.engine import confidence_for, effective_odds, form_score, implied_from_odds, pick_best, predict_match, stats_lambdas
from ojester.predictions.markets import is_market_key, market_label, market_short, settle_market
from ojester.predictions.poisson import fit_lambdas, markets_from_matrix, score_matrix, top_scores
from ojester.util import add_days, age_on, local_date, zoned_to_utc

STRONG = {"played": 10, "gf": 25, "ga": 6, "home_played": 5, "home_gf": 15, "home_ga": 2, "away_played": 5, "away_gf": 10, "away_ga": 4, "form": "WWWDW"}
WEAK = {"played": 10, "gf": 8, "ga": 20, "home_played": 5, "home_gf": 5, "home_ga": 9, "away_played": 5, "away_gf": 3, "away_ga": 11, "form": "LLDLL"}


def test_score_matrix_normalised_and_consistent():
    m = score_matrix(1.6, 1.1)
    assert abs(sum(map(sum, m)) - 1) < 1e-9
    p = markets_from_matrix(m)
    assert abs(p["1X2_H"] + p["1X2_D"] + p["1X2_A"] - 1) < 1e-9
    assert abs(p["DC_1X"] - (p["1X2_H"] + p["1X2_D"])) < 1e-9
    assert p["OU15_O"] > p["OU25_O"] > p["OU35_O"]
    assert p["1X2_H"] > p["1X2_A"]


def test_fit_recovers_lambdas():
    truth = markets_from_matrix(score_matrix(1.8, 0.9, 0))
    lh, la = fit_lambdas(truth["1X2_H"], truth["1X2_D"], truth["1X2_A"], truth["OU25_O"])
    assert abs(lh - 1.8) < 0.06 and abs(la - 0.9) < 0.06


def test_implied_odds_and_stats():
    t = implied_from_odds({"1X2_H": 2.0, "1X2_D": 3.4, "1X2_A": 3.8})
    assert abs(t["home"] + t["draw"] + t["away"] - 1) < 1e-9
    assert implied_from_odds({"1X2_H": 2.0}) is None
    lh, la = stats_lambdas({"home": STRONG, "away": WEAK, "league": {"avg_home_goals": 1.5, "avg_away_goals": 1.2}})
    assert lh > la * 2
    assert form_score("WWWWW") == 1 and form_score("LLLLL") == 0 and form_score("W") is None


def test_predict_match_high_quality_bilingual():
    r = predict_match(
        "Coton Sport",
        "Canon Yaoundé",
        {"home": STRONG, "away": WEAK, "league": {"avg_home_goals": 1.5, "avg_away_goals": 1.2}},
        {"1X2_H": 1.45, "1X2_D": 4.5, "1X2_A": 7.5, "OU25_O": 1.7, "OU25_U": 2.15},
    )
    assert r["data_quality"] == "HIGH"
    home = next(m for m in r["markets"] if m["key"] == "1X2_H")
    assert home["probability"] > 0.5 and home["book_odds"] == 1.45
    assert any(m["key"].startswith("CS_") for m in r["markets"])
    assert "Coton Sport" in r["summary"]["en"] and "Modèle" in r["summary"]["fr"]
    assert r["confidence"] > 40


def test_low_quality_without_data_and_best_pick():
    r = predict_match("A", "B", None, None)
    assert r["data_quality"] == "LOW"
    r = predict_match("A", "B", None, {"1X2_H": 1.9, "1X2_D": 3.5, "1X2_A": 4.2})
    best = pick_best(r["markets"], ["RESULT"])
    assert best["group"] == "RESULT" and effective_odds(best)[0] >= 1.3
    assert pick_best(r["markets"], []) is None
    pick = {"key": "1X2_H", "group": "RESULT", "probability": 0.6, "fair_odds": 1.67}
    assert confidence_for(pick, "HIGH") > confidence_for(pick, "LOW")
    assert confidence_for(pick, "HIGH", 0.1) < confidence_for(pick, "HIGH")


def test_settlement_and_labels():
    cases = [("1X2_H", 2, 1, "WON"), ("1X2_D", 1, 1, "WON"), ("1X2_A", 2, 1, "LOST"), ("DC_12", 0, 0, "LOST"), ("DC_X2", 0, 1, "WON"),
             ("OU25_O", 2, 1, "WON"), ("OU25_O", 1, 1, "LOST"), ("OU35_U", 2, 2, "LOST"), ("BTTS_Y", 1, 1, "WON"), ("BTTS_N", 3, 0, "WON"),
             ("CS_2-1", 2, 1, "WON"), ("CS_2-1", 1, 2, "LOST")]  # fmt: skip
    for key, h, a, expected in cases:
        assert settle_market(key, h, a) == expected, key
    assert market_label("1X2_H", "Coton Sport", "Canon", "fr") == "Victoire Coton Sport"
    assert market_label("OU25_O", "A", "B", "fr") == "Plus de 2,5 buts"
    assert market_label("DC_1X", "Arsenal", "Chelsea") == "Arsenal or draw"
    assert market_short("CS_2-1", "fr") == "SE 2-1" and market_short("OU25_O") == "Over 2.5"
    assert is_market_key("CS_3-2") and not is_market_key("OU45_O")


def test_combo_builder():
    now = datetime(2026, 10, 24, 8, 0)

    def cand(i, league, tier, lh, la):
        m = score_matrix(lh, la)
        p = markets_from_matrix(m)
        odds = {k: round(1.02 / v, 2) for k, v in p.items()}
        for s in top_scores(m, 8):
            odds[f"CS_{s['home']}-{s['away']}"] = round(0.9 / s["probability"], 2)
        r = predict_match(f"H{i}", f"A{i}", None, odds)
        return Candidate(f"m{i}", league, tier, now + timedelta(hours=i + 2), r["markets"], r["data_quality"])

    slate = [cand(1, "eng-pl", 1, 2.4, 0.6), cand(2, "esp-laliga", 1, 2.2, 0.8), cand(3, "ita-seriea", 1, 1.9, 0.9), cand(4, "ger-bundesliga", 1, 2.1, 1.4),
             cand(5, "fra-ligue1", 1, 0.7, 1.9), cand(6, "uefa-uel", 2, 1.9, 1.6), cand(7, "ned-eredivisie", 2, 2.3, 1.5), cand(8, "tur-superlig", 2, 1.8, 1.7),
             cand(9, "egy-premier", 3, 1.6, 0.7), cand(10, "mar-botola", 3, 1.5, 0.8), cand(11, "por-primeira", 2, 2.6, 0.5)]  # fmt: skip
    combos = {c.type: c for c in build_daily_combos(slate, now)}
    assert len(combos["SAFE_DOUBLE"].selections) == 2 and len(combos["DAILY_TREBLE"].selections) == 3
    tiers = {c.match_id: c.league_tier for c in slate}
    assert all(tiers[s["match_id"]] == 1 for s in combos["SAFE_DOUBLE"].selections)
    for c in combos.values():
        ids = [s["match_id"] for s in c.selections]
        assert len(set(ids)) == len(ids)
    assert all(s["market"].startswith("OU") for s in combos["GOALS_GALORE"].selections)

    slate[0].ai_stance = "AVOID"
    slate[1].kickoff = now + timedelta(minutes=5)
    used = {s["match_id"] for c in build_daily_combos(slate, now) for s in c.selections}
    assert "m1" not in used and "m2" not in used
    assert build_daily_combos([], now) == []


def test_dates_and_age():
    assert local_date(datetime(2026, 10, 21, 23, 30), "Africa/Douala") == "2026-10-22"
    assert zoned_to_utc("2026-10-21", 21, 0, "Africa/Douala") == datetime(2026, 10, 21, 20, 0)
    assert zoned_to_utc("2026-07-01", 15, 0, "Europe/London") == datetime(2026, 7, 1, 14, 0)
    assert add_days("2026-12-31", 1) == "2027-01-01"
    today = date(2026, 10, 21)
    assert age_on(date(2008, 10, 21), today) == 18 and age_on(date(2008, 10, 22), today) == 17
