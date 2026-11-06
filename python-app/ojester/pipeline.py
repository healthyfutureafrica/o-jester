"""Data pipeline: ingest real fixtures → predictions → (optional AI) → combos → settlement."""

from __future__ import annotations

import logging
import threading
from datetime import timedelta

from sqlalchemy import select

from .combos.builder import COMBO_TYPES, Candidate, build_daily_combos
from .config import settings
from .db import Combo, ComboSelection, JobRun, Match, Prediction, db
from .football.providers import create_provider
from .leagues import BY_KEY, league_tier
from .predictions.engine import confidence_for, predict_match
from .predictions.markets import settle_market
from .util import add_days, dumps, loads, local_date, utc_now, zoned_to_utc

log = logging.getLogger("ojester.pipeline")
provider = create_provider(settings)
_lock = threading.Lock()

#: Combos for a date become final at 09:00 local time (or once any leg kicks off).
COMBO_LOCK_HOUR = 9


def app_today() -> str:
    return local_date(utc_now(), settings.timezone)


def combo_lock_time(day: str):
    return zoned_to_utc(day, COMBO_LOCK_HOUR, 0, settings.timezone)


# --- Ingest -----------------------------------------------------------------


def ingest_date(day: str, odds: bool = True, tables: bool = True) -> dict:
    fixtures = provider.fixtures_for_date(day)
    scheduled = [f for f in fixtures if f.status == "SCHEDULED"]
    odds_map: dict[str, dict] = {}
    if odds and scheduled:
        try:
            odds_map = provider.odds_for_date(day, scheduled)
        except Exception as exc:  # noqa: BLE001 — odds are optional input
            log.warning("odds fetch failed for %s: %s", day, exc)

    with_stats = 0
    for f in fixtures:
        league = BY_KEY.get(f.league_key)
        if not league:
            continue
        table = None
        if tables and f.status == "SCHEDULED":
            try:
                table = provider.league_table(f.league_key, f)
            except Exception as exc:  # noqa: BLE001
                log.warning("league table failed for %s: %s", f.league_key, exc)

        m = db.scalar(select(Match).where(Match.external_id == f.external_id)) or Match(external_id=f.external_id)
        m.league_key, m.league_name, m.country = league.key, league.name, league.country
        m.kickoff, m.match_date, m.status = f.kickoff, day, f.status
        m.home_team, m.away_team, m.home_logo, m.away_logo = f.home_team, f.away_team, f.home_logo, f.away_logo
        m.home_goals, m.away_goals = f.home_goals, f.away_goals
        if f.external_id in odds_map:  # only overwrite when fresh values were fetched
            m.odds = dumps(odds_map[f.external_id])
        if table:
            m.team_stats = dumps({"home": table.teams.get(f.home_id), "away": table.teams.get(f.away_id), "league": table.league})
            with_stats += 1
        db.add(m)
    db.commit()
    log.info("%s: %d real fixtures (%d with odds, %d with tables) via %s", day, len(fixtures), len(odds_map), with_stats, provider.name)
    return {"date": day, "fixtures": len(fixtures), "with_odds": len(odds_map), "with_stats": with_stats}


# --- Predictions ------------------------------------------------------------


def predict_date(day: str) -> int:
    """Predict upcoming matches. Published predictions freeze once the game starts."""
    now = utc_now()
    count = 0
    for m in db.scalars(select(Match).where(Match.match_date == day, Match.status == "SCHEDULED", Match.kickoff > now)):
        r = predict_match(m.home_team, m.away_team, loads(m.team_stats), loads(m.odds))
        if m.prediction is None:
            m.prediction = Prediction()
        p = m.prediction
        ai = loads(p.ai_analysis)
        p.lambda_home, p.lambda_away = r["lambda_home"], r["lambda_away"]
        p.markets, p.top_scores = dumps(r["markets"]), dumps(r["top_scores"])
        p.best_market, p.best_prob = r["best"]["key"], r["best"]["probability"]
        p.confidence = confidence_for(r["best"], r["data_quality"], r["meta"]["disagreement"], (ai or {}).get("confidence_delta", 0))
        p.data_quality, p.meta, p.summary, p.model_version = r["data_quality"], dumps(r["meta"]), dumps(r["summary"]), r["model_version"]
        db.add(p)
        count += 1
    db.commit()
    log.info("%s: %d predictions updated", day, count)
    return count


# --- Combos -----------------------------------------------------------------


