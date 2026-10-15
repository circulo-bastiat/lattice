#!/usr/bin/env node
// phantomrefcheck.mjs — infra W (25 Sept 2026): PHANTOM swoop/circle AI vs the real 1.18.2 server
// (golden: runphantom.mjs, phantom.json; scenarios: phantomscen.mjs). Loads the WHOLE engine (every
// 07*.js mob module, same as avoidrefcheck.mjs/hoglinrefcheck.mjs's own load) and drives it exactly
// the way the server was driven: one player-shaped target on a floor, one `/summon`-shaped phantom
// spawned 5 blocks above it; BARE runs it alone, WITH_CAT also spawns a frozen cat CAT_DX blocks away
// (the swoop-abort check this pack exists to referee -- PhantomEntity.java's SwoopMovementGoal.
// canContinueToUse, .decomp:464-501, and this engine's own port, 07zz1_phantom.js's SwoopMovementGoal
// -- both cited in phantomscen.mjs's own header).
//
// Per scenario, from the raw per-tick (phantom Pos, bot Pos, bot health) logs, both sides:
//   1. FIRST SWOOP -- first tick the phantom comes within TOUCH blocks of the bot (a touch/near-touch
//      distance, not the real per-axis AABB test 07zz1_phantom.js's own header already names as a
//      simplification) -- compared as "did it happen at all" (both directions, rule 6) and, only when
//      both sides have one, the TICK ITSELF with a wide band (a swoop's own timing is racing several
//      independent random draws -- StartAttackGoal's own (8+rand(4))*20-tick cooldown, the spawn's own
//      unspecified starting phase -- so this is a distribution question, not an exact-tick one).
//   2. SWOOP COUNT in T ticks (re-armed once the phantom is back past ARM blocks away).
//   3. DAMAGE DEALT to the bot (health start - health end) over the whole run.
//   4. CIRCLING HEIGHT BAND -- median (phantom.y - bot.y) over every tick the phantom is NOT swooping
//      (dist > CIRCLE blocks) -- CircleMovementGoal's own target height is `circlingY + (-4+yOffset)`
//      off a `circlingY` set at `target.y + 20 + rand(20)` (07zz1_phantom.js's `startSwoop`).
// Mismatches are FINDINGS (red, exit 1): a real engine-vs-server difference belongs to whoever owns
// 07zz1_phantom.js, never fixed in this check (docs/archive/REFEREE.md "Why mismatches are findings").
// No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T, FLOOR_Y, CAT_DX } from './phantomscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const TOUCH = 2.0;   // blocks -- "reached the bot" proxy (07zz1_phantom.js's own touch test is ~1 block; this is
                     // deliberately looser, the same "proxy, not the bytecode box test" standing this file's header names)
const ARM = 5.0;     // blocks -- must clear this far away before the NEXT dip counts as a new swoop
const CIRCLE = 6.0;  // blocks -- beyond this the phantom is treated as "circling", not mid-swoop, for the height band
const TICK_TOL = 220;      // ticks -- first-swoop timing band (StartAttackGoal's own (8..12)x20-tick cooldown spread)
const DMG_TOL_REL = 0.6;   // relative -- damage total (a hit or two either way swings this a lot at these small totals)
const SWOOP_TOL = 1;       // +/- swoops over T ticks
const HEIGHT_TOL = 15;     // blocks -- circling-height band (CircleMovementGoal's own rand(20)+rand(9) spread)
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'phantom.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'phantom.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('phantomrefcheck: SKIP (golden not generated -- run node tools/referee/runphantom.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

let seed = 0x00706821;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// Whole-engine load, same module list avoidrefcheck.mjs/hoglinrefcheck.mjs already use (this pack
// needs the SAME breadth: cat's own module for the swoop-abort test, phantom's own file, the whole
// AI/goal/combat/survival substrate for a real player-shaped target to take a real hit).
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Goat && M.Goat.init) M.Goat.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, States: S } = M;
const P = M.Player;

const PAD = 0;
function buildFloor() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) w.set(x, PAD - 1, z, stone);
}

function spawnAt(type, x, y, z) {
  const e = EL.spawn(type, x, y, z);
  if (!e) return null;
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  return e;
}

