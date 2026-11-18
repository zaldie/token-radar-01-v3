// Token radar model radar-3: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never the
// ceiling) plus every rankable pre-token protocol below the floor — the early
// rows the radar exists to find. A protocol is pre-token when its record carries
// no token (no market cap, no CoinGecko id, no symbol); live-token protocols are
// kept apart and shown at the market's own value, never ranked in the board.
// Membership follows the watchlist's own rule as far as the snapshot's ten
// fields allow: not an exchange, no version marker in the name. The snapshot
// carries no parent-protocol field, so a curator of an existing protocol cannot
// be told apart from a standalone one; the dashboard says so.
//
// Implied value is fitted from the snapshot's own live-token comparables, not
// from a hand-picked constant:
//
//   size curve  log(mcap) = a + b x log(TVL), OLS on the live-token protocols
//               that record a market cap (n = 128 on this snapshot; a = 6.965,
//               b = 0.522). The market's own scaling law: a token is worth
//               proportionally less per TVL dollar as the protocol grows.
//   category tilt  each category's median log(mcap/TVL), winsorized to
//               [0.01, 3.00] and shrunk toward the global median with a prior
//               weight of 4 when the category has fewer than 4 comparables,
//               expressed against the global median. Dexs price 1.60x the
//               market, liquid staking 0.19x.
//   base      = exp(a + b x log(TVL)) x tilt
//   growth    = clamp(change_7d, -60, +60) per cent; 1 + 0.5 x growth/100 when
//               growth <= 0, 1 + 0.4 x growth/100 when growth > 0. The week's
//               median move is -5.6% and the 90th percentile is +4.7%, so a
//               +60% week is already exceptional; the +4,448% week caps at +24%.
//   maturity  = 0.6 + 0.4 x (1 - exp(-age_days / 365)); most credit in year
//               one, then a plateau. Unknown age counts as 180 days.
//   reach     = 1 + 0.02 x min(chains - 1, 5)   (max 1.10)
//   implied   = max(1, round(base x growth x maturity x reach))
//
// Validation is computed on the same snapshot and shown on the dashboard:
// leave-one-out over the live-token comparables (each token predicted from a
// fit that never saw it), and a walk-forward split (fit on tokens listed
// before 2025-01-01, tested on those listed after). No point predictor is
// precise — one token's market cap varies roughly 200x around its category's
// median — so implied values are order-of-magnitude guides, and every row
// carries the rank range it takes across 200 bootstrap refits of the
// comparables (seeded, deterministic), so the reader sees the uncertainty.
//
// No protocol name is ever special-cased: the same function scores every row,
// and every farm plan is generated from the protocol's own category, chains,
// TVL and age.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The radar-3 constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_chains: number;
  winsor_lo: number;
  winsor_hi: number;
  shrink_prior: number;
  shrink_min_n: number;
  bootstrap_refits: number;
  bootstrap_seed: number;
}

