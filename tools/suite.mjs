#!/usr/bin/env node
// suite.mjs — PLAN F9. One entry point, one exit code.
//
//   node tools/suite.mjs [--fast]
//
// Dan: "test this ultra rigorously and make sure every test does something."
// A suite that cannot fail is not evidence, so every check below carries an anti-vacuity
// section that breaks the data and asserts the break is caught (D-30). This runner reports
// the count of those breaks alongside the assertions, because "0 failures" from a suite
// that proves nothing is the failure mode this whole apparatus exists to avoid.

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { cpus, setPriority, constants as osConstants, tmpdir as tmpdirOs } from 'node:os';
import * as require_fs from 'node:fs';
import { findChrome, REAL_GPU } from './cdp.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator
await import('./infra/gate.mjs').then((m) => m.gate(MCLITE_ROOT)).catch(() => {});   // automatic mail/claim gate


// --core (RUN.md, the lander's gate): the --fast set minus tools/quarantine.json, which lists known-red checks
// that each have an issue. A quarantined check still runs in the FULL suite and is reported, but never blocks.
const CORE = process.argv.includes('--core');
const FAST = CORE || process.argv.includes('--fast');
const CORE_SET = CORE ? new Set(JSON.parse(readFileSync(new URL('./core.json', import.meta.url), 'utf8')).checks) : null;
const QUARANTINE = (() => { try { return JSON.parse(readFileSync(new URL('./quarantine.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const ROOT = MCLITE_ROOT;
// D-408: `--preset medium` sets MCLITE_PRESET for every stage — the jobs lane can only run a
// bare `node …` command, so the preset has to be expressible as an argument (D-196).
{ const i = process.argv.indexOf('--preset'); if (i > 0 && process.argv[i + 1]) process.env.MCLITE_PRESET = process.argv[i + 1]; }

// ⚠ D-218 — THE SUITE CAN BE RUN IN PIECES, BECAUSE ON THE MACHINE THIS PROJECT LIVES ON IT HAS
// TO BE. Every remote shell call into that box is capped at about 180 seconds and a background
// process does not survive the call, while `--fast` is now past 200 s of work. Three separate
// sessions hit that wall on the same night and each one ran the checks by hand instead, which is
// how a stage gets quietly skipped. So:
//     --only a,b,c   run exactly these stage ids, in the suite's own order
//     --from <id>    start at that stage and run to the end
//     --to <id>      stop after that stage
// ⚠ A PARTIAL RUN IS NOT A GREEN SUITE, and the summary says so in as many words rather than
// letting "0 stages failed" stand for the whole thing — the same lesson as `--fast` not seeing
// the picture (D-196), one file down.
const argAfter = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = (argAfter('--only') || '').split(',').map((x) => x.trim()).filter(Boolean);
const FROM = argAfter('--from');
const TO = argAfter('--to');
const MAP = process.argv.includes('--map');   // #7765: record what every stage reads -> .ledger/tia-map.json (tools/infra/tia.mjs)
const PARTIAL = ONLY.length > 0 || !!FROM || !!TO;

// order matters: each stage's output is the next stage's input
// ⚠ A CHECK THAT IS NOT IN THIS LIST IS A CHECK THAT DOES NOT EXIST. Session 1 found gencheck,
// gamecheck, smoke and bench all living outside the runner, and two of them had been silently
// broken for days. `tools/doccheck.mjs` now asserts that every `*check.mjs` in tools/ appears
// here (D-110), so it cannot happen again by forgetting.
const STAGES = [
  // Only the BUILD pipeline lives here (order matters). Every check/browser stage is its own
  // tools/stages.d/<id>.json, found automatically, so two sessions never edit the same list.
  // ⚠ FIRST, and a no-op when its output exists. `Material.isReplaceable()` is compiled Java and
  // `merge-constants` now refuses to run without it (D-263). It needs a JVM; on a machine with
  // no `javap` it prints SKIP and exits 0, and the committed table is used.
  { id: 'extract-materials', kind: 'build', args: ['--if-missing'] },
  // D-266's sibling: which slot an item is WORN in, for shift-click's equipment branches.
  { id: 'extract-equipment', kind: 'build', args: ['--if-missing'] },
  // D-269: the furnace fuel map, the one part of G9 that is compiled Java.
  { id: 'extract-fuel',      kind: 'build', args: ['--if-missing'] },
  { id: 'extract-fallon',    kind: 'build', args: ['--if-missing'] },
  // D-285: every block's SoundType, the fifth table the bytecode referee has produced.
  { id: 'extract-soundtype', kind: 'build', args: ['--if-missing'] },
  // D-291: armour points, toughness and durability — the sixth. `Sv.afterArmor` had carried
  // vanilla's damage formula since G5 with nothing able to give it a non-zero input.
  { id: 'extract-armor',     kind: 'build', args: ['--if-missing'] },
  // D-295: the two closed redstone sets — which blocks emit, and which a comparator can read.
  // The seventh and eighth tables, and the first pair the method has produced from ONE scan.
  { id: 'extract-analog',    kind: 'build', args: ['--if-missing'] },
  // D-298: PushReaction — the ninth table, and the one G15c cannot be written without.
  { id: 'extract-push',      kind: 'build', args: ['--if-missing'] },
  // D-306: every entity type's hitbox — the TENTH table, and G17a. There is no JSON for any of
  // it; a zombie's 0.6 x 1.95 exists only in `EntityType.<clinit>`.
  { id: 'extract-entities',  kind: 'build', args: ['--if-missing'] },
  // D-307: the ELEVENTH — the constant downward push each entity class adds to its own delta
  // movement. Measured ahead of G17b, which is the stage that will consume it; nothing in the
  // runtime reads it yet and that is deliberate (a constant nothing consumes is D-289's shape).
  { id: 'extract-entity-motion', kind: 'build', args: ['--if-missing'] },
  // D-427 — the ON-GROUND half of the same tick, which extract-entity-motion left owed.
  { id: 'extract-entity-ground', kind: 'build', args: ['--if-missing'] },
  // D-429 — AnimationUtils.animateZombieArms and the five mobs the jar's call graph gives it.
  { id: 'extract-zombiearms', kind: 'build', args: ['--if-missing'] },
  // D-313: the TWELFTH — the creative inventory's twelve tabs and the tab of every one of the
  // 1,101 items, closed against the jar's own lang file and the registry in both directions.
  // G11b consumes it: `pack-items` writes one byte per item and `creativecheck` holds it closed.
  { id: 'extract-creative',  kind: 'build', args: ['--if-missing'] },
  // D-316: the THIRTEENTH — all 74 of vanilla's commands with their operator levels and their
  // aliases, read out of `Commands`' own registration calls. G12b consumes it.
  { id: 'extract-commands',  kind: 'build', args: ['--if-missing'] },
  // D-317: the FOURTEENTH — every model layer in the game as boxes. There is no JSON for a
  // chest's lid in any version of the jar; `CubeListBuilder` is the only source there has been.
  { id: 'extract-models',    kind: 'build', args: ['--if-missing'] },
  // D-319: the FIFTEENTH — all 35 game rules with their types and defaults, out of
  // `GameRules.<clinit>`. `/gamerule` consumes it and `gen-data` inlines it.
  { id: 'extract-gamerules', kind: 'build', args: ['--if-missing'] },
  // D-329: the SIXTEENTH — the hotbar's four source rectangles AND ITS DRAW ORDER, out of
  // `Gui.renderHotbar`'s bytecode offsets. `guicheck` §3 consumes it, and it exists because that
  // section used to pin the selector at 24x24 from memory while vanilla blits 24x22 — a check
  // that had turned a bug into a requirement.
  { id: 'extract-guigeom',   kind: 'build', args: ['--if-missing'] },
  // D-342 — the sprite extrusion out of the bytecode. `--if-missing` because a machine with no
  // JDK keeps the committed TSV; `tools/itemmodelgen.mjs` reads every constant from it.
  { id: 'extract-itemmodel', kind: 'build', args: ['--if-missing'] },
  // D-346 — which blocks vanilla gives a `canSurvive` override, and whose. The table is read
  // from the bytecode; `tools/supportrule.mjs` decides which of those owners the engine
  // implements and `supportcheck` grades the result in BOTH directions.
  { id: 'extract-support',   kind: 'build', args: ['--if-missing'] },
  // D-350 — the 22nd: vanilla's `canOcclude`, and whether each block keeps vanilla's DEFAULT
  // outline shape. The mushroom rule's `isSolidRender` is the one reader; it runs AFTER
  // extract-support because it anchors its whole trail on that table's mushroom row.
  { id: 'extract-occlusion', kind: 'build', args: ['--if-missing'] },
  // D-352 — the 23rd: vanilla's ignite odds per block, out of the fire block's own bootstrap.
  // It is the last table the survival rules needed, and it anchors on the cansurvive table's
  // `fire` row for the same reason extract-occlusion anchors on the mushroom's.
  { id: 'extract-flammable', kind: 'build', args: ['--if-missing'] },
  // D-331: the SEVENTEENTH — which item places which block, out of `Items.<clinit>`. `pack-items`
  // consumes it and REFUSES to build without it, because the thing it replaced was the item's
  // MODEL standing in for its class, which left 224 BlockItems unplaceable and silent.
  { id: 'extract-blockitems', kind: 'build', args: ['--if-missing'] },
  // D-335: the EIGHTEENTH — attack damage and attack speed for all 30 tools, out of the tool
  // constructors in `Items.<clinit>`. It pays D-271, which had left `Hand.attackSpeedTable` null
  // for fourteen sessions, so every item in the game swung at the base 4.0.
  { id: 'extract-itemattrs', kind: 'build', args: ['--if-missing'] },
  // D-359 — the first-person hand's whole transform stack, found in the CLIENT jar by float
  // fingerprint. `handposecheck` holds `14k_hand3d.js` against its output.
  { id: 'extract-handrender', kind: 'build', args: ['--if-missing'] },
  // D-336: the NINETEENTH — max health, speed, attack damage, follow range and knockback
  // resistance for every entity type, resolved through the superclass chain. It is what makes
  // "can this be attacked" a fact about the jar rather than a list.
  { id: 'extract-entityattrs', kind: 'build', args: ['--if-missing'] },
  // G18e (D-423): what an animal EATS, and the eight constants the breeding loop runs on.
  // `AgeableMob` and `Animal` are the only two classes in the jar carrying the `ForcedAge` and
  // `InLove` NBT keys, which is how they are found with no mapping. It is the table that knows
  // a pig takes THREE items, a fox takes a tag, and a parrot cannot be bred at all.
  { id: 'extract-breeding', kind: 'build', args: ['--if-missing'] },
  { id: 'extract-combat-enchant', kind: 'build', args: ['--if-missing'] },
  // G18e unit 2 (D-424): HOW A BABY IS DRAWN. `AgeableListModel` transforms the head parts and
  // the body parts separately and each model class passes it six numbers of its own — and this
  // reads what those six MEAN out of the base class's own render method rather than assuming
  // the argument order. Four of the ten models read do not scale the head at all.
  { id: 'extract-babymodel', kind: 'build', args: ['--if-missing'] },
  { id: 'extract-blocks',   kind: 'build', args: [] },
  { id: 'build-atlas',      kind: 'build', args: [] },
  { id: 'merge-constants',  kind: 'build', args: [] },
  { id: 'bake-geometry',    kind: 'build', args: [] },
  { id: 'extract-items',    kind: 'build', args: [] },
  // PLAN G10c — the model boxes and every builtin/entity item's gui transform. Moved here
  // (PASS 15 JOB 3) from after pack-tags: `pack-geometry` now needs `models.bin` byte-identical
  // input for `pack-blockentity`'s boxes, so both must run before it, not after.
  { id: 'pack-models',      kind: 'build', args: [] },
  // PASS 15 JOB 3, G17e — the block-entity items' world-space parts and their be_* textures,
  // sliced to fit the shared 16x16 atlas array (D-341's trick a third time). AFTER pack-models
  // (its box/texture input) and BEFORE pack-geometry (which appends its parts).
  { id: 'pack-blockentity', kind: 'build', args: [] },
  { id: 'pack-geometry',    kind: 'build', args: [] },
  { id: 'pack-runtime',     kind: 'build', args: [] },
  // G17a — 113 entity hitboxes, from the golden TSV into assets/entities.json (D-306).
  { id: 'pack-entities',    kind: 'build', args: [] },
  { id: 'gen-legacy-tiles', kind: 'build', args: [] },
  { id: 'pack-worldgen',    kind: 'build', args: [] },
  { id: 'pack-structures',  kind: 'build', args: [] },
  { id: 'pack-biomeparams', kind: 'build', args: [] },
  { id: 'pack-colormaps',   kind: 'build', args: [] },
  // PLAN G1 and G3's three payloads. `pack-tags` reads the jar; `pack-mining` needs
  // `block-constants.json` from `merge-constants` above; `pack-loot` reads the jar again. All
  // three must precede `gen-data`, which is what puts them in the built file.
  { id: 'pack-tags',        kind: 'build', args: [] },
  { id: 'pack-mining',      kind: 'build', args: [] },
  { id: 'pack-loot',        kind: 'build', args: [] },
  // PLAN G7/G8 — the item table, packed for the runtime. AFTER extract-items (its input) and
  // before gen-data (which inlines it).
  { id: 'pack-items',       kind: 'build', args: [] },
  // PLAN G9's 1,058 recipes. AFTER pack-tags (ingredients reference tags) and before gen-data.
  { id: 'pack-recipes',     kind: 'build', args: [] },
  // PLAN G26c's 1,141 advancement files. Reads the jar only; before gen-data.
  { id: 'pack-advancements', kind: 'build', args: [] },
  // PLAN G11's GUI sheets and the legacy font, out of the 1.13.2 jar.
  { id: 'build-gui',        kind: 'build', args: [] },
  // PLAN G12's language table — vanilla's whole `en_us.json`. AFTER extract-blocks and
  // extract-items, whose registries it asserts a display name for, and before gen-data.
  { id: 'pack-lang',        kind: 'build', args: [] },
  // PLAN G13's sound events and their audio (D-284). AFTER extract-soundtype, whose golden TSV
  // it packs, and before gen-data.
  { id: 'pack-sounds',      kind: 'build', args: [] },
  // PASS 16 JOB 4.2's GPU wiring, data half (D-317/D-341/D-376's pattern a fourth time): mob
  // sheets from the 1.13.2 jar, then their box-face crops bin-packed into shared 16x16 atlas
  // layers appended after be-tiles. AFTER pack-models (its box input) and pack-blockentity
  // (be-tiles.meta.json's TILE_BASE) and BEFORE gen-data (which inlines the result). No live
  // caller reads this yet -- see git 2a8efe1:docs/passes/PASS-16-HISTORY.md.
  { id: 'extract-mob-textures', kind: 'build', args: [] },
  { id: 'pack-mobtex',          kind: 'build', args: [] },
  { id: 'pack-painting',        kind: 'build', args: [] },   // #5707: painting tile layers, appended after mob tiles
  // loop/particledraw -- Px.OWED's own draw line: the particle SPRITE ATLAS (heart, glint/
  // happy_villager, 8 smoke frames), one texture array `07zx_particle.js`'s own draw pass binds.
  // AFTER extract-mob-textures/pack-mobtex (no ordering dependency between them, just grouped
  // with the other jar-texture extractors) and BEFORE gen-data (which inlines the result).
  { id: 'extract-particletex', kind: 'build', args: [] },
  // D-655: the xp orb sheet was never a suite stage (a fresh assets/ drew no orbs), and the
  // rain/snow sheets (G20 weather) join it. Both BEFORE gen-data, which inlines them.
  { id: 'extract-xporbtex',    kind: 'build', args: [] },
  { id: 'extract-weathertex',  kind: 'build', args: [] },
  { id: 'gen-data',         kind: 'build', args: [] },
  { id: 'build-biomesheet', kind: 'build', args: [] },
  // G18f unit 2 (D-479) -- PROFESSIONS AND WORKSTATIONS. The registry (bnz/bhv/cdr,
  // jar-verified) and the adjacency claim rule, driven through the real Combat.tickEntity.
  // QUEUE row 3 (G18f), D-480: VillagerTrades.TRADES' static half, off boa's own
  // builder bytecode (VillagerProfession/Items/Blocks/VillagerType all named from
  // their own <clinit>s, not remembered) -- the five procedural listing kinds
  // (Random-driven or world-state-linked) are named not guessed, see the file header.
  { id: 'extract-villager-trades', kind: 'build', args: ['--if-missing'] },
  { id: 'build',            kind: 'build', args: ['--quiet'], file: 'build.mjs' },
];
// ▼ stages.d — infra/cloud stage registrations (Dan, 23 Sept 2026: "make sure the 2 loops never conflict").
// Every tools/stages.d/*.json is a JSON array of { id, kind, file?, args? } appended here, so the infra
// task and cloud sessions register stages as NEW FILES and never edit this list (no append collisions).
// A malformed file or a duplicate id is a FAILED stage row, never a silent drop.
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = process.env.MCLITE_STAGES_DIR || `${ROOT}/tools/stages.d`;   // override: stagetimeoutcheck's fixture
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no stages.d yet */ }
  for (const f of files) {
    let list;
    try { list = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); } catch (e) { list = null; }
    if (!Array.isArray(list)) { STAGES.push({ id: `stages.d/${f}`, kind: 'check', file: `tools/stages.d/${f}.INVALID` }); continue; }
    for (const e of list) {
      const ok = e && typeof e.id === 'string' && /^(check|browser|build)$/.test(e.kind) && !STAGES.some((s) => s.id === e.id);
      STAGES.push(ok ? { id: e.id, kind: e.kind, file: e.file, args: Array.isArray(e.args) ? e.args : [], timeoutMin: +e.timeoutMin || 0, from: `stages.d/${f}` }
                     : { id: `stages.d/${f}:${e && e.id}`, kind: 'check', file: `tools/stages.d/${f}.INVALID-ENTRY` });
    }
  }
}
// ▲ stages.d

const t0 = Date.now();
// TEMP SWEEP (28 Sept: 82 GB of %TEMP% was HeadlessEdge* profiles - every browser stage's Edge is SIGKILLed, so it
// never deletes its own profile, and the drive filled until Cowork's VM died). Runs at the start and end of every
// suite: removes browser profile folders older than 30 min (a running browser's are younger or locked).
function sweepBrowserTemp() {
  if (process.platform !== 'win32') return;
  let n = 0;
  try {
    const { readdirSync: rd, statSync: stt, rmSync } = require_fs;
    for (const e of rd(tmpdirOs())) {
      if (!/^(HeadlessEdge|scoped_dir|chrome_|edge_|puppeteer_dev)/i.test(e)) continue;
      const f = `${tmpdirOs()}\\${e}`;
      try { if (Date.now() - stt(f).mtimeMs > 30 * 60e3) { rmSync(f, { recursive: true, force: true, maxRetries: 2 }); n++; } } catch {}
    }
  } catch {}
  if (n) console.log(` (swept ${n} leftover browser profile folder(s) from %TEMP%)`);
}
sweepBrowserTemp();
const results = {};   // id -> [id, status, detail, ms, isVacuous] — filled in any order, read in STAGES order
/** One line of the results table. Used live as each stage ends, and again at the end. */
const row = (id, st, detail, ms) =>
  ` ${st === 'ok' ? '✓' : st === 'skip' ? '·' : '✗'} ${id.padEnd(17)} ${String(ms).padStart(6)} ms  ${detail}`;
const say = (line) => console.log(line);

// ⚠ D-438 — INDEPENDENT STAGES RUN N-WIDE (D-437 fix 2). After `gen-data`/`build` no check reads
// another check's output, so consecutive `check` stages run concurrently; every other kind
// (`build`, `gen`, `browser`, ...) is a BARRIER and runs alone, in order, so nothing races its input.
// The width AUTO-SCALES to the machine: `MCLITE_JOBS` if set, else one per core less one (so the box
// stays usable) — which is 1 on a two-core PC, i.e. the old sequential behaviour, for free. This is
// LOCAL cpu parallelism, not the session-level parallelism D-24/AGENTS.md governs.
const CPU = (() => { try { return cpus().length || 1; } catch { return 1; } })();
// D-819 (Dan, 27 Sept: "make it so that it leaves one core free for me"): the stage budget is CPU-2 (one core for the
// suite's own browsers' extra threads, one for Dan), and the whole suite runs at BELOW-NORMAL priority — every stage and
// every browser inherits it (runStage/cdp set it on each child too), so whatever Dan is doing always wins the CPU.
const JOBS = Math.max(1, parseInt(process.env.MCLITE_JOBS, 10) || (CPU - 2));
export const QUIET_PRIORITY = osConstants.priority.PRIORITY_BELOW_NORMAL;
try { setPriority(process.pid, QUIET_PRIORITY); } catch { /* not permitted: still correct, just not polite */ }
import('./infra/browserslots.mjs').then((m) => m.logEvidence('suite start', ROOT));   // #3921: reap orphans + evidence line
// D-820: a new run clears a previous run's cancel marker (cdp.mjs refuses every browser while it exists)
try { unlinkSync(ROOT + '.infra/STOP-SUITE'); } catch { /* none */ }

// #1578 (lander emergency): a stage that dies of V8 "Committing semi space failed" / "heap out of memory" within a few
// seconds of starting never ran at all - the HOST had no commit memory left because JOBS stages (plus browsers) started
// together. That is the machine, not the check: wait for the other stages to hand memory back and run it again, twice.
const HOST_OOM = /Committing semi space failed|node::OnFatalError|JavaScript heap out of memory|Allocation failed - JavaScript heap/;
async function runStage(st, extraEnv) {
  for (let attempt = 0; ; attempt++) {
    const r = await runStageOnce(st, extraEnv, attempt < 2);
    if (r !== 'retry') return;
    say(` ↻ ${st.id.padEnd(17)} host out of memory at start - retrying (${attempt + 1}/2)`);
    await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
  }
}

/** Run ONE stage to completion (async): spawn it, print its live row + any FAILED block, record it. */
function runStageOnce(st, extraEnv, mayRetry) {
  return new Promise((resolve) => {
    const file = st.file || `tools/${st.id}.mjs`;
    if (!existsSync(`${ROOT}/${file}`)) { results[st.id] = [st.id, 'MISSING', file, 0]; say(row(st.id, 'MISSING', file, 0)); return resolve(); }
    const env = Object.assign({}, process.env, extraEnv || {});
    if (MAP) { require_fs.mkdirSync(`${ROOT}/.ledger/tia-reads`, { recursive: true }); try { require_fs.unlinkSync(`${ROOT}/.ledger/tia-reads/${st.id}.txt`); } catch {} env.MCLITE_TIA_OUT = `${ROOT}/.ledger/tia-reads/${st.id}.txt`; env.NODE_OPTIONS = ((env.NODE_OPTIONS || '') + ' --import=' + new URL('./infra/tia-hook.mjs', import.meta.url).href).trim(); }
    if (st.kind === 'browser' && !env.CHROME && findChrome()) env.CHROME = findChrome();   // D-407
    const t = Date.now();
    const child = spawn('node', [file].concat(st.args), { cwd: ROOT, env });
    try { setPriority(child.pid, QUIET_PRIORITY); } catch { /* D-819: best effort */ }
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => { out += '\n' + (e && e.message || e) + '\n'; });
    // #6384: a stage that never exits must not stall the lander for its whole job - kill it, record FAIL
    const limMin = Math.max(parseFloat(process.env.MCLITE_STAGE_TIMEOUT_MIN) || 30, st.timeoutMin || 0);   // #8521: a stage may ask for longer
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true; out += `\nTIMEOUT after ${limMin} min\n`;
      try { child.kill('SIGKILL'); } catch { /* gone */ }
    }, limMin * 60000);
    child.on('close', (code) => {
      clearTimeout(killer);
      if (timedOut) code = code || 1;
      const ms = Date.now() - t;
      // pull the numbers each tool prints, rather than re-deriving them here (thousands separators and all)
      const num = (re) => { const m = out.match(re); const v = m && m.slice(1).find(Boolean); return v ? v.replace(/,/g, '') : undefined; };
      let asserts = num(/assertions passed \.+ ([\d,]+)|passed: ([\d,]+)|([\d,]+) checks passed|(?:PASS|FAIL)\s+([\d,]+) checks|:\s+([\d,]+) assertions,/);
      if (!asserts && /^smoke: /m.test(out)) asserts = String((out.match(/^ok    /gm) || []).length);
      const fails = num(/failures \.+ ([\d,]+)|failed: ([\d,]+)|(?:warnings, )([\d,]+) failures|checks passed, ([\d,]+) failures|checks, ([\d,]+) failures|assertions, ([\d,]+) failed/);
      const av = (out.match(/✓/g) || []).length;
      const ok = code === 0;
      if (!ok && mayRetry && ms < 30000 && HOST_OOM.test(out)) return resolve('retry');
      let detail;
      if (asserts) detail = `${asserts} assertions, ${fails || 0} failures${av ? `, ${av} breaks caught` : ''}`;
      else {
        const lines = out.split('\n').map((l) => l.trim()).filter((l) => l && !/^=+$/.test(l));
        const key = lines.filter((l) => /\d/.test(l) && !/^-+$/.test(l));
        detail = (key[0] || lines[0] || '').replace(/\s+/g, ' ').slice(0, 62);
      }
      if (timedOut) detail = `TIMEOUT after ${limMin} min`;
      results[st.id] = [st.id, ok ? 'ok' : 'FAIL', detail, ms, st.kind === 'check' && !asserts];
      // ⚠ PRINTED AS IT HAPPENS (D-211): a run cut off at the 180 s shell cap must still show what finished.
      say(row(st.id, ok ? 'ok' : 'FAIL', detail, ms));
      if (!ok) { console.log(`\n──── ${st.id} FAILED ────`); { const L = out.split('\n'), tail = L.slice(-25), early = L.slice(0, -25).filter((l) => /✗|✘|\bFAIL(ED)?\b|\bError\b|AssertionError|Timeout/.test(l)).slice(0, 12);   // #9933: the FAILING line is usually not in the last 25 (soundcheck's red comments showed 25 passing lines)
        if (early.length) console.log('(failing lines earlier in the output:)\n' + early.join('\n') + '\n(last 25 lines:)'); console.log(tail.join('\n')); } }
      resolve();
    });
  });
}