def generate_combos(day: str, force: bool = False) -> dict:
    """(Re)generate the day's combos; combos already final are never changed."""
    now = utc_now()
    lock_at = combo_lock_time(day)
    existing = list(db.scalars(select(Combo).where(Combo.date == day)))

    def is_final(c: Combo) -> bool:
        return not force and (now >= lock_at or any(s.match.kickoff <= now for s in c.selections))

    keep = {c.type for c in existing if is_final(c)}
    if len(keep) == len(COMBO_TYPES):
        return {"created": 0, "kept": len(keep)}

    cands = []
    for m in db.scalars(select(Match).where(Match.match_date == day, Match.status == "SCHEDULED")):
        p = m.prediction
        if not p:
            continue
        ai = loads(p.ai_analysis) or {}
        cands.append(
            Candidate(
                match_id=m.id,
                league_key=m.league_key,
                league_tier=league_tier(m.league_key),
                kickoff=m.kickoff,
                markets=loads(p.markets, []),
                data_quality=p.data_quality,
                disagreement=(loads(p.meta) or {}).get("disagreement", 0),
                ai_stance=ai.get("stance"),
                ai_market=ai.get("market"),
            )
        )

    built = [c for c in build_daily_combos(cands, now) if c.type not in keep]
    for c in existing:
        if c.type not in keep:
            db.delete(c)
    db.flush()
    for c in built:
        combo = Combo(date=day, type=c.type, min_plan=c.min_plan, kind=c.kind, total_odds=c.total_odds, probability=c.probability, odds_estimated=c.odds_estimated)
        combo.selections = [ComboSelection(position=i, **s) for i, s in enumerate(c.selections)]
        db.add(combo)
    db.commit()
    log.info("%s: %d combos generated, %d kept", day, len(built), len(keep))
    return {"created": len(built), "kept": len(keep)}


# --- Settlement -------------------------------------------------------------


def settle_results() -> dict:
    now = utc_now()
    pending = db.scalars(
        select(ComboSelection).join(Match).where(ComboSelection.result == "PENDING", Match.status.in_(["FINISHED", "CANCELLED", "POSTPONED"]))
    ).all()
    for s in pending:
        m = s.match
        if m.status == "FINISHED" and m.home_goals is not None and m.away_goals is not None:
            s.result = settle_market(s.market, m.home_goals, m.away_goals)
        elif m.status == "CANCELLED" or (m.status == "POSTPONED" and now - m.kickoff > timedelta(hours=48)):
            s.result = "VOID"
    db.flush()

    settled = 0
    for c in db.scalars(select(Combo).where(Combo.status == "PENDING")):
        results = [s.result for s in c.selections]
        status = None
        if c.kind == "ACCA":
            if "LOST" in results:
                status = "LOST"
            elif "PENDING" not in results:
                status = "VOID" if all(r == "VOID" for r in results) else "WON"
        elif "PENDING" not in results:
            status = "SETTLED"
        if status:
            c.status = status
            settled += 1
    db.commit()
    return {"selections": len(pending), "combos": settled}


# --- Jobs -------------------------------------------------------------------


def _tracked(name: str, fn):
    if not _lock.acquire(blocking=False):
        log.warning("%s skipped — another job is running", name)
        return None
    run = JobRun(name=name)
    db.add(run)
    db.commit()
    try:
        result = fn()
        run.finished_at, run.ok, run.detail = utc_now(), True, dumps(result)
        db.commit()
        return result
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.exception("%s failed", name)
        run.finished_at, run.ok, run.detail = utc_now(), False, str(exc)[:2000]
        db.add(run)
        db.commit()
        return None
    finally:
        db.remove()
        _lock.release()


def run_full_refresh(force: bool = False):
    def job():
        from .ai import service as ai_service  # optional layer — a no-op without an API key

        today = app_today()
        yesterday, tomorrow = add_days(today, -1), add_days(today, 1)
        ingest = [ingest_date(yesterday, odds=False, tables=False), ingest_date(today), ingest_date(tomorrow)]
        predicted = predict_date(today) + predict_date(tomorrow)
        analysed = ai_service.analyze_upcoming([today, tomorrow])
        if analysed:
            predicted += predict_date(today) + predict_date(tomorrow)  # fold AI confidence deltas in
        combos = {"today": generate_combos(today, force), "tomorrow": generate_combos(tomorrow, force)}
        return {"ingest": ingest, "predicted": predicted, "ai_analysed": analysed, "combos": combos, "settled": settle_results()}

    return _tracked("full-refresh", job)


def run_scores_refresh():
    """Lightweight score update — only calls the provider while matches are in play."""

    def job():
        now = utc_now()
        days = db.scalars(
            select(Match.match_date).where(Match.status.in_(["SCHEDULED", "LIVE"]), Match.kickoff < now, Match.kickoff > now - timedelta(hours=4)).distinct()
        ).all()
        for day in days:
            ingest_date(day, odds=False, tables=False)
        return {"dates": list(days), "settled": settle_results()}

    return _tracked("scores-refresh", job)


def start_scheduler():
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger

    sched = BackgroundScheduler(timezone=settings.timezone)
    sched.add_job(run_full_refresh, CronTrigger.from_crontab(settings.full_refresh_cron, timezone=settings.timezone), id="full-refresh")
    sched.add_job(run_scores_refresh, CronTrigger.from_crontab(settings.scores_cron, timezone=settings.timezone), id="scores-refresh")
    # Warm start: fetch today's real fixtures shortly after boot if we have none.
    if not db.scalar(select(Match.id).where(Match.match_date == app_today()).limit(1)):
        sched.add_job(run_full_refresh, id="warm-start")
    db.remove()
    sched.start()
    log.info("scheduler started: full refresh '%s', scores '%s' (%s)", settings.full_refresh_cron, settings.scores_cron, settings.timezone)
    return sched
