"""Betting markets: keys, groups, bilingual labels and settlement on the 90-minute score.

Keys: 1X2_H/D/A · DC_1X/12/X2 · OU15_O/U, OU25_O/U, OU35_O/U · BTTS_Y/N · CS_<h>-<a>
"""

from __future__ import annotations

import re

BASE_MARKETS = (
    "1X2_H", "1X2_D", "1X2_A",
    "DC_1X", "DC_12", "DC_X2",
    "OU15_O", "OU15_U", "OU25_O", "OU25_U", "OU35_O", "OU35_U",
    "BTTS_Y", "BTTS_N",
)  # fmt: skip

CS_RE = re.compile(r"^CS_(\d+)-(\d+)$")
_FIXED_SHORT = {"1X2_H": "1", "1X2_D": "X", "1X2_A": "2", "DC_1X": "1X", "DC_12": "12", "DC_X2": "X2", "BTTS_Y": "GG", "BTTS_N": "NG"}


def is_market_key(key: str) -> bool:
    return key in BASE_MARKETS or bool(CS_RE.match(key))


def market_group(key: str) -> str:
    if key.startswith(("1X2_", "DC_")):
        return "RESULT"
    if key.startswith("CS_"):
        return "SCORE"
    return "GOALS"


def _line(key: str) -> float:
    return int(key[2:4]) / 10  # "OU25_O" -> 2.5


def market_short(key: str, lang: str = "en") -> str:
    cs = CS_RE.match(key)
    if cs:
        return f"{'SE' if lang == 'fr' else 'CS'} {cs[1]}-{cs[2]}"
    if key in _FIXED_SHORT:
        return _FIXED_SHORT[key]
    if key.startswith("OU"):
        over = key.endswith("_O")
        word = ("Plus" if over else "Moins") if lang == "fr" else ("Over" if over else "Under")
        return f"{word} {_line(key)}"
    return key


def market_label(key: str, home: str, away: str, lang: str = "en") -> str:
    fr = lang == "fr"
    cs = CS_RE.match(key)
    if cs:
        return f"Score exact {cs[1]}-{cs[2]}" if fr else f"Correct score {cs[1]}-{cs[2]}"
    labels = {
        "1X2_H": (f"Victoire {home}", f"{home} to win"),
        "1X2_D": ("Match nul", "Draw"),
        "1X2_A": (f"Victoire {away}", f"{away} to win"),
        "DC_1X": (f"{home} ou nul", f"{home} or draw"),
        "DC_12": (f"{home} ou {away} (pas de nul)", f"{home} or {away} (no draw)"),
        "DC_X2": (f"{away} ou nul", f"{away} or draw"),
        "BTTS_Y": ("Les deux équipes marquent — Oui", "Both teams to score — Yes"),
        "BTTS_N": ("Les deux équipes marquent — Non", "Both teams to score — No"),
    }
    if key in labels:
        return labels[key][0 if fr else 1]
    if key.startswith("OU"):
        over = key.endswith("_O")
        line = str(_line(key))
        if fr:
            return f"{'Plus' if over else 'Moins'} de {line.replace('.', ',')} buts"
        return f"{'Over' if over else 'Under'} {line} goals"
    return key


def settle_market(key: str, home: int, away: int) -> str:
    """Return WON or LOST for a selection given the 90-minute score."""
    cs = CS_RE.match(key)
    if cs:
        won = int(cs[1]) == home and int(cs[2]) == away
    elif key.startswith("OU"):
        total = home + away
        won = total > _line(key) if key.endswith("_O") else total < _line(key)
    else:
        rules = {
            "1X2_H": home > away,
            "1X2_D": home == away,
            "1X2_A": away > home,
            "DC_1X": home >= away,
            "DC_12": home != away,
            "DC_X2": away >= home,
            "BTTS_Y": home > 0 and away > 0,
            "BTTS_N": home == 0 or away == 0,
        }
        if key not in rules:
            raise ValueError(f"Unknown market {key}")
        won = rules[key]
    return "WON" if won else "LOST"