/** Run a batch of independent stages with at most JOBS in flight at once (a fixed-size worker pool). */
// ⚠ D-818 (Dan, 27 Sept: "why does the test suite take 36? that obviously isnt right"): browser stages used to run ONE AT
// A TIME, each as a barrier — 25 of them were 22.7 of the 26 wall minutes while 11 of 12 cores idled (flashcheck alone
// 6 min). They now run IN the batch, beside the checks, in a WEIGHTED pool: a browser (a SwiftShader renderer) costs
// BROWSER_WEIGHT slots of JOBS, at most BROWSER_JOBS at once, each on its own DevTools port (MCLITE_CDP_PORT, which
// cdp/smoke/bench obey over their hard-coded ports) and its own profile dir. Browsers start first: they are the tail.
// D-820: measured 27 Sept — THREE SwiftShader browsers side by side ran 2.5-13x slower each (titlecheck 469 s vs 35 s),
// because a CPU rasteriser already uses every core. So: on the real GPU (Windows, cdp.REAL_GPU) browsers are cheap —
// 4 at once, weight 1; on SwiftShader (VM/cloud) ONE at a time.
const BROWSER_JOBS = Math.max(1, parseInt(process.env.MCLITE_BROWSER_JOBS, 10) || (REAL_GPU ? 4 : 1));
const BROWSER_WEIGHT = REAL_GPU ? 1 : 3;
async function runBatch(batch) {
  const queue = [...batch.filter((s) => s.kind === 'browser'), ...batch.filter((s) => s.kind !== 'browser')];
  // D-821: a FRESH port per browser stage, never a recycled one — a killed Chrome can hold its port for a moment, and the
  // next stage's Chrome then cannot bind it (ECONNREFUSED in tpcheck/backendcheck/… on the first GPU run)
  let nextPort = 9600;
  let used = 0, browsers = 0;
  await new Promise((done) => {
    const pump = () => {
      if (!queue.length && used === 0) return done();
      for (let k = 0; k < queue.length; k++) {
        const st = queue[k], isB = st.kind === 'browser', w = isB ? BROWSER_WEIGHT : 1;
        if (used + w > Math.max(JOBS, BROWSER_WEIGHT) || (isB && browsers >= BROWSER_JOBS)) continue;
        queue.splice(k--, 1); used += w;
        let port = null;
        if (isB) { browsers++; port = nextPort; nextPort += 3; }
        runStage(st, isB ? { MCLITE_CDP_PORT: String(port) } : null).then(() => {
          used -= w; if (isB) browsers--;
          pump();
        });
      }
    };
    pump();
  });
}

