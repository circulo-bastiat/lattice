#!/usr/bin/env node
// vg_pregen.mjs — the vanilla GOLDEN PREGEN driver: runs the real 1.18.2 server jar headless at seed
// 1337 and force-loads eleven areas to `Status: full`, writing `golden/pregen/` for vanillacheck.
//
//   node tools/vg_pregen.mjs      (the vg-pregen.yml runner job: ubuntu has Java; #136)
//
// ⚠ WHY THIS FILE IS IN THE REPO. D-199's driver lived at `_scratch/mclite/vg_pregen.js` in
// MineHTML's jobs lane and is LOST, which is why vanillacheck has printed SKIP for weeks (QUEUE
// 0.4). Rebuilt here (D-549) from vanillacheck's own header, D-199, and the old runs' logs in the
// runner's done/ folder, so the next loss is impossible: the referee's recipe is versioned.
//
// WHAT IT DOES, in the order D-199 fixed:
//   1. refuses any server.jar whose SHA-1 is not 1.18.2's (c8f83c56…) — `tools/pregen-fetch.mjs`
//      fetched it; and finds a Java >= 17 (PATH, then the launcher's own runtimes).
//   2. boots the server in `golden/pregen/` (level-seed=1337, level-type=minecraft:normal).
//   3. per AREA: `forceload add` in 16x16 tiles (vanilla's 256-chunk cap per command), then after
//      each `save-all flush` counts the requested chunks present saved at `Status: full` in the region files; complete →
//      `forceload remove all` and the next area. An area that makes no progress for 180 s is
//      counted in `stalledGroups` (vanillacheck refuses a manifest with any).
//   4. `stop`; after the JVM has EXITED, an NBT census of every requested chunk's `Status`. Only
//      the census decides — never byte growth (D-199: MineHTML's S115 rule was foolable into
//      declaring a partial answer key finished).
//   5. writes `golden/pregen/manifest.json` with exactly the fields vanillacheck's provenance()
//      asserts (minecraft, jarSha1, dimension, levelType, seed, fullChunks, missingChunks,
//      unreadableChunks, stalledGroups, statuses, regionFiles, regionBytes, generationSeconds,
//      java) plus the areas.
// This program waits on ITS OWN CHILD (the JVM), in the foreground of the job that runs it; it
// never waits on or re-reads a queued job (D-436 governs sessions and the lane, and is untouched).
//
// THE ELEVEN AREAS (chunk centre, half-size). The coordinates of D-199's own boxes are lost with
// the driver; these were re-located at seed 1337 with MC-Lite's vanilla-climate biome engine
// (99.994% biome parity with the real game, D-199) so each named biome is really there:
//   ore      (-16,-16) h24  — contains D-199's named ore box, chunks x/z -20..-11
//   east     (44,-17)  h24  — contains featcheck §4's histogram window 40..47 × -20..-13
//   mountain (112,-48) h14  — stony peaks (emerald), pregen3's reason
//   plains (-192,-272) · forest (-224,-176) · cold/snowy_plains (-304,-32) · swamp (-96,416)
//   jungle (-352,752) · badlands (-320,-384) · mushroom_fields (-592,-64)       all h14
//   frozen_ocean (-224,-32) h20 — pregen6's iceberg sample
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readNBT } from './nbt.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHA = 'c8f83c5655308435b3dcf03c06d9fe8740a77469';
const JAR = join(ROOT, 'jars', '1.18.2', 'server.jar');
// `--smoke <dir>`: one 3x3 area into <dir>, a small heap — proves the driver end to end on a small
// machine (D-549 ran it in the Cowork VM); its manifest is NOT a referee (fullChunks < 1000).
const SMOKE = process.argv.indexOf('--smoke');
// `--seed <n>` (D-558): a SECOND golden world for vanillacheck §10 (is a bound fitted to one seed?).
// It lands in `golden/pregen-<n>/`, which vanillacheck's discover() finds as a sibling of
// `golden/pregen`; the areas stay at the seed-1337 coordinates (their biomes differ — §10
// compares ratios, not compositions). Seed 1337 keeps the primary path.
const SEEDI = process.argv.indexOf('--seed');
const SEED = SEEDI >= 0 ? Number(process.argv[SEEDI + 1]) : 1337;
if (!Number.isInteger(SEED)) { console.log('[vg] FAIL — --seed needs an integer'); process.exit(1); }
const OUT = SMOKE >= 0 ? process.argv[SMOKE + 1] : join(ROOT, 'golden', SEED === 1337 ? 'pregen' : 'pregen-' + SEED);
const STALL_MS = 180000, GAP_MS = SMOKE >= 0 ? 3000 : 10000;
const AREAS = SMOKE >= 0 ? [{ name: 'smoke', cx: -16, cz: -16, h: 1 }] : [
  { name: 'ore', cx: -16, cz: -16, h: 24 }, { name: 'east', cx: 44, cz: -17, h: 24 },
  { name: 'mountain', cx: 112, cz: -48, h: 14 }, { name: 'plains', cx: -192, cz: -272, h: 14 },
  { name: 'forest', cx: -224, cz: -176, h: 14 }, { name: 'cold', cx: -304, cz: -32, h: 14 },
  { name: 'swamp', cx: -96, cz: 416, h: 14 }, { name: 'jungle', cx: -352, cz: 752, h: 14 },
  { name: 'badlands', cx: -320, cz: -384, h: 14 }, { name: 'mushroom', cx: -592, cz: -64, h: 14 },
  { name: 'frozen_ocean', cx: -224, cz: -32, h: 20 },
];
const T0 = Date.now();
const log = (m) => console.log(`[vg] +${String(Math.round((Date.now() - T0) / 1000)).padStart(4)}s ${m}`);
const die = (m) => { log('FAIL — ' + m); process.exit(1); };

