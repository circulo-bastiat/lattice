// paths.mjs — where this project's inputs live, derived from the project itself.
//
// ⚠ WHY THIS EXISTS. Until session 5, twenty places across the tools defaulted to
// `/home/claude/jars` and `/home/claude/mcdata` — the home directory of a cloud container
// that does not exist on the machine the project now lives on. The first eleven stages of
// `suite.mjs` died of ENOENT before a single check ran, and the four that survived read a
// STALE `assets/` and reported real-looking failures (walls with 162 masks for 32 visual
// states; three ores that never matched their deepslate target) that were nothing but the
// missing cache. A default that names one machine is a bug on the second one.
//
// Everything here is derived from THIS FILE's location. `ROOT` is the directory that
// contains `tools/`, so a tool works from any working directory, and the project works from
// any path on any machine. Two overrides, in order:
//
//   1. environment — MCLITE_JARS, MCDATA
//   2. `mclite.config.json` in the project root — { "jars": "...", "mcdata": "..." }
//      Machine-specific, therefore gitignored. Written once per machine, never committed.
//
// and then a candidate probe, so the common cases need no configuration at all.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** The directory that contains `tools/`, `src/`, `docs/` and `build.mjs`. */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function readConfig() {
  try { return JSON.parse(readFileSync(join(ROOT, 'mclite.config.json'), 'utf8')); }
  catch { return {}; }
}
const CFG = readConfig();

// Two jar layouts are accepted, because Dan's jars live in a launcher `versions` directory
// and a build machine's may live in a flat one: <JARS>/1.18.2.jar and <JARS>/1.18.2/1.18.2.jar.
const flatOrNested = (dir, v) => {
  const flat = join(dir, v + '.jar');
  const nested = join(dir, v, v + '.jar');
  return existsSync(flat) ? flat : (existsSync(nested) ? nested : null);
};

/** The two versions every build stage needs: 1.18.2 is the target, 1.13.2 the texture source. */
export const NEEDED_VERSIONS = ['1.18.2', '1.13.2'];

const JAR_CANDIDATES = [
  process.env.MCLITE_JARS,
  CFG.jars,
  join(ROOT, 'jars'),
  join(homedir(), 'mnt', 'versions'),                                  // Cowork device VM mount
  join(homedir(), '.minecraft', 'versions'),                           // Linux launcher
  join(homedir(), 'AppData', 'Roaming', '.minecraft', 'versions'),     // Windows launcher
  join(homedir(), 'Library', 'Application Support', 'minecraft', 'versions'), // macOS launcher
  '/home/claude/jars',                                                 // the old container
].filter(Boolean);

function pickJars() {
  // A directory only counts if the TARGET jar is actually in it. An empty `jars/` directory
  // that happens to exist must not shadow the launcher folder that has the real thing.
  // Prefer a directory with EVERY needed version (#1700: a launcher folder with only 1.18.2 shadowed the
  // workspace's jars/ that also had 1.13.2, so build-atlas died on ENOENT jars/1.13.2.jar).
  for (const all of [true, false]) for (const dir of JAR_CANDIDATES) {
    try { if (existsSync(dir) && (all ? NEEDED_VERSIONS : ['1.18.2']).every((v) => flatOrNested(dir, v))) return dir; } catch { /* unreadable */ }
  }
  return JAR_CANDIDATES[0];
}

/** The directory holding the version jars, in either layout. */
export const JARS = pickJars();

/**
 * The vanilla data cache: 766 worldgen JSONs from the jar plus the PrismarineJS `pc/`
 * dataset, filled by `node tools/fetch-vanilla-data.mjs`. Generated, gitignored, and
 * regenerated in about ten seconds (D-6) — it lives INSIDE the project so it travels with
 * it and so no tool has to know a home directory.
 */
export const MCDATA = process.env.MCDATA || CFG.mcdata || join(ROOT, '.mcdata');

/** Absolute path to a version's jar, or null. */
export const jarPath = (v) => flatOrNested(JARS, v);

/**
 * Absolute path to a version's jar, or a diagnosis. A tool that dies with a bare ENOENT
 * three stack frames deep taught session 5 nothing; this says which machine assumption broke.
 */
export function requireJar(v) {
  const p = flatOrNested(JARS, v);
  if (p) return p;
  throw new Error(
    `MC-Lite: no ${v} jar found.\n` +
    `  looked in: ${JARS}\n` +
    `  as:        ${join(JARS, v + '.jar')}\n` +
    `         or: ${join(JARS, v, v + '.jar')}\n` +
    `  candidates tried: ${JAR_CANDIDATES.join(', ')}\n` +
    `  fix: set MCLITE_JARS to your launcher's "versions" folder, or write\n` +
    `       ${join(ROOT, 'mclite.config.json')} as {"jars":"/path/to/versions"}`);
}

/** True when the data cache has been filled for a version. */
export const haveCache = (v = '1.18.2') =>
  existsSync(join(MCDATA, v, 'data', 'minecraft', 'worldgen')) &&
  existsSync(join(MCDATA, 'pc', 'blocks.json'));

/** The PrismarineJS `pc/` dataset inside the cache — blocks.json, items.json, foods.json. */
export const MCDATA_PC = join(MCDATA, 'pc');

/**
 * A check that cannot run its audit (assets/jar/.decomp missing) must not look green in a tester session (#1700, D-30).
 * Returns normally only when skipping is allowed; with MCLITE_TESTER=1 / MCLITE_STRICT_SKIP=1 / --strict it exits 1.
 */
export function skipCheck(name, why) {
  const strict = process.env.MCLITE_TESTER === '1' || process.env.MCLITE_STRICT_SKIP === '1' || process.argv.includes('--strict');
  if (strict) { console.log(`${name}: ✗ SKIPPED BUT STRICT — ${why}. A skipped audit proves nothing; run \`node tools/go.mjs prep --dir .\` and make sure jars/ has 1.13.2 and 1.18.2 (set MCLITE_JARS).`); process.exit(1); }
  console.log(`${name}: SKIP — ${why}`); process.exit(0);
}