console.log(`==================== suite (live) ============= (${JOBS} job${JOBS === 1 ? '' : 's'} on ${CPU} cores, ${BROWSER_JOBS} browser(s) at once)`);

// classify every stage (in order) into run / skip, honouring --from/--to/--only/--fast
let started = !FROM, stopped = false;
const plan = [];
for (const st of STAGES) {
  if (FROM && st.id === FROM) started = true;
  if (stopped || !started || (ONLY.length && ONLY.indexOf(st.id) < 0)) {
    plan.push({ skip: true, st, why: PARTIAL ? 'not selected' : 'skipped' });
    if (TO && st.id === TO) stopped = true;
    continue;
  }
  if (TO && st.id === TO) stopped = true;
  if (FAST && st.kind === 'browser') { plan.push({ skip: true, st, why: '--fast' }); continue; }
  if (CORE && st.kind !== 'build' && !CORE_SET.has(st.id)) { plan.push({ skip: true, st, why: 'not in the express set (tools/core.json)' }); continue; }
  if (CORE && QUARANTINE[st.id]) { plan.push({ skip: true, st, why: 'quarantined: ' + QUARANTINE[st.id] }); continue; }
  plan.push({ run: true, st });
}
for (const p of plan) if (p.skip) results[p.st.id] = [p.st.id, 'skip', p.why, 0];