// ── 1. the jar and a Java
if (!existsSync(JAR)) die('no jars/1.18.2/server.jar — run `node tools/pregen-fetch.mjs` first');
if (createHash('sha1').update(readFileSync(JAR)).digest('hex') !== SHA) die('server.jar is not 1.18.2 (SHA-1 mismatch)');
log('jar sha1 verified ' + SHA);
const cands = ['java'];
const rt = join(process.env.APPDATA || '', '.minecraft', 'runtime');
if (existsSync(rt)) for (const d of readdirSync(rt)) cands.push(join(rt, d, 'windows-x64', d, 'bin', 'java.exe'));
let JAVA = null, JAVAV = '';
for (const j of cands) {
  const r = spawnSync(j, ['-version'], { encoding: 'utf8' });
  const s = (r.stderr || '') + (r.stdout || ''); const m = /version "(\d+)/.exec(s);
  if (m && +m[1] >= 17) { JAVA = j; JAVAV = (s.split('\n').find((l) => /version "/.test(l)) || '').trim(); break; }
}
if (!JAVA) die('no Java >= 17 on PATH or in the launcher runtimes');
log('java: ' + JAVAV);

// ── the plan: every requested chunk, grouped by area, tiled for forceload
const key = (x, z) => x + ',' + z;
const want = new Map();   // key -> area name (first area wins on overlap)
for (const a of AREAS) {
  a.chunks = [];
  for (let x = a.cx - a.h; x <= a.cx + a.h; x++) for (let z = a.cz - a.h; z <= a.cz + a.h; z++) {
    if (!want.has(key(x, z))) { want.set(key(x, z), a.name); a.chunks.push([x, z]); }
  }
  a.tiles = [];
  for (let x = a.cx - a.h; x <= a.cx + a.h; x += 16) for (let z = a.cz - a.h; z <= a.cz + a.h; z += 16) {
    a.tiles.push([x, z, Math.min(x + 15, a.cx + a.h), Math.min(z + 15, a.cz + a.h)]);
  }
}
log(`plan: ${AREAS.length} areas, ${AREAS.reduce((s, a) => s + a.tiles.length, 0)} tiles, ${want.size} chunks`);

// ── the region-header reader (presence) and chunk reader (census)
const REG = join(OUT, 'world', 'region');
const regName = (x, z) => `r.${x >> 5}.${z >> 5}.mca`;
// ⚠ "PRESENT" MEANS SAVED AT `Status: full`, NOT MERELY IN THE HEADER: a forceloaded chunk can be
// flushed at `features` on its way up, and a header count would end the group early (the census
// would then refuse the manifest — correct, but a wasted run).
function present(chunks) {
  const cache = new Map(); let n = 0;
  for (const [x, z] of chunks) if (statusOf(x, z, cache) === 'full') n++;
  return n;
}
function statusOf(x, z, cache) {
  const p = join(REG, regName(x, z));
  let raw = cache?.get(p);
  if (!raw) { if (!existsSync(p)) return 'missing'; try { raw = readFileSync(p); } catch { return 'missing'; } cache?.set(p, raw); } const i = ((x & 31) + (z & 31) * 32) * 4;
  if (raw.length < 4096) return 'missing';
  const off = (raw[i] << 16 | raw[i + 1] << 8 | raw[i + 2]) * 4096; if (!off) return 'missing';
  try {
    if (off + 5 > raw.length) return 'unreadable';
    const len = raw.readInt32BE(off);
    const v = readNBT(raw.subarray(off + 5, off + 4 + len), { plain: true }).value;
    const s = v.Status ?? v.Level?.Status; return s ? String(s).replace(/^minecraft:/, '') : 'unreadable';
  } catch { return 'unreadable'; }
}

// ── 2. boot
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'eula.txt'), 'eula=true\n');
writeFileSync(join(OUT, 'server.properties'), [
  `level-seed=${SEED}`, 'level-type=minecraft\\:normal', 'level-name=world', 'online-mode=false',
  'server-port=25599', 'spawn-protection=0', 'max-tick-time=-1', 'view-distance=4', 'simulation-distance=4',
  'generate-structures=true', 'sync-chunk-writes=true', 'enable-query=false', 'enable-rcon=false', 'motd=mclite-pregen', '',
].join('\n'));
const srv = spawn(JAVA, [SMOKE >= 0 ? '-Xmx1500M' : '-Xmx4G', '-jar', JAR, 'nogui'], { cwd: OUT, stdio: ['pipe', 'pipe', 'pipe'] });
const tail = []; const waiters = [];
let exited = null; srv.on('exit', (c) => { exited = c; for (const w of waiters.splice(0)) w.rej(new Error('server exited ' + c)); });
let buf = '';
const onData = (d) => {
  buf += d.toString(); let k;
  while ((k = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, k).trimEnd(); buf = buf.slice(k + 1);
    tail.push(line); if (tail.length > 40) tail.shift();
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].re.test(line)) waiters.splice(i, 1)[0].res(line);
  }
};
srv.stdout.on('data', onData); srv.stderr.on('data', onData);
const lineMatching = (re, ms) => new Promise((res, rej) => {
  const w = { re, res, rej }; waiters.push(w);
  if (ms) setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout waiting for ' + re)); } }, ms);
});
const cmd = (c) => srv.stdin.write(c + '\n');
const gap = (ms) => new Promise((r) => setTimeout(r, ms));
const dumpTail = () => { console.log('==== server output (tail) ===='); for (const l of tail) console.log(l); };

