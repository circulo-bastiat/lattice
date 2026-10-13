#!/usr/bin/env node
// itemrefcheck.mjs — infra I6 (25 Sept 2026): ITEM ENTITIES + EXPERIENCE ORBS vs the real 1.18.2
// server (golden: runitems.mjs, items.json; lanes + the question: itemscen.mjs). Each lane is
// re-run from a CLEARED engine entity list on the SAME flat stone floor the golden used
// (FLOOR_Y), so lanes never see each other — matching the golden's forceloaded, player-less
// pads. Nothing here owns a merge/despawn/gravity number: EL.ITEM_MERGE_BOX/EL.ITEM_LIFETIME/
// EL.ITEM_MERGE_EVERY (src/07i_entitylist.js) and Xp.MERGE_BOX/Xp.DESPAWN_AGE (src/07zz_xporb.js)
// are read off the engine itself.
//
// KNOWN, NAMED MISMATCH (not a harness bug): vanilla's ItemEntity.tick only retries a merge on
// the FAST (2-tick) cycle when the item's floor CELL changed that tick; a stationary item (our
// default) is only re-checked every 40 ticks (.decomp/net/minecraft/entity/ItemEntity.java
// tryMerge call, `int $$5 = $$4 ? 2 : 40`). `EL.tickItem` (src/07i_entitylist.js:1364-1367) calls
// `EL.mergeNear` on a flat `age % EL.ITEM_MERGE_EVERY(=2) === 0`, with no floor-cell gate — so a
// merge that vanilla only performs at +40 has usually already happened in the engine by +5. The
// MERGE_DIST lanes below are read at +5 and +40 for exactly this reason and are EXPECTED to
// disagree at +5; this file reports it as a finding rather than papering over it.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import {
  FLOOR_Y, MERGE_DIST_TICKS, MERGE_DIST, MERGE_LIMIT_TICKS, MERGE_LIMIT, DESPAWN_TICKS,
  ITEM_DESPAWN, FALL_HEIGHT, FALL_TICKS, XP_TICKS, XP_DESPAWN_TICKS, XP_SAME, XP_MIXED, XP_DESPAWN,
} from './itemscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'items.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'items.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('itemrefcheck: SKIP (golden not generated -- run node tools/referee/runitems.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });

// a flat stone floor at FLOOR_Y (block top = FLOOR_Y, the same surface runitems.mjs's pads use),
// no player -- Xp.expensiveUpdate's `if (P && !P.dead)` is false with no Player module touched,
// so no orb ever gets pulled, matching the golden's player-less lanes.
const stoneState = M.States.stateOf('stone');
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.Physics.blockIdAt = (x, y, z) => (Math.floor(y) < FLOOR_Y ? stoneState : 0);
M.World = Object.assign(M.World || {}, { get: () => 0, set: () => {}, getBlock: () => 0, setBlock: () => {}, tickingAt: () => true, getLight: () => 0 });
if (M.Behave && M.Behave.init) M.Behave.init(M.World);
M.EntityList.init();
if (M.Xp && M.Xp.init) M.Xp.init();
const { EntityList: EL, Items: IT, Xp } = M;

function clear() { EL.list.length = 0; }
function tickN(n) { for (let i = 0; i < n; i++) EL.tick(); }
// ⚠ `.item` MUST BE THE NUMERIC index (`IT.of(name)`), not the bare name string: `EL.mergeNear`
// reads the merge cap with `IT.maxStack(e.item)` -> `IT.stackSize[e.item]` (src/02g_items.js:153),
// a typed array, so a STRING key misses and silently falls back to the default-64 cap. The
// dominant real path (mined-block drops, 07b_behaviour.js:1144 / 14_player.js:1312 / .../
// 07za_explosion.js:294 / 07zv_villagerbrain.js:908) already passes the numeric `idx` this way;
// a handful of others (07zj_fox.js sweet_berries, 07zp_turtle.js scute, 07zn_mooshroom.js,
// 07zy_composter.js bone_meal, 07zv_villagerbrain.js bread) pass a bare name and so ALWAYS merge
// as if capped at 64 regardless of the real item's max stack -- named below, not asserted here
// (this pack's lanes only use items real mining ever drops).
function itemIdx(name) { const i = IT.of(name); return i >= 0 ? i : name; }
function spawnItem(x, y, z, item, count, age) {
  const e = EL.spawn('item', x, y, z, { item: itemIdx(item), count });
  if (!e) return null;
  e.vx = e.vy = e.vz = 0;
  if (age !== undefined) e.age = age;
  return e;
}
function spawnOrb(x, y, z, value, age) {
  const e = EL.spawn('experience_orb', x, y, z, {});
  if (!e) return null;
  e.value = value; e.pickingCount = 1; e.orbAge = age === undefined ? 0 : age;
  e.vx = e.vy = e.vz = 0;
  return e;
}
function aliveEntities(type) { return EL.list.filter((e) => !e.removed && e.type === type); }