// execute: batch consecutive runnable `check` stages, run every other kind alone as a barrier
{
  let batch = [];
  const flush = async () => { if (batch.length) { await runBatch(batch); batch = []; } };
  for (const p of plan) {
    if (!p.run) continue;
    if (p.st.kind === 'check' || p.st.kind === 'browser') batch.push(p.st);   // D-818: browsers are no longer barriers
    else { await flush(); await runStage(p.st); }
  }
  await flush();
}

// the table and the counts read in STAGES order, independent of the order stages finished in
const rows = STAGES.map((st) => results[st.id]).filter(Boolean);
const failed = rows.filter((r) => r[1] === 'FAIL' || r[1] === 'MISSING').length;

const total = rows.reduce((a, r) => a + (parseInt(r[2]) || 0), 0);
const breaks = rows.reduce((a, r) => a + (parseInt((String(r[2]).match(/(\d+) breaks/) || [])[1]) || 0), 0);

console.log('');
console.log('==================== suite ====================');
for (const [id, st, detail, ms] of rows) console.log(row(id, st, detail, ms));
console.log(' ---------------------------------------------');
console.log(` ${total.toLocaleString()} assertions · ${breaks} deliberate breaks caught · ${failed} stage${failed === 1 ? '' : 's'} failed`);
// ⚠ D-218: a partial run must never read as a green suite. It says so here, above the timing,
// where "0 stages failed" would otherwise be the last thing anybody reads.
if (PARTIAL) {
  const ran = rows.filter((r) => r[1] !== 'skip').length;
  console.log(` ⚠ PARTIAL RUN — ${ran} of ${rows.length} stages selected` +
              (ONLY.length ? ` (--only ${ONLY.join(',')})` : '') +
              (FROM ? ` (--from ${FROM})` : '') + (TO ? ` (--to ${TO})` : '') +
              '. This is NOT a green suite.');
}
console.log(` ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ⚠ THE SKIPPED BROWSER STAGES ARE THE ONES THAT LOOK AT THE PICTURE, and this file used to
// end on "0 stages failed" whether they had run or not. Session 5 found the failure mode for
// real: the user's machine has no Chromium, `cdp.mjs` prints SKIP and exits 0 by design so a
// browser-less machine cannot fail the build, and the suite then reported a perfect run while
// six checks — smoke, titlecheck, cullcheck, palettecheck, soakcheck, flashcheck — had not
// executed a single assertion. One of them, flashcheck, was holding the white-flash bug the
// user had reported in three consecutive sessions (D-194). A green line that does not say what
// it did NOT do is the same class of lie as a check with no anti-vacuity section.
// ⚠ AND THE CHECKS WHOSE COUNT THE SUMMARY COULD NOT READ. Five checks written in one session
// printed their totals in a shape this parser did not know; all five passed, and all five
// contributed ZERO to the headline. "1,173,582 assertions" was wrong by seven thousand and
// nothing said so. A check stage that reports no number is named here, loudly, because the
// alternative is a total that quietly means less than it did last week.
const uncounted = rows.filter((r) => r[4]).map((r) => r[0]);
if (uncounted.length) {
  console.log(' ---------------------------------------------');
  console.log(` ⚠ ${uncounted.length} check stage${uncounted.length === 1 ? '' : 's'} REPORTED NO`
    + ` ASSERTION COUNT and contribute nothing to the total: ${uncounted.join(' ')}`);
  console.log('   They ran and passed. Their assertions are not in the number above.');
}

const skipped = rows.filter((r) => r[1] === 'skip').map((r) => r[0]);
if (skipped.length) {
  console.log(' ---------------------------------------------');
  console.log(` ⚠ ${skipped.length} stage${skipped.length === 1 ? '' : 's'} DID NOT RUN: ${skipped.join(' ')}`);
  // ⚠ THIS LINE USED TO LIE. It said "No browser was found" for ANY stage left out — so a
  // `--only` run that had just driven Chromium successfully still printed it, and a session
  // reading the footer would conclude the picture had never been looked at. A footer whose job is
  // to say what did not happen is worthless if it says the wrong reason; it now asks.
  if (FAST) {
    console.log('   --fast skips the browser stages. They are the only checks that look at the PICTURE.');
  } else if (skipped.some((id) => STAGES.some((st) => st.id === id && st.kind === 'browser'))) {
    if (findChrome()) {
      console.log('   A browser IS available here — these were deselected, not skipped for want of one.');
      console.log('   ⚠ Run the browser stages ONE AT A TIME on a two-core box (D-281).');
    } else {
      console.log('   No browser was found. Run these against dist/mclite.html on a machine with Chromium;');
      console.log('   docs/archive/AGENTS.md has the procedure. Until then this run has not seen the game.');
    }
  } else {
    console.log('   These were deselected by --only/--from/--to, not skipped.');
  }
}
console.log('===============================================');

// #7765: --map -> the stage -> files map the lander's test selection reads (derived from real reads, merged over the old map for partial runs)
if (MAP) try {
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { normalizeReads } = await import('./infra/tia.mjs');
  const old = (() => { try { return JSON.parse(readFileSync(`${ROOT}/.ledger/tia-map.json`, 'utf8')); } catch { return { stages: {} }; } })();
  const map = { at: new Date().toISOString(), head: '', stages: old.stages || {} };
  try { map.head = (await import('node:child_process')).execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
  for (const st of STAGES) {
    const f = `${ROOT}/.ledger/tia-reads/${st.id}.txt`, r = results[st.id];
    if (!existsSync(f) || !r || r[1] === 'skip') continue;
    const reads = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    map.stages[st.id] = { kind: st.kind, file: st.file || `tools/${st.id}.mjs`, ms: r[3], files: normalizeReads(reads, st.file || `tools/${st.id}.mjs`, ROOT) };
  }
  mkdirSync(`${ROOT}/.ledger`, { recursive: true });
  writeFileSync(`${ROOT}/.ledger/tia-map.json`, JSON.stringify(map));
  console.log(` tia map: ${Object.keys(map.stages).length} stages -> .ledger/tia-map.json`);
} catch (e) { console.log(' (tia map not written: ' + e.message + ')'); }
// ▶ D-408 — THE LEDGER (KW-10). Every run writes `.ledger/suite-last.json` (gitignored), and a run
// that was FULL (not --fast, not partial) also writes `.ledger/suite-full.json`. `session.mjs start`
// reads both, so "the last run was green" becomes a file with a machine, a HEAD and a time in it
// rather than a memory. A partial run can never overwrite the full-run record.
try {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { hostname } = await import('node:os');
  let head = '?';
  try { head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
  const rec = {
    at: new Date().toISOString(), machine: hostname(), platform: process.platform, head,
    preset: process.env.MCLITE_PRESET || null, fast: FAST, partial: PARTIAL,
    stages: rows.length, ran: rows.filter((r) => r[1] !== 'skip').length, failed,
    failedStages: rows.filter((r) => r[1] === 'FAIL' || r[1] === 'MISSING').map((r) => r[0]),
    skipped: rows.filter((r) => r[1] === 'skip').map((r) => r[0]),
    stageSec: Object.fromEntries(rows.filter((r) => r[1] !== 'skip').map((r) => [r[0], Math.round((r[3] || 0) / 100) / 10])),
    assertions: total, breaks, seconds: Math.round((Date.now() - t0) / 1000),
  };
  mkdirSync(`${ROOT}/.ledger`, { recursive: true });
  writeFileSync(`${ROOT}/.ledger/suite-last.json`, JSON.stringify(rec, null, 1));
  if (!FAST && !PARTIAL) writeFileSync(`${ROOT}/.ledger/suite-full.json`, JSON.stringify(rec, null, 1));
} catch (e) { console.log(' (ledger not written: ' + e.message + ')'); }
sweepBrowserTemp();
(await import('./infra/browserslots.mjs')).logEvidence('suite end', ROOT);
// #9319: exit only once stdout has drained - process.exit() on a pipe (spawnSync in go.mjs done) cut the table at ~420 lines
process.stdout.write('', () => process.exit(failed ? 1 : 0));
