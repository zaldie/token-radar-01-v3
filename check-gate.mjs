// Gate self-check for the token-radar-01 output.
// Usage: node check-gate.mjs <out-dir> <snapshot.json>
// Exits 0 when every check passes, 1 otherwise.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'out';
const snapshotFile = process.argv[3];
if (!snapshotFile) {
  process.stderr.write('usage: node check-gate.mjs <out-dir> <snapshot.json>\n');
  process.exit(2);
}

const failures = [];
const notes = [];
function check(ok, label, detail = '') {
  if (ok) notes.push(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
  else failures.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
const board = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
const rows = Array.isArray(board) ? board : board.rows;

const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
const watch = snapshot.watchlist;

check(Array.isArray(rows), 'board.json rows is an array');
check(rows.length === 226, 'row count is 226', `${rows.length} rows`);
check(new Set(rows.map((r) => r.slug)).size === rows.length, 'slugs are unique');
check(rows.every((r) => snapSlugs.has(r.slug)), 'every slug is a snapshot protocol');
check(rows.every((r) => typeof r.name === 'string' && r.name.length > 0), 'every name is non-empty');

const missing = watch.filter((s) => !rows.some((r) => r.slug === s));
check(missing.length === 0, 'watchlist coverage 40/40', missing.length ? `missing: ${missing.join(', ')}` : 'all 40 covered');
check(
  watch.filter((s) => rows.some((r) => r.slug === s)).length === 40,
  'watchlist count',
  `${watch.filter((s) => rows.some((r) => r.slug === s)).length}/40`,
);

const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
check(ranks.length > 0 && ranks.every((r, i) => r === i + 1), 'ranks are exactly 1..N', `N=${ranks.length}`);
const byRank = [...rows].sort((a, b) => a.rank - b.rank);
const nonIncreasing = byRank.every((r, i) => i === 0 || r.implied_value_usd <= byRank[i - 1].implied_value_usd);
check(nonIncreasing, 'implied_value_usd non-increasing by rank');
check(
  !(byRank.length >= 2 && byRank[0].implied_value_usd === byRank[byRank.length - 1].implied_value_usd),
  'implied values are not all equal',
  `rank 1 $${byRank[0]?.implied_value_usd}, rank ${byRank.length} $${byRank[byRank.length - 1]?.implied_value_usd}`,
);
check(
  byRank.every((r) => Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0),
  'implied values are positive whole dollars',
);
check(byRank.every((r) => r.token_status === 'pre-token'), 'every row is pre-token');
check(byRank.every((r) => r.mcap_usd === null && r.gecko_id === null && r.symbol === null), 'no row carries a token');

let badSteps = 0;
let minLen = Infinity;
let maxLen = 0;
let stepCounts = new Set();
for (const r of rows) {
  stepCounts.add(r.farm_steps.length);
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) badSteps++;
  for (const s of r.farm_steps ?? []) {
    const t = s.trim().length;
    minLen = Math.min(minLen, t);
    maxLen = Math.max(maxLen, t);
    if (t < 20 || t > 600) badSteps++;
  }
}
check(badSteps === 0, 'farm steps 3–12 per row, each 20–600 chars', `step counts: ${[...stepCounts].sort().join(', ')}, lengths ${minLen}–${maxLen}`);
check(stepCounts.size === 1 && stepCounts.has(9), 'every row has 9 farm steps');

// data.js must agree with board.json: same rows, same implied values, radar-2 model.
const dataJs = readFileSync(join(outDir, 'data.js'), 'utf8');
const radar = JSON.parse(dataJs.replace(/^window\.RADAR=/, '').replace(/;\s*$/, ''));
check(radar.model_version === 'radar-3', 'data.js model_version is radar-3', radar.model_version);
check(radar.board_size === rows.length, 'data.js board_size matches board.json', `${radar.board_size} vs ${rows.length}`);
check(radar.watchlist_size === 40, 'data.js watchlist_size is 40', `${radar.watchlist_size}`);
check(radar.early_size === 186, 'data.js early_size is 186', `${radar.early_size}`);
check(radar.live_size === 24, 'data.js live_size is 24', `${radar.live_size}`);
const dataBySlug = new Map(radar.rows.map((r) => [r.slug, r]));
check(
  rows.every((r) => dataBySlug.get(r.slug)?.implied_value_usd === r.implied_value_usd),
  'data.js implied values match board.json',
);
check(
  rows.every((r) => JSON.stringify(dataBySlug.get(r.slug)?.farm_steps) === JSON.stringify(r.farm_steps)),
  'data.js farm steps match board.json',
);
check(radar.rows.every((r) => typeof r.reach_multiplier === 'number'), 'data.js rows carry reach_multiplier');

for (const n of notes) console.log(n);
for (const f of failures) console.log(f);
console.log(failures.length === 0 ? `GATE SELF-CHECK: ALL PASS (${rows.length} rows)` : `GATE SELF-CHECK: ${failures.length} FAILURE(S)`);
process.exit(failures.length === 0 ? 0 : 1);