export const MODEL: ModelConstants = {
  growth_weight_up: 0.4,
  growth_weight_down: 0.5,
  growth_floor: -60,
  growth_cap: 60,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 365,
  unknown_age_days: 180,
  reach_per_chain: 0.02,
  reach_max_chains: 5,
  winsor_lo: 0.01,
  winsor_hi: 3.0,
  shrink_prior: 4,
  shrink_min_n: 4,
  bootstrap_refits: 200,
  bootstrap_seed: 20261114,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The walk-forward split: fit on tokens listed before this day, test after. */
export const WALK_FORWARD_CUT = '2025-01-01';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The fitted size curve and category tilts: the model's own numbers. */
export interface SizeFit {
  intercept: number;
  slope: number;
  global_log_median: number;
  global_median_ratio: number;
  comparables: number;
  /** Category key -> shrunk median log ratio; the tilt is exp(value - global). */
  category_log_median: Record<string, number>;
  /** Category key -> number of live-token comparables behind the median. */
  category_n: Record<string, number>;
}

/** One validation number set: median error and the share predicted within 2x. */
export interface ValidationCheck {
  n: number;
  median_abs_pct_error: number;
  within_2x_pct: number;
}

/** The model's validation, all computed from the snapshot. */
export interface Validation {
  loo: ValidationCheck;
  loo_flat: ValidationCheck;
  walk_forward: ValidationCheck;
  walk_forward_flat: ValidationCheck;
  walk_forward_train_n: number;
  walk_forward_test_n: number;
  bootstrap_refits: number;
  top10_median_range_width: number;
}

/** One category's comparables, for the dashboard's comparables table. */
export interface ComparableRow {
  category: string;
  n: number;
  median_ratio: number;
  tilt: number;
  p25_ratio: number;
  p75_ratio: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_base_usd: number;
    tilt: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  rank_lo: number;
  rank_hi: number;
  watchlist: boolean;
  total_cost_usd: number;
  farm_steps: string[];
}

/** One board row in the compact form data.js carries, farm steps included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  size_base_usd: number;
  tilt: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  rank_lo: number;
  rank_hi: number;
  watchlist: boolean;
  total_cost_usd: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: SizeFit;
  validation: Validation;
  comparables: ComparableRow[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty array, or `fallback` when empty. */
function median(values: number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A quantile of an array (linear on the sorted order), or `fallback` when empty. */
function quantile(values: number[], p: number, fallback = 0): number {
  if (values.length === 0) return fallback;
  const s = [...values].sort((a, b) => a - b);
  const at = Math.min(s.length - 1, Math.floor(p * (s.length - 1)));
  return s[at]!;
}

/** A seeded PRNG (mulberry32): the bootstrap refits are deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The category key the fit uses: the snapshot's category, or 'Other' when null. */
function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? 'Other';
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol can serve as a live-token comparable: a token with a market cap. */
function isComparable(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.gecko_id !== null;
}

/** The winsorized market-cap-to-TVL ratio of one comparable. */
function ratioOf(p: SnapshotProtocol, model: ModelConstants): number {
  const r = (p.mcap_usd ?? 0) / p.tvl_usd;
  return Math.min(model.winsor_hi, Math.max(model.winsor_lo, r));
}

/** Ordinary least squares on log(TVL) -> log(mcap): the size curve. */
function olsLogLog(comps: SnapshotProtocol[]): { intercept: number; slope: number } {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd ?? 1));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/**
 * Fit the size curve and the category tilts from a set of live-token
 * comparables. The tilt of a category is its shrunk median log ratio against
 * the global median: thin categories are pulled toward the market as a whole.
 */
export function fitSizeCurve(comps: SnapshotProtocol[], model: ModelConstants = MODEL): SizeFit {
  const { intercept, slope } = olsLogLog(comps);
  const globalLogMedian = median(comps.map((p) => Math.log(ratioOf(p, model))));
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const k = categoryKey(p);
    const arr = byCat.get(k) ?? [];
    arr.push(Math.log(ratioOf(p, model)));
    byCat.set(k, arr);
  }
  const categoryLogMedian: Record<string, number> = {};
  const categoryN: Record<string, number> = {};
  for (const [k, logs] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = median(logs);
    categoryLogMedian[k] =
      logs.length >= model.shrink_min_n ? m : (logs.length * m + model.shrink_prior * globalLogMedian) / (logs.length + model.shrink_prior);
    categoryN[k] = logs.length;
  }
  return {
    intercept,
    slope,
    global_log_median: globalLogMedian,
    global_median_ratio: Math.exp(globalLogMedian),
    comparables: comps.length,
    category_log_median: categoryLogMedian,
    category_n: categoryN,
  };
}

/** The category tilt of one protocol under a fit: 1 when its category has no comparables. */
export function tiltOf(p: SnapshotProtocol, fit: SizeFit): number {
  const lm = fit.category_log_median[categoryKey(p)];
  if (lm === undefined) return 1;
  return Math.exp(lm - fit.global_log_median);
}

/** The size-curve base of one protocol: what the market pays for its TVL, before the tilt. */
export function sizeBaseOf(p: SnapshotProtocol, fit: SizeFit): number {
  return Math.exp(fit.intercept + fit.slope * Math.log(Math.max(1, p.tvl_usd)));
}