/** One BARE or WITH_CAT rep: the player stands at (0.5,PAD,0.5), a phantom spawns 5 above it (WITH_CAT
 *  also parks a frozen cat CAT_DX away -- `e.ai = {tick(){}}` is this check's own NoAI stand-in, same
 *  standing as freezing anything else headless: no src edit, a scaffold-only substitute for the real
 *  server's `NoAI:1b`). Logs T ticks of (phantom Pos, bot Pos, bot health), PAD-relative like the golden.
 */
function runRep(scen, opts) {
  buildFloor(); EL.list.length = 0;
  P.x = 0.5; P.y = PAD; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.onGround = true;
  P.health = 200; P.maxHealth = 200; P.invulnerable = 0; P.dead = false;
  const phantom = spawnAt('phantom', (opts && opts.px !== undefined ? opts.px : 0.5), PAD + 5, 0.5);
  if (!phantom) return { err: 'EL.spawn gives nothing for phantom' };
  if (scen.cat) {
    const cat = spawnAt('cat', 0.5 + CAT_DX, PAD, 0.5);
    if (cat) cat.ai = { tick: function () {} };   // frozen, same reason as the server's own NoAI:1b (this file's own header)
  }
  const plog = [], blog = [], hlog = [];
  for (let t = 0; t < T; t++) {
    plog.push([phantom.x, phantom.y - PAD, phantom.z]);
    blog.push([P.x, P.y - PAD, P.z]);
    hlog.push(P.health);
    if (phantom.removed || phantom.dead) break;
    EL.tick();
    // the bot is a LIVING player on the server: its hurt-immunity (`timeUntilRegen`, LivingEntity.baseTick) counts down
    // every tick -- Sv.tick's own first line. Without it the 20 ticks the first bite opens never close, and every later
    // bite is swallowed (engine 1 bite for 3 swoops vs the server's 3).
    if (P.invulnerable > 0) P.invulnerable--;
  }
  return { plog, blog, hlog };
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function summarize(plog, blog, hlog) {
  const n = Math.min(plog.length, blog.length, hlog.length);
  const dists = [], heights = [];
  for (let i = 0; i < n; i++) { dists.push(dist3(plog[i], blog[i])); heights.push(plog[i][1] - blog[i][1]); }
  let firstSwoop = -1;
  for (let i = 0; i < n; i++) if (dists[i] < TOUCH) { firstSwoop = i; break; }
  let armed = true, swoops = 0;
  for (let i = 0; i < n; i++) {
    if (dists[i] >= ARM) armed = true;
    else if (armed && dists[i] < TOUCH) { swoops++; armed = false; }
  }
  const circleH = []; for (let i = 0; i < n; i++) if (dists[i] > CIRCLE) circleH.push(heights[i]);
  const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const dmg = hlog[0] - hlog[hlog.length - 1];
  return { firstSwoop, swoops, dmg, medHeight: median(circleH), n };
}
const median = (a) => { const b = a.filter((v) => v != null).slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };

function compare(s, gSummaries, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const sSwooped = gSummaries.filter((g) => g.firstSwoop >= 0).length * 2 > gSummaries.length;
  const eSwooped = e.firstSwoop >= 0;
  const out = [];
  if (sSwooped !== eSwooped) {
    out.push(`${s.id}: server ${sSwooped ? 'swoops onto' : 'never reaches'} the bot, engine ${eSwooped ? 'swoops onto' : 'never reaches'} it`);
    return out;   // the rest only makes sense once both sides agree a swoop happened
  }
  if (!sSwooped) return out;   // WITH_CAT's expected green: neither side ever gets close
  const sTicks = gSummaries.map((g) => g.firstSwoop).filter((v) => v >= 0);
  const svTick = median(sTicks);
  if (svTick != null && Math.abs(e.firstSwoop - svTick) > TICK_TOL) out.push(`${s.id}: first swoop tick: server ${svTick} (median of ${sTicks.length}), engine ${e.firstSwoop} (band +/-${TICK_TOL})`);
  const sSwoops = median(gSummaries.map((g) => g.swoops));
  if (sSwoops != null && Math.abs(e.swoops - sSwoops) > SWOOP_TOL) out.push(`${s.id}: swoop count over ${T} ticks: server ${sSwoops} (median), engine ${e.swoops}`);
  const sDmg = median(gSummaries.map((g) => g.dmg));
  if (sDmg != null) {
    const tol = Math.max(2, sDmg * DMG_TOL_REL);
    if (Math.abs(e.dmg - sDmg) > tol) out.push(`${s.id}: damage dealt to the bot: server ${sDmg} (median), engine ${e.dmg} (tolerance +/-${tol.toFixed(1)})`);
  }
  const sHeight = median(gSummaries.map((g) => g.medHeight));
  if (sHeight != null && e.medHeight != null && Math.abs(e.medHeight - sHeight) > HEIGHT_TOL) {
    out.push(`${s.id}: circling height band (median phantom.y - bot.y): server ${sHeight.toFixed(1)}, engine ${e.medHeight.toFixed(1)} (tolerance +/-${HEIGHT_TOL})`);
  }
  return out;
}

console.log(`phantomrefcheck — mob PHANTOM swoop/circle vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const reds = [];
let pass = 0;
const ENG = {}, GS = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const gSummaries = g.plogs.map((p, i) => summarize(p, g.blogs[i], g.hlogs[i]));
  GS[s.id] = gSummaries;
  const e = runRep(s, {});
  const eSum = e.err ? e : summarize(e.plog, e.blog, e.hlog);
  ENG[s.id] = eSum;
  const bad = compare(s, gSummaries, eSum);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    console.log(`  ${s.id.padEnd(10)} server swoop@ ${gSummaries.map((g2) => g2.firstSwoop).join('/')} dmg ${gSummaries.map((g2) => g2.dmg).join('/')}` +
      `  engine ${e.err || `swoop@ ${eSum.firstSwoop} swoops ${eSum.swoops} dmg ${eSum.dmg} medH ${eSum.medHeight == null ? 'n/a' : eSum.medHeight.toFixed(1)}`}`);
  }
}

let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const bareScen = SCEN.find((q) => q.id === 'bare'), catScen = SCEN.find((q) => q.id === 'with_cat');
// All three breaks target the "did a swoop happen at all" verdict (compare()'s FIRST branch, checked
// both directions per rule 6) rather than the damage-magnitude numbers below it: that branch's baseline
// is green on today's golden for BOTH scenarios, so a break there can only be caught by the check
// actually noticing the mutation -- not by coincidentally landing inside an already-red tolerance band
// (the damage metric IS already red today, a real engine-vs-server finding, logged above; anchoring an
// anti-vacuity break to an already-failing metric risks the break being masked by that pre-existing red,
// which is exactly what happened here on a first pass and is why these three don't use it).
{ // golden BARE: push every logged phantom position PAD blocks further from the bot so it never gets
  // within TOUCH -- as if the server's own dive had missed every rep. The engine still swoops in for
  // real, so "did it happen" must flip to a mismatch.
  const g = JSON.parse(JSON.stringify(golden.cases.bare));
  g.plogs = g.plogs.map((p) => p.map((pt) => [pt[0] + 50, pt[1], pt[2]]));
  const gSum = g.plogs.map((p, i) => summarize(p, g.blogs[i], g.hlogs[i]));
  brk('golden bare phantom pushed 50 blocks away (should never touch)', compare(bareScen, gSum, ENG.bare).length > 0);
}
{ // golden WITH_CAT: splice in the BARE case's own close approach, as if the cat-abort had failed on
  // the server. The engine (cat correctly wired, 07zz1_phantom.js's SwoopMovementGoal) still shows no
  // swoop at all, so this must flip to a mismatch too.
  const g = JSON.parse(JSON.stringify(golden.cases.with_cat));
  const n = g.plogs[0].length;
  g.plogs = golden.cases.bare.plogs.map((p) => p.slice(0, n));
  g.blogs = golden.cases.bare.blogs.map((b) => b.slice(0, n));
  const gSum = g.plogs.map((p, i) => summarize(p, g.blogs[i], g.hlogs[i]));
  brk('golden with_cat spliced in a close approach (as if the cat abort failed server-side)', compare(catScen, gSum, ENG.with_cat).length > 0);
}
{ // engine BARE re-run with the phantom spawned 200 blocks away (outside FindTargetGoal's own 64-block
  // search, 07zz1_phantom.js's own `d > 64` gate) -- it should never find/swoop the bot at all, while
  // the golden (a real dive every rep) still says it should -- must flip to red.
  const e2 = runRep(bareScen, { px: 200.5 });
  const eSum2 = e2.err ? e2 : summarize(e2.plog, e2.blog, e2.hlog);
  brk('engine phantom spawned 200 blocks away (should never find the bot)', compare(bareScen, GS.bare, eSum2).length > 0);
}

for (const r of reds) console.log('  ✗ ' + r);
console.log(`phantomrefcheck: ${pass}/${SCEN.length} scenarios match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
