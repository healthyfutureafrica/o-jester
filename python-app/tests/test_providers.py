"""Parsing of real provider responses (sample payloads shaped like the documented APIs)."""

from ojester.football.providers import ApiFootball, FootballData, _parse_af_bets


def test_api_football_odds_parsing():
    bets = [
        {"id": 1, "name": "Match Winner", "values": [{"value": "Home", "odd": "1.85"}, {"value": "Draw", "odd": "3.40"}, {"value": "Away", "odd": "4.20"}]},
        {"id": 12, "name": "Double Chance", "values": [{"value": "Home/Draw", "odd": "1.22"}, {"value": "Draw/Away", "odd": "1.85"}]},
        {"id": 5, "name": "Goals Over/Under", "values": [{"value": "Over 2.5", "odd": "1.90"}, {"value": "Under 2.5", "odd": "1.90"}, {"value": "Over 4.5", "odd": "5.0"}]},
        {"id": 8, "name": "Both Teams Score", "values": [{"value": "Yes", "odd": "1.75"}, {"value": "No", "odd": "2.05"}]},
        {"id": 10, "name": "Exact Score", "values": [{"value": "1:0", "odd": "7.5"}]},
    ]
    odds = _parse_af_bets(bets)
    assert odds == {"1X2_H": 1.85, "1X2_D": 3.4, "1X2_A": 4.2, "DC_1X": 1.22, "DC_X2": 1.85, "OU25_O": 1.9, "OU25_U": 1.9, "BTTS_Y": 1.75, "BTTS_N": 2.05, "CS_1-0": 7.5}


def test_api_football_fixtures(monkeypatch):
    p = ApiFootball("key", "Africa/Douala", 8)
    sample = {
        "response": [
            {
                "fixture": {"id": 101, "date": "2026-10-21T20:00:00+01:00", "status": {"short": "FT"}},
                "league": {"id": 39, "season": 2026},
                "teams": {"home": {"id": 42, "name": "Arsenal", "logo": "a.png"}, "away": {"id": 49, "name": "Chelsea", "logo": "c.png"}},
                "goals": {"home": 3, "away": 2},
                "score": {"fulltime": {"home": 2, "away": 2}},
            },
            {"fixture": {"id": 102, "date": "2026-10-21T18:00:00+00:00", "status": {"short": "NS"}}, "league": {"id": 99999, "season": 2026},
             "teams": {"home": {"id": 1, "name": "X"}, "away": {"id": 2, "name": "Y"}}, "goals": {"home": None, "away": None}, "score": {}},
        ]
    }  # fmt: skip
    monkeypatch.setattr(p, "_get", lambda path, params: sample)
    fixtures = p.fixtures_for_date("2026-10-21")
    assert len(fixtures) == 1  # leagues outside the catalogue are ignored
    f = fixtures[0]
    assert (f.external_id, f.league_key, f.status, f.home_goals, f.away_goals) == ("apif:101", "eng-pl", "FINISHED", 2, 2)  # 90-minute score
    assert f.kickoff.isoformat() == "2026-10-21T19:00:00"


def test_football_data_fixtures_filter_local_date(monkeypatch):
    p = FootballData("key", "Africa/Douala")
    team = lambda i, n: {"id": i, "name": n, "shortName": n, "crest": None}  # noqa: E731
    sample = {
        "matches": [
            {"id": 1, "utcDate": "2026-10-21T19:00:00Z", "status": "TIMED", "competition": {"code": "PL"}, "season": {"startDate": "2026-08-15"},
             "homeTeam": team(57, "Arsenal"), "awayTeam": team(61, "Chelsea"), "score": {"fullTime": {"home": None, "away": None}}},
            {"id": 2, "utcDate": "2026-10-21T23:30:00Z", "status": "FINISHED", "competition": {"code": "PD"}, "season": {"startDate": "2026-08-15"},
             "homeTeam": team(81, "Barça"), "awayTeam": team(559, "Sevilla"), "score": {"fullTime": {"home": 2, "away": 1}}},
        ]
    }  # fmt: skip
    monkeypatch.setattr(p, "_get", lambda path: sample)
    fixtures = p.fixtures_for_date("2026-10-21")
    # The second match kicks off at 00:30 on the 22nd in Douala, so it belongs to the next day.
    assert [f.external_id for f in fixtures] == ["fd:1"]
    assert fixtures[0].status == "SCHEDULED" and fixtures[0].season == 2026
