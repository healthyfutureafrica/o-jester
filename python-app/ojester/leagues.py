"""League catalogue with provider ids. `tier` controls which plan can see a league."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class League:
    key: str
    name: str
    country: str
    tier: int
    api_football_id: int | None = None
    football_data_code: str | None = None


LEAGUES: list[League] = [
    # Tier 1 — Starter and above
    League("eng-pl", "Premier League", "England", 1, 39, "PL"),
    League("esp-laliga", "La Liga", "Spain", 1, 140, "PD"),
    League("ita-seriea", "Serie A", "Italy", 1, 135, "SA"),
    League("ger-bundesliga", "Bundesliga", "Germany", 1, 78, "BL1"),
    League("fra-ligue1", "Ligue 1", "France", 1, 61, "FL1"),
    League("uefa-ucl", "UEFA Champions League", "Europe", 1, 2, "CL"),
    # Tier 2 — Pro and above
    League("uefa-uel", "UEFA Europa League", "Europe", 2, 3),
    League("uefa-uecl", "UEFA Conference League", "Europe", 2, 848),
    League("ned-eredivisie", "Eredivisie", "Netherlands", 2, 88, "DED"),
    League("por-primeira", "Primeira Liga", "Portugal", 2, 94, "PPL"),
    League("eng-championship", "Championship", "England", 2, 40, "ELC"),
    League("tur-superlig", "Süper Lig", "Turkey", 2, 203),
    League("bel-pro", "Pro League", "Belgium", 2, 144),
    League("sco-prem", "Premiership", "Scotland", 2, 179),
    League("bra-seriea", "Brasileirão Série A", "Brazil", 2, 71, "BSA"),
    League("arg-lpf", "Liga Profesional", "Argentina", 2, 128),
    League("usa-mls", "Major League Soccer", "USA", 2, 253),
    League("mex-ligamx", "Liga MX", "Mexico", 2, 262),
    League("ksa-pro", "Saudi Pro League", "Saudi Arabia", 2, 307),
    # Tier 3 — Elite only
    League("caf-cl", "CAF Champions League", "Africa", 3, 12),
    League("caf-afcon", "Africa Cup of Nations", "Africa", 3, 6),
    League("fifa-wcq-africa", "World Cup Qualifiers — Africa", "Africa", 3, 29),
    League("egy-premier", "Egyptian Premier League", "Egypt", 3, 233),
    League("mar-botola", "Botola Pro", "Morocco", 3, 200),
    League("rsa-premier", "Premiership", "South Africa", 3, 288),
    League("fifa-wc", "FIFA World Cup", "World", 3, 1, "WC"),
    League("uefa-euro", "UEFA European Championship", "Europe", 3, 4, "EC"),
    League("uefa-nations", "UEFA Nations League", "Europe", 3, 5),
    League("conmebol-libertadores", "Copa Libertadores", "South America", 3, 13),
    League("ger-bundesliga2", "2. Bundesliga", "Germany", 3, 79),
    League("ita-serieb", "Serie B", "Italy", 3, 136),
    League("esp-laliga2", "La Liga 2", "Spain", 3, 141),
    League("fra-ligue2", "Ligue 2", "France", 3, 62),
    League("den-superliga", "Superliga", "Denmark", 3, 119),
    League("sui-super", "Super League", "Switzerland", 3, 207),
    League("aut-bundesliga", "Bundesliga", "Austria", 3, 218),
    League("gre-super", "Super League", "Greece", 3, 197),
]

BY_KEY = {lg.key: lg for lg in LEAGUES}
BY_API_FOOTBALL = {lg.api_football_id: lg for lg in LEAGUES if lg.api_football_id}
BY_FOOTBALL_DATA = {lg.football_data_code: lg for lg in LEAGUES if lg.football_data_code}


def league_tier(key: str) -> int:
    lg = BY_KEY.get(key)
    return lg.tier if lg else 3
