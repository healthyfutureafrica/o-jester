"""Real-world football data providers.

* API-Football v3 (api-sports.io) — all catalogue leagues + bookmaker odds.
* football-data.org v4 — free key, 12 top competitions, no odds.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime

import requests

from ..leagues import BY_API_FOOTBALL, BY_FOOTBALL_DATA, BY_KEY, LEAGUES
from ..util import add_days, local_date, parse_utc

log = logging.getLogger("ojester.football")
TIMEOUT = 30


@dataclass
class Fixture:
    external_id: str
    league_key: str
    kickoff: datetime  # naive UTC
    status: str
    home_team: str
    away_team: str
    home_id: str
    away_id: str
    home_logo: str | None = None
    away_logo: str | None = None
    home_goals: int | None = None
    away_goals: int | None = None
    season: int | None = None


@dataclass
class LeagueTable:
    teams: dict[str, dict]
    league: dict  # {"avg_home_goals", "avg_away_goals"}


class TtlCache:
    def __init__(self, ttl_seconds: float):
        self.ttl = ttl_seconds
        self.store: dict[str, tuple[float, object]] = {}

    def get(self, key: str):
        hit = self.store.get(key)
        return hit[1] if hit and hit[0] > time.time() else None

    def has(self, key: str) -> bool:
        hit = self.store.get(key)
        return bool(hit and hit[0] > time.time())

    def set(self, key: str, value: object) -> None:
        self.store[key] = (time.time() + self.ttl, value)


def table_from_rows(rows: list[tuple[str, dict]]) -> LeagueTable:
    teams: dict[str, dict] = {}
    hg = hn = ag = an = allg = alln = 0
    for team_id, form in rows:
        teams[team_id] = form
        hg += form["home_gf"]
        hn += form["home_played"]
        ag += form["away_gf"]
        an += form["away_played"]
        allg += form["gf"]
        alln += form["played"]
    per_game = allg / alln if alln else 1.35
    return LeagueTable(
        teams,
        {
            "avg_home_goals": hg / hn if hn >= 10 else per_game * 1.1,
            "avg_away_goals": ag / an if an >= 10 else per_game * 0.9,
        },
    )


# ---------------------------------------------------------------------------
# API-Football
# ---------------------------------------------------------------------------

AF_STATUS = {"TBD": "SCHEDULED", "NS": "SCHEDULED", "FT": "FINISHED", "AET": "FINISHED", "PEN": "FINISHED", "PST": "POSTPONED",
             "CANC": "CANCELLED", "ABD": "CANCELLED", "AWD": "CANCELLED", "WO": "CANCELLED"}  # fmt: skip


class ApiFootball:
    name = "api-football"
    base_url = "https://v3.football.api-sports.io"

    def __init__(self, api_key: str, tz: str, bookmaker: int):
        self.key, self.tz, self.bookmaker = api_key, tz, bookmaker
        self.tables = TtlCache(12 * 3600)

    def _get(self, path: str, params: dict) -> dict:
        res = requests.get(self.base_url + path, params=params, headers={"x-apisports-key": self.key}, timeout=TIMEOUT)
        res.raise_for_status()
        body = res.json()
        errors = body.get("errors")
        if errors and (len(errors) if isinstance(errors, (list, dict)) else True):
            raise RuntimeError(f"API-Football {path}: {errors}")
        return body

    def fixtures_for_date(self, day: str) -> list[Fixture]:
        out = []
        for f in self._get("/fixtures", {"date": day, "timezone": self.tz})["response"]:
            league = BY_API_FOOTBALL.get(f["league"]["id"])
            if not league:
                continue
            status = AF_STATUS.get(f["fixture"]["status"]["short"], "LIVE")
            ft = (f.get("score") or {}).get("fulltime") or {}
            finished = status == "FINISHED"
            out.append(
                Fixture(
                    external_id=f"apif:{f['fixture']['id']}",
                    league_key=league.key,
                    kickoff=parse_utc(f["fixture"]["date"]),
                    status=status,
                    home_team=f["teams"]["home"]["name"],
                    away_team=f["teams"]["away"]["name"],
                    home_id=str(f["teams"]["home"]["id"]),
                    away_id=str(f["teams"]["away"]["id"]),
                    home_logo=f["teams"]["home"].get("logo"),
                    away_logo=f["teams"]["away"].get("logo"),
                    # Settle on the 90-minute score when available.
                    home_goals=ft.get("home") if finished and ft.get("home") is not None else f["goals"]["home"],
                    away_goals=ft.get("away") if finished and ft.get("away") is not None else f["goals"]["away"],
                    season=f["league"].get("season"),
                )
            )
        return out

    def league_table(self, league_key: str, fixture: Fixture) -> LeagueTable | None:
        league = BY_KEY.get(league_key)
        if not league or not league.api_football_id or not fixture.season:
            return None
        cache_key = f"{league.api_football_id}:{fixture.season}"
        if self.tables.has(cache_key):
            return self.tables.get(cache_key)  # type: ignore[return-value]
        table = None
        try:
            resp = self._get("/standings", {"league": league.api_football_id, "season": fixture.season})["response"]
            rows = [r for group in (resp[0]["league"]["standings"] if resp else []) for r in group]
            if rows:
                table = table_from_rows(
                    [
                        (
                            str(r["team"]["id"]),
                            {
                                "played": r["all"]["played"], "gf": r["all"]["goals"]["for"], "ga": r["all"]["goals"]["against"],
                                "home_played": r["home"]["played"], "home_gf": r["home"]["goals"]["for"], "home_ga": r["home"]["goals"]["against"],
                                "away_played": r["away"]["played"], "away_gf": r["away"]["goals"]["for"], "away_ga": r["away"]["goals"]["against"],
                                # API-Football lists form newest-first; normalise to oldest-first.
                                "form": (r.get("form") or "")[::-1] or None,
                                "position": r.get("rank"), "points": r.get("points"),
                            },
                        )
                        for r in rows
                    ]
                )  # fmt: skip
        except Exception as exc:  # noqa: BLE001 — standings are optional input
            log.warning("standings unavailable for %s: %s", league_key, exc)
        self.tables.set(cache_key, table)
        return table

    def odds_for_date(self, day: str, fixtures: list[Fixture]) -> dict[str, dict]:
        wanted = {f.external_id for f in fixtures}
        out: dict[str, dict] = {}
        page, total = 1, 1
        while page <= total and wanted:
            body = self._get("/odds", {"date": day, "bookmaker": self.bookmaker, "timezone": self.tz, "page": page})
            total = min((body.get("paging") or {}).get("total", 1), 15)
            for item in body["response"]:
                ext = f"apif:{item['fixture']['id']}"
                if ext in wanted and item.get("bookmakers"):
                    odds = _parse_af_bets(item["bookmakers"][0].get("bets", []))
                    if odds:
                        out[ext] = odds
            page += 1
        return out


def _parse_af_bets(bets: list[dict]) -> dict:
    odds: dict[str, float] = {}

    def put(key: str, raw: str) -> None:
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return
        if v > 1:
            odds[key] = v

    for bet in bets:
        name = (bet.get("name") or "").lower()
        bid = bet.get("id")
        for val in bet.get("values", []):
            v, odd = str(val.get("value")), val.get("odd")
            if bid == 1 or name == "match winner":
                key = {"Home": "1X2_H", "Draw": "1X2_D", "Away": "1X2_A"}.get(v)
                if key:
                    put(key, odd)
            elif bid == 12 or name == "double chance":
                key = {"Home/Draw": "DC_1X", "Home/Away": "DC_12", "Draw/Away": "DC_X2"}.get(v)
                if key:
                    put(key, odd)
            elif bid == 5 or name == "goals over/under":
                m = re.match(r"^(Over|Under) (1\.5|2\.5|3\.5)$", v)
                if m:
                    put(f"OU{m[2].replace('.', '')}_{'O' if m[1] == 'Over' else 'U'}", odd)
            elif bid == 8 or name == "both teams score":
                if v in ("Yes", "No"):
                    put("BTTS_Y" if v == "Yes" else "BTTS_N", odd)
            elif bid == 10 or name == "exact score":
                m = re.match(r"^(\d+):(\d+)$", v)
                if m:
                    put(f"CS_{m[1]}-{m[2]}", odd)
    return odds


# ---------------------------------------------------------------------------
# football-data.org
# ---------------------------------------------------------------------------

FD_STATUS = {"SCHEDULED": "SCHEDULED", "TIMED": "SCHEDULED", "FINISHED": "FINISHED", "AWARDED": "FINISHED",
             "POSTPONED": "POSTPONED", "SUSPENDED": "POSTPONED", "CANCELLED": "CANCELLED"}  # fmt: skip


class FootballData:
    name = "football-data"
    base_url = "https://api.football-data.org/v4"
    min_interval = 6.5  # free tier: 10 requests/minute

    def __init__(self, api_key: str, tz: str):
        self.key, self.tz = api_key, tz
        self.tables = TtlCache(12 * 3600)
        self._lock = threading.Lock()
        self._last = 0.0

    def _get(self, path: str) -> dict:
        with self._lock:
            wait = self._last + self.min_interval - time.time()
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            res = requests.get(self.base_url + path, headers={"X-Auth-Token": self.key}, timeout=TIMEOUT)
        if not res.ok:
            raise RuntimeError(f"football-data {path} HTTP {res.status_code}: {res.text[:200]}")
        return res.json()

    def fixtures_for_date(self, day: str) -> list[Fixture]:
        codes = ",".join(lg.football_data_code for lg in LEAGUES if lg.football_data_code)  # type: ignore[misc]
        body = self._get(f"/matches?competitions={codes}&dateFrom={add_days(day, -1)}&dateTo={add_days(day, 1)}")
        out = []
        for m in body.get("matches", []):
            league = BY_FOOTBALL_DATA.get(m["competition"]["code"])
            kickoff = parse_utc(m["utcDate"])
            if not league or local_date(kickoff, self.tz) != day:
                continue
            score = m["score"].get("regularTime") or m["score"]["fullTime"]
            season = (m.get("season") or {}).get("startDate")
            out.append(
                Fixture(
                    external_id=f"fd:{m['id']}",
                    league_key=league.key,
                    kickoff=kickoff,
                    status=FD_STATUS.get(m["status"], "LIVE"),
                    home_team=m["homeTeam"].get("shortName") or m["homeTeam"]["name"],
                    away_team=m["awayTeam"].get("shortName") or m["awayTeam"]["name"],
                    home_id=str(m["homeTeam"]["id"]),
                    away_id=str(m["awayTeam"]["id"]),
                    home_logo=m["homeTeam"].get("crest"),
                    away_logo=m["awayTeam"].get("crest"),
                    home_goals=score.get("home"),
                    away_goals=score.get("away"),
                    season=int(season[:4]) if season else None,
                )
            )
        return out

    def league_table(self, league_key: str, fixture: Fixture) -> LeagueTable | None:
        code = BY_KEY[league_key].football_data_code if league_key in BY_KEY else None
        if not code:
            return None
        if self.tables.has(code):
            return self.tables.get(code)  # type: ignore[return-value]
        table = None
        try:
            standings = self._get(f"/competitions/{code}/standings")["standings"]

            def rows(kind: str) -> list[dict]:
                return [r for s in standings if s["type"] == kind for r in s["table"]]

            home = {r["team"]["id"]: r for r in rows("HOME")}
            away = {r["team"]["id"]: r for r in rows("AWAY")}
            total = rows("TOTAL")
            if total:
                table = table_from_rows(
                    [
                        (
                            str(r["team"]["id"]),
                            {
                                "played": r["playedGames"], "gf": r["goalsFor"], "ga": r["goalsAgainst"],
                                "home_played": home.get(r["team"]["id"], {}).get("playedGames", 0),
                                "home_gf": home.get(r["team"]["id"], {}).get("goalsFor", 0),
                                "home_ga": home.get(r["team"]["id"], {}).get("goalsAgainst", 0),
                                "away_played": away.get(r["team"]["id"], {}).get("playedGames", 0),
                                "away_gf": away.get(r["team"]["id"], {}).get("goalsFor", 0),
                                "away_ga": away.get(r["team"]["id"], {}).get("goalsAgainst", 0),
                                "form": (r.get("form") or "").replace(",", "") or None,
                                "position": r.get("position"), "points": r.get("points"),
                            },
                        )
                        for r in total
                    ]
                )  # fmt: skip
        except Exception as exc:  # noqa: BLE001
            log.warning("standings unavailable for %s: %s", league_key, exc)
        self.tables.set(code, table)
        return table

    def odds_for_date(self, day: str, fixtures: list[Fixture]) -> dict[str, dict]:
        return {}  # not offered by football-data.org


def create_provider(settings):
    if settings.football_provider == "api-football":
        return ApiFootball(settings.api_football_key, settings.timezone, settings.api_football_bookmaker)
    return FootballData(settings.football_data_key, settings.timezone)
