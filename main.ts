// Token Radar — radar-3.
//
// The entrypoint: read the sealed snapshot, score the pre-token board, and
// write everything the grader reads into /output.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for /output.
// The write order is deliberate and the scorer depends on it:
//
//   1. board.json and data.js are written first, from the model.
//   2. dashboard/ and screenshots/ are copied in as they stand.
//   3. dossier.json is written LAST, built from exactly what was copied —
//      the scorer rebuilds the dossier from /output and compares bytes, so
//      the dossier must describe the files that are actually there.
//
// Node 22, standard library only. Deterministic: every figure comes from the
// snapshot's own as_of date, so two runs of the same snapshot write the same
// bytes. The program never touches the network.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The directory this file lives in, used to find dashboard/ and screenshots/.
const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * The scorer's own caps, mirrored here so the dossier we write agrees with
 * the one the scorer rebuilds: the text cap shapes the dossier's bytes, the
 * screenshot caps refuse an entry that ships too many or too large images.
 */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };

/** A screenshot file name: letters, digits and . _ -, 1 to 128 characters. */
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * Read one `--name <value>` (or `--name=<value>`) argument out of the
 * command line, falling back when the flag is absent. The two spellings are
 * checked in order: a bare value first, then the equals form.
 */
function readArgument(name: string, fallback: string): string {
  const flag = `--${name}`;
  const bareIndex = process.argv.indexOf(flag);
  if (bareIndex >= 0 && bareIndex + 1 < process.argv.length) {
    return process.argv[bareIndex + 1]!;
  }
  const equalsForm = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (equalsForm === undefined) return fallback;
  return equalsForm.slice(flag.length + 1);
}

/**
 * Resolve the snapshot path: a path ending in .json is the file itself,
 * anything else is a directory holding snapshot.json.
 */
function resolveSnapshotPath(given: string): string {
  return given.endsWith('.json') ? given : join(given, 'snapshot.json');
}

// The snapshot comes from --input (default /input, the sealed mount), the
// output directory from --output or MAKEFUN_OUTPUT_DIR (default /output).
const inputFile = resolveSnapshotPath(readArgument('input', '/input'));
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const outDir = readArgument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Parse the snapshot, score the board, and refuse to continue if the model
// produced a board the gate would reject — a bad board must fail loudly
// here, not silently ship to the grader.
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// The output directory is created now; board.json and data.js go in first.
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/**
 * Copy one directory's regular files into `to`, skipping hidden names, and
 * return the names copied. A missing source directory copies nothing.
 */
function copyRegularFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/**
 * Check every screenshot name against the scorer's pattern and stop with a
 * clear message on the first bad one.
 */
function checkScreenshotNames(names: string[]): void {
  for (const name of names) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(
        `token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`,
      );
      process.exit(1);
    }
  }
}

// The dashboard is copied in as it stands. An empty dashboard is a warning,
// not a failure: the board and its data are already written.
const dashboardFiles = copyRegularFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
if (dashboardFiles.length === 0) {
  process.stderr.write('token radar: dashboard/ is empty or missing: the page is not in this run yet\n');
}

// Three screenshots are required: the board, a detail view and a filtered
// view. Fewer than that is a failure — the entry is not complete without them.
const screenshotFiles = copyRegularFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (screenshotFiles.length < 3) {
  const plural = screenshotFiles.length === 1 ? '' : 's';
  process.stderr.write(
    `token radar: screenshots/ holds ${screenshotFiles.length} image${plural}: hand in 3, the board, a detail view and a filtered view (board.json and data.js are already written)\n`,
  );
  process.exit(1);
}
checkScreenshotNames(screenshotFiles);

// The dossier is written last, from this /output exactly as it now stands.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const summaryLine =
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
  `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n`;
const wroteLine =
  `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
  `${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ` +
  `${join(outDir, 'screenshots')} (${screenshotFiles.length} images) and ${join(outDir, 'dossier.json')}\n`;
process.stdout.write(summaryLine + wroteLine);