export interface ScoredValue {
  implied: number;
  sizeBase: number;
  tilt: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  reachMult: number;
  age: number | null;
}

/** The multipliers and the implied value one protocol gets under radar-3. */
export function impliedValue(p: SnapshotProtocol, asOf: string, fit: SizeFit, model: ModelConstants): ScoredValue {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct <= 0 ? model.growth_weight_down : model.growth_weight_up;
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(0, ageForModel) / model.maturity_days));
  const extraChains = Math.max(0, p.chains.length - 1);
  const reachMult = 1 + model.reach_per_chain * Math.min(extraChains, model.reach_max_chains);
  const sizeBase = sizeBaseOf(p, fit);
  const tilt = tiltOf(p, fit);
  const implied = Math.max(1, Math.round(sizeBase * tilt * growthMult * maturityMult * reachMult));
  return { implied, sizeBase, tilt, growthPct, growthMult, maturityMult, reachMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** One validation check from a list of predicted/actual ratios. */
function checkFromRatios(ratios: number[]): ValidationCheck {
  const within = ratios.filter((r) => r >= 0.5 && r <= 2).length;
  return {
    n: ratios.length,
    median_abs_pct_error: round2(median(ratios.map((r) => Math.abs(r - 1))) * 100),
    within_2x_pct: ratios.length === 0 ? 0 : round2((100 * within) / ratios.length),
  };
}

/** Leave-one-out: each live token predicted from a fit that never saw it. */
function leaveOneOut(comps: SnapshotProtocol[], model: ModelConstants): { fitted: ValidationCheck; flat: ValidationCheck } {
  const fittedRatios: number[] = [];
  const flatRatios: number[] = [];
  for (const p of comps) {
    const rest = comps.filter((x) => x.slug !== p.slug);
    const fit = fitSizeCurve(rest, model);
    const pred = sizeBaseOf(p, fit) * tiltOf(p, fit);
    fittedRatios.push(pred / (p.mcap_usd ?? 1));
    flatRatios.push((p.tvl_usd * 0.25) / (p.mcap_usd ?? 1));
  }
  return { fitted: checkFromRatios(fittedRatios), flat: checkFromRatios(flatRatios) };
}

/** Walk-forward: fit on tokens listed before the cut, test on those listed after. */
function walkForward(
  comps: SnapshotProtocol[],
  cut: string,
  model: ModelConstants,
): { fitted: ValidationCheck; flat: ValidationCheck; trainN: number; testN: number } {
  const train = comps.filter((p) => p.listed_at !== null && p.listed_at < cut);
  const test = comps.filter((p) => p.listed_at !== null && p.listed_at >= cut);
  const fit = fitSizeCurve(train, model);
  const fittedRatios: number[] = [];
  const flatRatios: number[] = [];
  for (const p of test) {
    const pred = sizeBaseOf(p, fit) * tiltOf(p, fit);
    fittedRatios.push(pred / (p.mcap_usd ?? 1));
    flatRatios.push((p.tvl_usd * 0.25) / (p.mcap_usd ?? 1));
  }
  return { fitted: checkFromRatios(fittedRatios), flat: checkFromRatios(flatRatios), trainN: train.length, testN: test.length };
}

/**
 * Bootstrap rank ranges: resample the comparables with replacement *within
 * each category* (stratified, so no category ever loses all its comparables),
 * refit, rescore the board, and record each row's rank across refits. The
 * 10th and 90th percentile ranks are the row's rank range. Deterministic: one
 * seeded PRNG drives every refit.
 */
function bootstrapRanges(
  boardProtocols: SnapshotProtocol[],
  comps: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants,
): Map<string, { lo: number; hi: number }> {
  const rng = mulberry32(model.bootstrap_seed);
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of comps) {
    const k = categoryKey(p);
    const arr = groups.get(k) ?? [];
    arr.push(p);
    groups.set(k, arr);
  }
  const groupList = [...groups.values()];
  const ranks = new Map<string, number[]>();
  for (let refit = 0; refit < model.bootstrap_refits; refit++) {
    const sample: SnapshotProtocol[] = [];
    for (const group of groupList) {
      for (let i = 0; i < group.length; i++) sample.push(group[Math.floor(rng() * group.length)]!);
    }
    const fit = fitSizeCurve(sample, model);
    const scored = boardProtocols
      .map((p) => ({ slug: p.slug, implied: impliedValue(p, asOf, fit, model).implied }))
      .sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    scored.forEach((s, i) => {
      const arr = ranks.get(s.slug) ?? [];
      arr.push(i + 1);
      ranks.set(s.slug, arr);
    });
  }
  const out = new Map<string, { lo: number; hi: number }>();
  for (const [slug, arr] of ranks) out.set(slug, { lo: quantile(arr, 0.1), hi: quantile(arr, 0.9) });
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, whatever its TVL.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, by TVL.
  // No cap: on this snapshot that is 186 rows, so the board is 40 + 186 = 226.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const boardProtocols = [...chosen.values()];
  const comps = snapshot.protocols.filter(isComparable);
  const fit = fitSizeCurve(comps, model);
  const ranges = bootstrapRanges(boardProtocols, comps, snapshot.as_of, model);

  const scored = boardProtocols.map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const range = ranges.get(s.p.slug) ?? { lo: i + 1, hi: i + 1 };
    const steps = farmSteps(s.p, s.v.age);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      model: {
        size_base_usd: s.v.sizeBase,
        tilt: s.v.tilt,
        growth_pct: s.v.growthPct,
        growth_multiplier: s.v.growthMult,
        maturity_multiplier: s.v.maturityMult,
        reach_multiplier: s.v.reachMult,
        age_days: s.v.age,
      },
      rank_lo: range.lo,
      rank_hi: range.hi,
      watchlist: snapshot.watchlist.includes(s.p.slug),
      total_cost_usd: totalCostUsd(s.p, s.v.age),
      farm_steps: steps.map(stepText),
    };
  });
}

