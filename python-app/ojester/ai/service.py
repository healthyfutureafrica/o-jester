"""Optional Claude analysis: team news + a Back/Lean/Avoid verdict, written in English and French.

Everything here is a no-op when ANTHROPIC_API_KEY is not set. Predictions, combos and
the whole site work entirely on the statistical model without it.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import timedelta

from sqlalchemy import or_, select

from ..config import settings
from ..db import Match, Prediction, db
from ..predictions.markets import market_label
from ..util import dumps, loads, utc_now

log = logging.getLogger("ojester.ai")

_client = None
if settings.ai_enabled:
    try:
        import anthropic

        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    except ImportError:  # the package is optional
        log.warning("ANTHROPIC_API_KEY is set but the 'anthropic' package is not installed — AI disabled")

ai_enabled = _client is not None

# Server-side refusal fallback: if the primary model declines, the API reruns the request on a fallback model.
FALLBACK = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}

ANALYST_SYSTEM = """You are the senior football analyst for O-Jester, a bilingual (English/French) football prediction-tips service. O-Jester is not a betting operator: subscribers read our tips and decide for themselves.

For each fixture you receive our statistical model's output (Dixon–Coles Poisson, blended with bookmaker prices) and season statistics. Your job:
1. Use web search to check the latest team news for this fixture: injuries, suspensions, expected line-ups, rotation risk, managerial changes, motivation. Prefer reports from the last 7 days and reputable outlets.
2. Weigh that news against the model, which cannot see team news.
3. Give a verdict on ONE market key from the list provided: BACK (strong, supported by news), LEAN (reasonable with caveats) or AVOID (too uncertain for combinations — key absences, dead rubber, heavy rotation).
4. confidence_delta adjusts our confidence score: positive if news strengthens the pick, negative if it weakens it, 0 if nothing material.

Be calibrated and honest: never promise a win, never invent injuries or statistics, never encourage betting. If search finds nothing useful, say so in team_news.

Write every text field twice: in clear English ("en") and in natural French as used in Cameroon and francophone Africa ("fr"), with the same meaning. Do not translate team or competition names.

