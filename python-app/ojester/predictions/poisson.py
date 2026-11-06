"""Bivariate Poisson goal model with the Dixon–Coles low-score correction.

Reference: Dixon & Coles (1997), "Modelling Association Football Scores and
Inefficiencies in the Football Betting Market".
"""

from __future__ import annotations

import math

MAX_GOALS = 10
DEFAULT_RHO = -0.08


def poisson_vector(lam: float, max_goals: int = MAX_GOALS) -> list[float]:
    out = [math.exp(-lam)]
    for k in range(1, max_goals + 1):
        out.append(out[-1] * lam / k)
    return out


def score_matrix(lh: float, la: float, rho: float = DEFAULT_RHO) -> list[list[float]]:
    """Score probability matrix m[h][a], normalised to sum to 1."""
    ph, pa = poisson_vector(lh), poisson_vector(la)
    m = [[0.0] * (MAX_GOALS + 1) for _ in range(MAX_GOALS + 1)]
    total = 0.0
    for h in range(MAX_GOALS + 1):
        for a in range(MAX_GOALS + 1):
            tau = 1.0
            if h == 0 and a == 0:
                tau = 1 - lh * la * rho
            elif h == 0 and a == 1:
                tau = 1 + lh * rho
            elif h == 1 and a == 0:
                tau = 1 + la * rho
            elif h == 1 and a == 1:
                tau = 1 - rho
            v = ph[h] * pa[a] * max(tau, 0.0001)
            m[h][a] = v
            total += v
    return [[v / total for v in row] for row in m]


def markets_from_matrix(m: list[list[float]]) -> dict[str, float]:
    home = draw = away = btts = 0.0
    under = {1.5: 0.0, 2.5: 0.0, 3.5: 0.0}
    for h, row in enumerate(m):
        for a, p in enumerate(row):
            if h > a:
                home += p
            elif h == a:
                draw += p
            else:
                away += p
            if h > 0 and a > 0:
                btts += p
            for line in under:
                if h + a < line:
                    under[line] += p
    return {
        "1X2_H": home,
        "1X2_D": draw,
        "1X2_A": away,
        "DC_1X": home + draw,
        "DC_12": home + away,
        "DC_X2": draw + away,
        "OU15_O": 1 - under[1.5],
        "OU15_U": under[1.5],
        "OU25_O": 1 - under[2.5],
        "OU25_U": under[2.5],
        "OU35_O": 1 - under[3.5],
        "OU35_U": under[3.5],
        "BTTS_Y": btts,
        "BTTS_N": 1 - btts,
    }


def top_scores(m: list[list[float]], n: int = 6) -> list[dict]:
    scores = [{"home": h, "away": a, "probability": m[h][a]} for h in range(7) for a in range(7)]
    return sorted(scores, key=lambda s: s["probability"], reverse=True)[:n]


def fit_lambdas(home: float, draw: float, away: float, over25: float | None = None) -> tuple[float, float]:
    """Goal expectations whose Poisson model best reproduces market probabilities (grid search + refinement)."""
    cache: dict[float, list[float]] = {}

    def vec(lam: float) -> list[float]:
        key = round(lam, 3)
        if key not in cache:
            cache[key] = poisson_vector(lam, 8)
        return cache[key]

    def error(lh: float, la: float) -> float:
        ph, pa = vec(lh), vec(la)
        p_home = p_draw = under = 0.0
        for h in range(9):
            for a in range(9):
                p = ph[h] * pa[a]
                if h > a:
                    p_home += p
                elif h == a:
                    p_draw += p
                if h + a < 2.5:
                    under += p
        p_away = 1 - p_home - p_draw
        err = (p_home - home) ** 2 + (p_draw - draw) ** 2 + (p_away - away) ** 2
        if over25 is not None:
            err += (1 - under - over25) ** 2
        return err

    best = (1.4, 1.1, float("inf"))

    def search(h0: float, h1: float, a0: float, a1: float, step: float) -> None:
        nonlocal best
        lh = h0
        while lh <= h1 + 1e-9:
            la = a0
            while la <= a1 + 1e-9:
                e = error(lh, la)
                if e < best[2]:
                    best = (lh, la, e)
                la += step
            lh += step

    search(0.2, 4.0, 0.2, 4.0, 0.1)
    ch, ca, _ = best
    search(max(0.05, ch - 0.1), ch + 0.1, max(0.05, ca - 0.1), ca + 0.1, 0.01)
    return best[0], best[1]