/** One step as a single string: action, cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Cheap chains where a weekly action costs almost nothing. */
const CHEAP_L2 = new Set([
  'Arbitrum',
  'Base',
  'Blast',
  'Fraxtal',
  'Ink',
  'Linea',
  'Mantle',
  'Metis',
  'Mode',
  'Optimism',
  'Polygon',
  'Polygon zkEVM',
  'Scroll',
  'Soneium',
  'Starknet',
  'Taiko',
  'Unichain',
  'Zircuit',
  'zkSync Era',
]);

/** Gas per weekly action on one chain, in whole dollars (the midpoint of the note's range). */
function gasPerWeekUsd(chain: string): number {
  if (chain === 'Ethereum') return 10;
  if (chain === 'Solana') return 0;
  if (CHEAP_L2.has(chain)) return 1;
  return 2;
}

/** The gas note for one chain, so the plan states what each action costs there. */
function gasNote(chain: string): { text: string; cost: string } {
  if (chain === 'Ethereum') {
    return {
      text: `Expect about $5–15 of gas per transaction on Ethereum, so batch your actions and farm during quiet hours instead of paying peak fees.`,
      cost: 'about $5–15 of gas per transaction',
    };
  }
  if (chain === 'Solana') {
    return {
      text: `Solana fees run under $0.10 per transaction, so the weekly actions in this plan cost almost nothing in gas.`,
      cost: 'under $0.10 of gas per transaction',
    };
  }
  if (CHEAP_L2.has(chain)) {
    return {
      text: `Fees on ${chain} usually stay under $1 per transaction, so a weekly action costs less than a coffee in gas.`,
      cost: 'under $1 of gas per transaction',
    };
  }
  return {
    text: `Expect roughly $1–3 of gas per transaction on ${chain}, and check the fee before each weekly action.`,
    cost: 'about $1–3 of gas per transaction',
  };
}

