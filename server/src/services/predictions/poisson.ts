/**
 * Bivariate Poisson goal model with the Dixon–Coles low-score correction.
 * Reference: Dixon & Coles (1997), "Modelling Association Football Scores and
 * Inefficiencies in the Football Betting Market".
 */

export const MAX_GOALS = 10;
export const DEFAULT_RHO = -0.08;

export function poissonVector(lambda: number, max = MAX_GOALS): number[] {
  const out = new Array<number>(max + 1);
  let p = Math.exp(-lambda);
  out[0] = p;
  for (let k = 1; k <= max; k++) {
    p = (p * lambda) / k;
    out[k] = p;
  }
  return out;
}

/** Score probability matrix m[h][a], normalised to sum to 1. */
export function scoreMatrix(lambdaHome: number, lambdaAway: number, rho = DEFAULT_RHO): number[][] {
  const ph = poissonVector(lambdaHome);
  const pa = poissonVector(lambdaAway);
  const m: number[][] = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    m[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      let tau = 1;
      if (h === 0 && a === 0) tau = 1 - lambdaHome * lambdaAway * rho;
      else if (h === 0 && a === 1) tau = 1 + lambdaHome * rho;
      else if (h === 1 && a === 0) tau = 1 + lambdaAway * rho;
      else if (h === 1 && a === 1) tau = 1 - rho;
      const v = ph[h] * pa[a] * Math.max(tau, 0.0001);
      m[h][a] = v;
      total += v;
    }
  }
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) m[h][a] /= total;
  return m;
}

export interface MatrixMarkets {
  "1X2_H": number;
  "1X2_D": number;
  "1X2_A": number;
  "DC_1X": number;
  "DC_12": number;
  "DC_X2": number;
  OU15_O: number;
  OU15_U: number;
  OU25_O: number;
  OU25_U: number;
  OU35_O: number;
  OU35_U: number;
  BTTS_Y: number;
  BTTS_N: number;
}

export function marketsFromMatrix(m: number[][]): MatrixMarkets {
  let home = 0;
  let draw = 0;
  let away = 0;
  let btts = 0;
  const under = { 1.5: 0, 2.5: 0, 3.5: 0 };
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = m[h][a];
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (h > 0 && a > 0) btts += p;
      const t = h + a;
      if (t < 1.5) under[1.5] += p;
      if (t < 2.5) under[2.5] += p;
      if (t < 3.5) under[3.5] += p;
    }
  }
  return {
    "1X2_H": home,
    "1X2_D": draw,
    "1X2_A": away,
    DC_1X: home + draw,
    DC_12: home + away,
    DC_X2: draw + away,
    OU15_O: 1 - under[1.5],
    OU15_U: under[1.5],
    OU25_O: 1 - under[2.5],
    OU25_U: under[2.5],
    OU35_O: 1 - under[3.5],
    OU35_U: under[3.5],
    BTTS_Y: btts,
    BTTS_N: 1 - btts,
  };
}

export function topScores(m: number[][], n = 6): { home: number; away: number; probability: number }[] {
  const all: { home: number; away: number; probability: number }[] = [];
  for (let h = 0; h <= 6; h++) for (let a = 0; a <= 6; a++) all.push({ home: h, away: a, probability: m[h][a] });
  return all.sort((x, y) => y.probability - x.probability).slice(0, n);
}

export interface MarketTarget {
  home: number;
  draw: number;
  away: number;
  over25?: number;
}

/**
 * Find the goal expectations (λ_home, λ_away) whose Poisson model best
 * reproduces a set of market probabilities. Coarse grid search followed by a
 * local refinement — fast enough (~1ms) to run per fixture.
 */
export function fitLambdas(target: MarketTarget): { lambdaHome: number; lambdaAway: number; error: number } {
  const evaluate = (lh: number, la: number) => {
    const ph = poissonVector(lh, 8);
    const pa = poissonVector(la, 8);
    let home = 0;
    let draw = 0;
    let under25 = 0;
    for (let h = 0; h <= 8; h++) {
      for (let a = 0; a <= 8; a++) {
        const p = ph[h] * pa[a];
        if (h > a) home += p;
        else if (h === a) draw += p;
        if (h + a < 2.5) under25 += p;
      }
    }
    const away = 1 - home - draw;
    let err = (home - target.home) ** 2 + (draw - target.draw) ** 2 + (away - target.away) ** 2;
    if (target.over25 !== undefined) err += (1 - under25 - target.over25) ** 2;
    return err;
  };

  let best = { lambdaHome: 1.4, lambdaAway: 1.1, error: Infinity };
  const search = (fromH: number, toH: number, fromA: number, toA: number, step: number) => {
    for (let lh = fromH; lh <= toH + 1e-9; lh += step) {
      for (let la = fromA; la <= toA + 1e-9; la += step) {
        const e = evaluate(lh, la);
        if (e < best.error) best = { lambdaHome: lh, lambdaAway: la, error: e };
      }
    }
  };
  search(0.2, 4.0, 0.2, 4.0, 0.1);
  const { lambdaHome: ch, lambdaAway: ca } = best;
  search(Math.max(0.05, ch - 0.1), ch + 0.1, Math.max(0.05, ca - 0.1), ca + 0.1, 0.01);
  return best;
}