Your final message must be a single JSON object (no surrounding prose):
{"stance": "BACK"|"LEAN"|"AVOID", "market": <one provided market key>, "confidence_delta": integer -15..10,
 "en": {"headline": str, "summary": str (2-4 sentences), "key_factors": [str] (max 6), "team_news": [str] (max 6), "risks": [str] (max 5), "reasoning": str},
 "fr": {same fields in French}}"""

def _text(res) -> str:
    return "\n".join(b.text for b in res.content if b.type == "text")


def _extract_json(text: str) -> dict:
    fences = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text)
    raw = fences[-1] if fences else text[text.find("{") : text.rfind("}") + 1]
    return json.loads(raw)


def _sources(res) -> list[dict]:
    out: list[dict] = []
    for block in res.content:
        if block.type == "web_search_tool_result" and isinstance(block.content, list):
            for r in block.content:
                if getattr(r, "type", "") == "web_search_result" and all(s["url"] != r.url for s in out):
                    out.append({"title": r.title, "url": r.url})
    return out[:6]


def _valid(data: dict, allowed: list[str]) -> dict | None:
    if data.get("stance") not in ("BACK", "LEAN", "AVOID"):
        return None
    if data.get("market") not in allowed:
        data["market"] = allowed[0]
    try:
        data["confidence_delta"] = max(-15, min(10, int(data.get("confidence_delta", 0))))
    except (TypeError, ValueError):
        data["confidence_delta"] = 0
    for lang in ("en", "fr"):
        block = data.get(lang)
        if not isinstance(block, dict) or not block.get("headline") or not block.get("summary"):
            return None
        for key in ("key_factors", "team_news", "risks"):
            block[key] = [str(x) for x in block.get(key) or []][:6]
        block["reasoning"] = str(block.get("reasoning", ""))
    return {k: data[k] for k in ("stance", "market", "confidence_delta", "en", "fr")}


def analyze_match(m: Match, p: Prediction) -> dict | None:
    if not _client:
        return None
    import anthropic

    markets = [x for x in loads(p.markets, []) if x["group"] != "SCORE"]
    allowed = [x["key"] for x in markets]
    fixture = {
        "competition": f"{m.league_name} ({m.country})",
        "kickoff_utc": m.kickoff.isoformat() + "Z",
        "home": m.home_team,
        "away": m.away_team,
        "model_expected_goals": {"home": p.lambda_home, "away": p.lambda_away},
        "data_quality": p.data_quality,
        "season_stats": loads(m.team_stats),
        "markets": [
            {"key": x["key"], "selection": market_label(x["key"], m.home_team, m.away_team), "model_probability_pct": round(x["probability"] * 100, 1),
             "bookmaker_odds": x.get("book_odds"), "edge": x.get("edge")}
            for x in markets
        ],
    }  # fmt: skip
    messages = [{"role": "user", "content": f"Analyse this fixture. Today is {utc_now().date().isoformat()}.\n\n{json.dumps(fixture, ensure_ascii=False, indent=1)}"}]
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 4}] if settings.ai_web_search else []
    try:
        res = None
        for _ in range(4):  # resume if the server pauses a long server-tool turn
            res = _client.beta.messages.create(
                model=settings.ai_model,
                max_tokens=16000,
                output_config={"effort": "medium"},
                system=ANALYST_SYSTEM,
                tools=tools,
                messages=messages,
                **FALLBACK,
            )
            if res.stop_reason != "pause_turn":
                break
            messages = [*messages, {"role": "assistant", "content": res.content}]
        if res is None or res.stop_reason == "refusal":
            return None
        data = _valid(_extract_json(_text(res)), allowed)
        if not data:
            log.warning("AI output invalid for %s v %s", m.home_team, m.away_team)
            return None
        return {**data, "sources": _sources(res), "model": res.model, "generated_at": utc_now().isoformat() + "Z"}
    except anthropic.RateLimitError:
        log.warning("AI rate limited — will retry next run")
    except anthropic.APIError as exc:
        log.error("Claude API error: %s", exc)
    except (ValueError, KeyError) as exc:
        log.warning("AI output could not be parsed: %s", exc)
    return None


def analyze_upcoming(days: list[str]) -> int:
    """Analyse the most relevant upcoming fixtures, once each, refreshed close to kick-off."""
    if not _client or settings.ai_max_per_run <= 0:
        return 0
    now = utc_now()
    rows = db.execute(
        select(Match, Prediction)
        .join(Prediction, Prediction.match_id == Match.id)
        .where(
            Match.match_date.in_(days),
            Match.status == "SCHEDULED",
            Match.kickoff > now,
            or_(Prediction.ai_analysis.is_(None), (Prediction.ai_analyzed_at < now - timedelta(hours=18)) & (Match.kickoff < now + timedelta(hours=8))),
        )
        .order_by(Prediction.confidence.desc())
        .limit(settings.ai_max_per_run)
    ).all()
    done = 0
    for m, p in rows:
        analysis = analyze_match(m, p)
        if analysis:
            p.ai_analysis, p.ai_analyzed_at = dumps(analysis), utc_now()
            db.commit()
            done += 1
    log.info("AI analysed %d/%d fixtures", done, len(rows))
    return done


REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["overall_risk", "verdict", "weak_links", "suggestions"],
    "properties": {
        "overall_risk": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]},
        "verdict": {"type": "string"},
        "weak_links": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False, "required": ["match_id", "reason"],
                      "properties": {"match_id": {"type": "string"}, "reason": {"type": "string"}}},
        },
        "suggestions": {"type": "array", "items": {"type": "string"}},
    },
}  # fmt: skip

REVIEW_SYSTEM = (
    "You review custom tip combinations for O-Jester subscribers (O-Jester is a prediction-tips service, not a betting operator). "
    "Assess the combined risk honestly — combinations compound risk. Identify the weakest selections from the data given "
    "(low probability, negative news, AVOID stances, short odds adding risk without return) and suggest concrete improvements. "
    "Never guarantee outcomes and never encourage anyone to bet. Keep it concise."
)


def review_slip(legs: list[dict], combined: dict, lang: str) -> dict | None:
    if not _client:
        return None
    import anthropic

    try:
        res = _client.beta.messages.create(
            model=settings.ai_model,
            max_tokens=16000,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": REVIEW_SCHEMA}},
            system=f"{REVIEW_SYSTEM}\n\nWrite all text in {'French (natural, as used in Cameroon)' if lang == 'fr' else 'English'}.",
            messages=[{"role": "user", "content": json.dumps({"combined": combined, "selections": legs}, ensure_ascii=False)}],
            **FALLBACK,
        )
        if res.stop_reason == "refusal":
            return None
        return json.loads(_text(res))
    except (anthropic.APIError, ValueError) as exc:
        log.error("slip review failed: %s", exc)
        return None