/** The whole plan's cost: the capital plus the weekly gas over the hold window. */
export function totalCostUsd(p: SnapshotProtocol, age: number | null): number {
  const weeks = Math.ceil(holdDaysFor(age) / 7);
  return capitalFor(p) + gasPerWeekUsd(chainOf(p)) * weeks;
}

interface CategoryPlan {
  action: string;
  second: string;
  weekly: string;
}

/** The category's entry action, its second-feature action and its weekly qualifying action. */
function planFor(p: SnapshotProtocol, capital: number, chain: string): CategoryPlan {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return {
      action: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and swap a small amount through it, then keep the position open.`,
      second: `Stake the LP rewards or vote in ${name}'s governance once, so the wallet touches a second feature of the protocol.`,
      weekly: `Swap a small amount through ${name} and add or rebalance a little liquidity so the week counts as active.`,
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      action: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and keep both sides open.`,
      second: `Use the borrowed funds once inside ${name}'s own app, then repay a little of the borrow so both sides stay active.`,
      weekly: `Repay a little of the borrow and borrow again, or top up the supply, so the week counts as active.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      action: `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`,
      second: `Bridge a second, smaller amount back or to another chain ${name} supports, so the wallet shows two-way use.`,
      weekly: `Bridge a small amount through ${name} again and use the funds on the destination chain.`,
    };
  }
  if (c.includes('liquid staking') || c.includes('staking pool') || c.includes('restak')) {
    return {
      action: `Stake $${capital} of the chain's staking asset through ${name} on ${chain}, keep the receipt token, and use it in one DeFi app.`,
      second: `Deposit the receipt token into a lending market or a liquidity pool, so it works in DeFi instead of sitting idle.`,
      weekly: `Restake the rewards or top up the stake a little, and keep the receipt token working in DeFi.`,
    };
  }
  if (c.includes('risk curator') || c.includes('onchain capital') || c.includes('allocator')) {
    return {
      action: `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares for the whole farming window.`,
      second: `Compare two of ${name}'s vaults and move a small amount into the second one, so the wallet uses more than one vault.`,
      weekly: `Check the vault's yield, deposit a little more or move between its vaults once.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      action: `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the whole farming window.`,
      second: `Claim the yield once if the protocol offers it, or use the asset as collateral in one DeFi app.`,
      weekly: `Check the yield accrued, claim it if the protocol offers it, and hold the asset.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis trading')) {
    return {
      action: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedge, then keep the margin posted.`,
      second: `Close the first hedge and open a second one on a different market, so the wallet shows more than one position.`,
      weekly: `Open and close one small hedge so the week counts as active, keeping the margin posted.`,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity manager')) {
    return {
      action: `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the vault shares for the whole farming window.`,
      second: `Harvest the yield once and deposit it back into the vault, so the wallet shows a harvest and a redeposit.`,
      weekly: `Harvest the yield or compound it back into the vault once a week.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      action: `Fund $${capital} on ${name} on ${chain} and place one market position, then keep funds on the platform.`,
      second: `Place a second position on a different market, so the wallet is not a one-bet account.`,
      weekly: `Place one new market position and settle or close an old one.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      action: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole farming window.`,
      second: `File a test claim or check the claims page once, so the wallet touches the cover's second feature.`,
      weekly: `Check the policy and the protocol's rewards page, and renew or extend the cover if it lapses.`,
    };
  }
  if (c.includes('stablecoin') || c.includes('stable')) {
    return {
      action: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it for the whole farming window.`,
      second: `Use the stable asset once in a pool or a lending market, so it moves instead of sitting in the wallet.`,
      weekly: `Mint a little more or move the stable asset between the protocol's pools once.`,
    };
  }
  if (c.includes('governance')) {
    return {
      action: `Deposit $${capital} into ${name} on ${chain} and lock it in the governance vault if one is offered.`,
      second: `Delegate the vote to a delegate or vote on a second proposal, so the wallet shows two governance actions.`,
      weekly: `Vote on one live proposal, or deposit a little more if no vote is open.`,
    };
  }
  if (c.includes('index')) {
    return {
      action: `Buy $${capital} of ${name}'s index token on ${chain} and hold it for the whole farming window.`,
      second: `Check the index rebalance and add a little to the position if the mix changed.`,
      weekly: `Check the index rebalance and top up the position a little if the mix changed.`,
    };
  }
  if (c.includes('payment') || c.includes('card')) {
    return {
      action: `Deposit $${capital} into ${name} on ${chain} and pay for one real purchase or transfer through it.`,
      second: `Make a second payment to a different merchant or recipient, so the wallet shows repeat use.`,
      weekly: `Make one payment or transfer through ${name} so the week counts as active.`,
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the whole farming window.`,
    second: `Use a second feature of ${name} once, such as a swap, a vote or a claim, so the wallet is not a single-deposit account.`,
    weekly: `Make one qualifying action each week, such as a deposit, a swap, a borrow or a vote.`,
  };
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time,
 * plus the plan's total cost. Derived from the protocol's own record
 * (category, chains, TVL, age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const plan = planFor(p, capital, chain);
  const gas = gasNote(chain);
  const total = totalCostUsd(p, age);
  const weeks = Math.ceil(hold / 7);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase written down offline, never in a screenshot or a chat.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: plan.action, cost: `$${capital} of capital and a few dollars of gas`, time: '15 minutes to set up' },
    { text: plan.second, cost: gas.cost, time: '10 minutes' },
    { text: plan.weekly, cost: gas.cost, time: '10 minutes a week' },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    { text: gas.text, cost: gas.cost, time: '5 minutes a week to check fees' },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim an airdrop for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Never pay anyone to claim for you, and after you withdraw, revoke the approvals you gave the protocol so the wallet is clean.`,
      cost: 'one small gas fee to revoke',
      time: '5 minutes',
    },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it later. The whole plan costs about $${total}: $${capital} of capital plus roughly $${total - capital} of gas over ${weeks} weeks.`,
      cost: `about $${total} in total`,
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The comparables table: one row per category with live-token comparables. */
export function comparableRows(snapshot: Snapshot, model: ModelConstants = MODEL): ComparableRow[] {
  const comps = snapshot.protocols.filter(isComparable);
  const fit = fitSizeCurve(comps, model);
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const k = categoryKey(p);
    const arr = byCat.get(k) ?? [];
    arr.push(ratioOf(p, model));
    byCat.set(k, arr);
  }
  return [...byCat.entries()]
    .map(([category, ratios]) => ({
      category,
      n: ratios.length,
      median_ratio: round4(median(ratios)),
      tilt: round4(Math.exp((fit.category_log_median[category] ?? fit.global_log_median) - fit.global_log_median)),
      p25_ratio: round4(quantile(ratios, 0.25)),
      p75_ratio: round4(quantile(ratios, 0.75)),
    }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
}

/** A board row's compact form for data.js, farm steps included so the page shows the board's own plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    size_base_usd: row.model.size_base_usd,
    tilt: row.model.tilt,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    rank_lo: row.rank_lo,
    rank_hi: row.rank_hi,
    watchlist: row.watchlist,
    total_cost_usd: row.total_cost_usd,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = snapshot.protocols.filter(isComparable);
  const fit = fitSizeCurve(comps, model);
  const loo = leaveOneOut(comps, model);
  const wf = walkForward(comps, WALK_FORWARD_CUT, model);
  const top10 = board.slice(0, 10);
  const validation: Validation = {
    loo: loo.fitted,
    loo_flat: loo.flat,
    walk_forward: wf.fitted,
    walk_forward_flat: wf.flat,
    walk_forward_train_n: wf.trainN,
    walk_forward_test_n: wf.testN,
    bootstrap_refits: model.bootstrap_refits,
    top10_median_range_width: median(top10.map((r) => r.rank_hi - r.rank_lo)),
  };
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    validation,
    comparables: comparableRows(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.rank_lo < 1 || r.rank_hi < r.rank_lo || r.rank_hi > board.length) return `${r.slug} has rank range ${r.rank_lo}–${r.rank_hi}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