let pass = 0, fails = [], named = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

// ---------------------------------------------------------------------------------------------
// A. MERGE BY DISTANCE
for (const l of MERGE_DIST) {
  const g = golden.cases.mergeDist && golden.cases.mergeDist[l.id];
  if (!ok(!!g, `mergeDist ${l.id}: in the golden`)) continue;
  clear();
  const dx = l.axis === 'x' ? l.gap / 2 : 0, dy = l.axis === 'y' ? l.gap : 0;
  spawnItem(-dx, FLOOR_Y, 0, l.item, l.count0);
  spawnItem(dx, FLOOR_Y + dy, 0, l.item, l.count0);
  let ranTo = 0;
  const eng = {};
  for (const cp of [...MERGE_DIST_TICKS].sort((a, b) => a - b)) {
    tickN(cp - ranTo); ranTo = cp;
    eng[cp] = aliveEntities('item').length;
  }
  for (const cp of MERGE_DIST_TICKS) {
    const gcp = g.byTick[cp];
    if (!gcp) continue;
    const match = gcp.n === eng[cp];
    if (cp === 5 && !match) {
      named.push(`mergeDist ${l.id} @t${cp}: server ${gcp.n} entities, engine ${eng[cp]} -- ` +
        `EL.tickItem (src/07i_entitylist.js:1364-1367, ITEM_MERGE_EVERY every 2 ticks unconditionally) ` +
        `vs ItemEntity.tick's floor-cell-gated 2-vs-40 cadence (.decomp/net/minecraft/entity/ItemEntity.java ~127-133)`);
    } else if (cp === 40 && !match) {
      named.push(`mergeDist ${l.id} @t${cp}: server ${gcp.n} entities, engine ${eng[cp]} -- ` +
        `EL.mergeNear's box test (src/07i_entitylist.js:1385, \`Math.abs(o.x-e.x) > R\` with R = EL.ITEM_MERGE_BOX = 0.5) ` +
        `compares raw CENTRE distance, never adding either item's own half-width, so it only reaches ~0.5 blocks between ` +
        `centres; vanilla tests \`getBoundingBox().expand(0.5, 0.0, 0.5)\` (.decomp/net/minecraft/entity/ItemEntity.java ` +
        `tryMerge, ~line 168), an AABB that already has the item's real width, reaching ~0.5 + width (~0.75) between centres ` +
        `-- a 0.6-block gap merges on the real server and not in the engine`);
    } else {
      ok(match, `mergeDist ${l.id} @t${cp}: server ${gcp.n} entities, engine ${eng[cp]}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// B. MERGE LIMITS (read well past both the fast and slow merge cadence, so the 2-vs-40 gap above
// cannot hide a real limit bug)
for (const l of MERGE_LIMIT) {
  const g = golden.cases.mergeLimit && golden.cases.mergeLimit[l.id];
  if (!ok(!!g, `mergeLimit ${l.id}: in the golden`)) continue;
  clear();
  spawnItem(-0.15, FLOOR_Y, 0, l.item, l.a);
  const bOpts = { item: itemIdx(l.item2 || l.item), count: l.b };
  const eb = EL.spawn('item', 0.15, FLOOR_Y, 0, bOpts);
  if (eb) { eb.vx = eb.vy = eb.vz = 0; if (l.nameB) eb.nameTag = l.nameB; }
  tickN(MERGE_LIMIT_TICKS);
  const eCounts = aliveEntities('item').map((e) => e.count).sort((x, y) => x - y);
  const gCounts = (g.counts || []).slice().sort((x, y) => x - y);
  const match = JSON.stringify(eCounts) === JSON.stringify(gCounts);
  if (!match && l.id === 'named_vs_plain') {
    named.push(`mergeLimit ${l.id}: server [${gCounts}] (a custom name blocks the merge), engine [${eCounts}] -- ` +
      `EL.canMerge (src/07i_entitylist.js:1350-1357) only compares \`.item\`, with no NBT/display-name equality check ` +
      `at all, so a custom-named stack merges with a plain one of the same item -- vanilla's ` +
      `ItemEntity.canMerge(ItemStack,ItemStack) (.decomp ~lines 178-186) requires \`hasNbt()\` to agree and, when both ` +
      `have NBT, the NBT to be equal`);
  } else {
    ok(match, `mergeLimit ${l.id}: server counts [${gCounts}], engine [${eCounts}]`);
  }
}

// ---------------------------------------------------------------------------------------------
// C. ITEM DESPAWN
for (const l of ITEM_DESPAWN) {
  const g = golden.cases.despawn && golden.cases.despawn[l.id];
  if (!ok(!!g, `despawn ${l.id}: in the golden`)) continue;
  clear();
  spawnItem(0, FLOOR_Y, 0, 'cobblestone', 1, l.age);
  let ranTo = 0;
  for (const cp of [...DESPAWN_TICKS].sort((a, b) => a - b)) {
    tickN(cp - ranTo); ranTo = cp;
    const eAlive = aliveEntities('item').length;
    const gAlive = g.byTick[cp];
    if (gAlive !== undefined) ok(eAlive === gAlive, `despawn ${l.id} @t${cp}: server alive=${gAlive}, engine alive=${eAlive}`);
  }
}

// ---------------------------------------------------------------------------------------------
// D. ITEM FALL — y trace vs the golden's per-tick trace, both under the same FLOOR_Y/height.
{
  const g = golden.fall;
  if (ok(!!(g && g.ys && g.ys.length), 'fall: in the golden')) {
    clear();
    const e = spawnItem(0, FLOOR_Y + FALL_HEIGHT, 0, 'cobblestone', 1);
    // sampled BEFORE each tick, matching the golden's own convention: a `schedule`d capture
    // fires at the START of its target tick, before that tick's physics has run, so the
    // golden's ys[0] is the un-moved spawn height and ys[i] is the position after i ticks.
    const ys = [];
    for (let t = 0; t < FALL_TICKS; t++) { ys.push(e.removed ? null : e.y); EL.tick(); }
    let bad = 0, worst = 0, worstT = -1;
    for (let t = 1; t <= Math.min(FALL_TICKS, g.ys.length); t++) {
      const gy = g.ys[t - 1], ey = ys[t - 1];
      if (gy === null || gy === undefined || ey === null || ey === undefined) continue;
      const d = Math.abs(gy - ey);
      if (d > worst) { worst = d; worstT = t; }
      if (d > 0.03) bad++;
    }
    ok(bad === 0, `fall: ${bad} ticks off by >0.03 blocks (worst ${worst.toFixed(4)} at t${worstT}; server y1=${g.ys[0]}, engine y1=${ys[0]})`);
  }
}

// ---------------------------------------------------------------------------------------------
// E. XP ORBS
for (const lane of [XP_SAME, XP_MIXED]) {
  const g = golden.cases.xp && golden.cases.xp[lane.id];
  if (!ok(!!g, `xp ${lane.id}: in the golden`)) continue;
  clear();
  lane.values.forEach((v) => spawnOrb(0, FLOOR_Y, 0, v, 0));
  let ranTo = 0;
  for (const cp of [...XP_TICKS].sort((a, b) => a - b)) {
    tickN(cp - ranTo); ranTo = cp;
    const gcp = g.byTick[cp];
    if (!gcp) continue;
    const eAlive = aliveEntities('experience_orb');
    const eSup = eAlive.map((o) => o.value).sort((a, b) => a - b);
    const gSup = (gcp.orbs || []).map((o) => o.value).sort((a, b) => a - b);
    const nMatch = gcp.n === eAlive.length, supMatch = JSON.stringify(eSup) === JSON.stringify(gSup);
    if (!nMatch || !supMatch) {
      named.push(`xp ${lane.id} @t${cp}: server ${gcp.n} entities [${gSup}] (never merges -- /summon does not run the ` +
        `survival spawn-time merge, and vanilla's own periodic tick-merge requires \`(other.getId() - this.getId()) % 40 ` +
        `== 0\`, .decomp/net/minecraft/entity/ExperienceOrbEntity.java isMergeable ~line 159 -- five same-tick /summons ` +
        `get consecutive ids, never 40 apart), engine ${eAlive.length} entities [${eSup}] -- Xp.mergeNear ` +
        `(src/07zz_xporb.js:292-306) merges any two same-value orbs within MERGE_BOX with no id-difference gate at all`);
    } else { ok(true, `xp ${lane.id} @t${cp}: n`); ok(true, `xp ${lane.id} @t${cp}: values`); }
  }
}

// ---------------------------------------------------------------------------------------------
// XP orb despawn
for (const l of XP_DESPAWN) {
  const g = golden.cases.xpDespawn && golden.cases.xpDespawn[l.id];
  if (!ok(!!g, `xpDespawn ${l.id}: in the golden`)) continue;
  clear();
  spawnOrb(0, FLOOR_Y, 0, l.value, l.age);
  let ranTo = 0;
  for (const cp of [...XP_DESPAWN_TICKS].sort((a, b) => a - b)) {
    tickN(cp - ranTo); ranTo = cp;
    const eAlive = aliveEntities('experience_orb').length;
    const gAlive = g.byTick[cp];
    if (gAlive !== undefined) ok(eAlive === gAlive, `xpDespawn ${l.id} @t${cp}: server alive=${gAlive}, engine alive=${eAlive}`);
  }
}

// ---------------------------------------------------------------------------------------------
// ANTI-VACUITY (D-30/D-305): perturb an engine constant in memory and require a lane that
// matches today to break.
let breaks = 0, breakPass = 0;
function breakAndCatch(label, set, restore, run) {
  breaks++; set();
  let broke = false;
  try { broke = run(); } finally { restore(); }
  if (broke) { breakPass++; pass++; if (VERBOSE) console.log('  ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: ' + label);
}
breakAndCatch('EL.ITEM_MERGE_BOX widened to 5 blocks merges a lane the golden shows apart', () => { EL.ITEM_MERGE_BOX = 5; }, () => { EL.ITEM_MERGE_BOX = 0.5; }, () => {
  const l = MERGE_DIST.find((x) => x.gap >= 0.9);
  const g = golden.cases.mergeDist && golden.cases.mergeDist[l.id] && golden.cases.mergeDist[l.id].byTick[40];
  if (!g) return false;
  clear();
  const dx = l.axis === 'x' ? l.gap / 2 : 0, dy = l.axis === 'y' ? l.gap : 0;
  spawnItem(-dx, FLOOR_Y, 0, l.item, l.count0);
  spawnItem(dx, FLOOR_Y + dy, 0, l.item, l.count0);
  tickN(40);
  return aliveEntities('item').length !== g.n;
});
breakAndCatch('Xp.DESPAWN_AGE doubled keeps an orb alive past the golden despawn', () => { Xp.DESPAWN_AGE = 12000; }, () => { Xp.DESPAWN_AGE = 6000; }, () => {
  const l = XP_DESPAWN[0];
  const g = golden.cases.xpDespawn && golden.cases.xpDespawn[l.id] && golden.cases.xpDespawn[l.id].byTick[15];
  if (g === undefined) return false;
  clear();
  spawnOrb(0, FLOOR_Y, 0, l.value, l.age);
  tickN(15);
  return aliveEntities('experience_orb').length !== g;
});

// Orchestrator (s150): a real engine-vs-server mismatch is a FAILURE (rule: the check fails on the bug and stays red
// until src/ is fixed, like hurtwinrefcheck/spawnerrefcheck) — the worker's version printed them as 'named' and exited 0.
const failures = named.length + fails.length;
console.log(`itemrefcheck: ${failures} failed (${named.length} engine-vs-server mismatches, ${fails.length} other), ${breakPass}/${breaks} anti-vacuity breaks caught (golden ${golden.generatedAt || 'n/a'})`);
for (const n of named) console.log('  FAIL ' + n);
for (const f of fails.slice(0, 80)) console.log('  ✗ ' + f);
console.log('');
console.log('================ itemrefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${failures}`);
console.log(` breaks caught ...... ${breakPass}`);
process.exit(failures ? 1 : 0);