try {
  const tb = Date.now();
  await lineMatching(/\]: Done \(/, 600000);
  log(`booted in ${((Date.now() - tb) / 1000).toFixed(1)} s (not counted as generation)`);
} catch (e) { dumpTail(); die('boot: ' + e.message); }

// ── 3. the areas
let stalledGroups = 0; const tg = Date.now();
for (const [gi, a] of AREAS.entries()) {
  for (const [x0, z0, x1, z1] of a.tiles) cmd(`forceload add ${x0 * 16} ${z0 * 16} ${x1 * 16} ${z1 * 16}`);
  log(`group ${gi + 1}/${AREAS.length} (${a.name}): forceload issued for ${a.chunks.length} chunks`);
  const ts = Date.now(); let best = -1, lastGain = Date.now();
  for (;;) {
    await gap(GAP_MS);
    cmd('save-all flush');
    try { await lineMatching(/Saved the game/, 300000); } catch (e) { dumpTail(); die(e.message); }
    const n = present(a.chunks);
    if (n > best) { best = n; lastGain = Date.now(); }
    if (n >= a.chunks.length) { log(`  group ${gi + 1} present ${n}/${a.chunks.length} in ${Math.round((Date.now() - ts) / 1000)} s`); break; }
    if (Date.now() - lastGain > STALL_MS) { stalledGroups++; log(`  group ${gi + 1} STALLED at ${n}/${a.chunks.length}`); break; }
  }
  cmd('forceload remove all');
}
const generationSeconds = +((Date.now() - tg) / 1000).toFixed(1);
log(`generation window: ${generationSeconds} s`);

// ── 4. stop, then census AFTER the JVM has exited
cmd('save-all flush'); cmd('stop');
const te = Date.now();
if (exited === null) await new Promise((r) => srv.on('exit', r));
log(`server exited after ${Math.round((Date.now() - te) / 1000)} s`);
log('census: reading every requested chunk and its Status ...');
const statuses = {}; let missing = 0, unreadable = 0, full = 0;
for (const a of AREAS) {
  a.full = 0;
  for (const [x, z] of a.chunks) {
    const s = statusOf(x, z);
    if (s === 'missing') missing++; else if (s === 'unreadable') unreadable++;
    else { statuses[s] = (statuses[s] || 0) + 1; if (s === 'full') { full++; a.full++; } }
  }
}
log(`census: full=${full}  missing=${missing}  unreadable=${unreadable}`);
log(`census: statuses = ${JSON.stringify(statuses)}`);
const mca = readdirSync(REG).filter((f) => f.endsWith('.mca'));
const regionBytes = mca.reduce((s, f) => s + statSync(join(REG, f)).size, 0);

// ── 5. the receipt
const manifest = {
  minecraft: '1.18.2', jarSha1: SHA, dimension: 'minecraft:overworld', levelType: 'minecraft:normal', seed: SEED,
  requestedChunks: want.size, fullChunks: full, missingChunks: missing, unreadableChunks: unreadable, stalledGroups,
  statuses, regionFiles: mca.length, regionBytes, generationSeconds, java: JAVAV,
  areas: AREAS.map((a) => ({ name: a.name, cx: a.cx, cz: a.cz, half: a.h, chunks: a.chunks.length, full: a.full })),
  driver: 'tools/vg_pregen.mjs (D-549)',
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
log('wrote ' + join(OUT, 'manifest.json'));
log(`region: ${mca.length} files, ${(regionBytes / 1048576).toFixed(1)} MB`);
dumpTail();
const okAll = missing === 0 && unreadable === 0 && stalledGroups === 0 && Object.keys(statuses).join() === 'full';
log(okAll ? `PREGEN OK — ${full} FULL chunks` : 'PREGEN INCOMPLETE — vanillacheck will refuse this manifest');
process.exit(okAll ? 0 : 1);
