"""French / English translations. Message files: en.json, fr.json; legal notice: legal.json."""

from __future__ import annotations

import json
import re
from pathlib import Path

LANGS = ("en", "fr")
_DIR = Path(__file__).parent


def _load(name: str) -> dict:
    return json.loads((_DIR / name).read_text(encoding="utf-8"))


MESSAGES: dict[str, dict[str, str]] = {lang: _load(f"{lang}.json") for lang in LANGS}
LEGAL: dict = _load("legal.json")

_VAR = re.compile(r"\{(\w+)\}")


def t(key: str, lang: str = "en", **vars: object) -> str:
    """Translate a message key; unknown keys are returned unchanged."""
    template = MESSAGES.get(lang, MESSAGES["en"]).get(key) or MESSAGES["en"].get(key) or key
    if not vars:
        return template
    return _VAR.sub(lambda m: str(vars[m.group(1)]) if m.group(1) in vars else m.group(0), template)


def pick_lang(explicit: str | None, accept_language: str | None) -> str:
    if explicit in LANGS:
        return explicit  # type: ignore[return-value]
    if accept_language:
        for part in accept_language.split(","):
            code = part.split(";")[0].strip().lower()[:2]
            if code in LANGS:
                return code
    return "en"
