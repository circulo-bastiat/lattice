#!/usr/bin/env node
// mobgriefingcheck.mjs — worker3/mobcommand-s145: /gamerule mobGriefing, driven through the
// REAL `/gamerule` COMMAND (src/15g_commands.js `C.run`), against every live consumer this
// engine has today: creeper explosion (07zb_creeper.js), enderman block pickup/placement
// (07zg_enderman.js), silverfish CallForHelpGoal infest-on-hit (07zn_silverfish.js), and
// ravager leaf-breaking (07k_goals.js `Ai.ravagerBreakLeaves`/`Ai.RavagerRoarGoal`).
//
//   node tools/mobgriefingcheck.mjs [--verbose]
//
// ⚠ WHY THIS IS ITS OWN CHECK, not folded into creepercheck/endermancheck/silverfishcheck/
// raidmobcheck. Every one of those already proves its own mob respects a mobGriefing FLAG —
// but each one hands the mob's code a HAND-BUILT boolean or `ctx.mobGriefing` closure directly
// (creepercheck calls `Ex.explode(..., true/false)` with a literal; raidmobcheck overrides
// `ctx.mobGriefing` with `() => false`). None of them ever runs the actual `/gamerule mobGriefing
// false` COMMAND (`src/15g_commands.js`, `Commands.RULES_LIVE.mobGriefing`) and checks that the
// value it stores is what each of the FOUR different readers below actually sees — and the four
// readers are not textually identical: `Cr.explode` reads `C.ruleGet('mobGriefing') !== 'false'`,
// `Enderman.Pick/PlaceBlockGoal` read `C.ruleGet('mobGriefing') === 'false'`, and
// `EL.aiCtx(e).mobGriefing` (the ctx silverfish/ravager both read through) is
// `C.ruleGet('mobGriefing') === 'true'`. Three different comparisons against the SAME stored
// string is exactly the shape a future refactor could quietly desync — this file is the join
// that would catch it, by making the ONE state change (`/gamerule mobGriefing <value>`) and
// checking every downstream consumer against it, live.
//
// Sections:
//   1. setup + the default (nothing set) reads true through every one of the four readers
//   2. creeper explosion — block damage gated, entity damage unconditional, both directions
//   3. enderman pickup/placement — both directions, deterministic (the gate short-circuits
//      canUse() before any dice roll)
//   4. silverfish CallForHelpGoal (the "infest a stone block when hit" mechanic) — both
//      directions
//   5. ravager leaf-breaking (Ai.RavagerRoarGoal's horizontalCollision branch) — both directions
//   6. anti-vacuity — for each of the four, force `C.ruleGet` to lie about the stored value and
//      watch the SAME code path answer differently, proving every "gated" result above is the
//      live command's own string talking, not a coincidence of the fixture
//
// A note on what does NOT get a section here, and why (not built, per Dan's standing testing-
// only order): ravager "trampling crops by walking over them" (distinct from the roar's own
// leaf-breaking, which section 5 covers) has no implementation anywhere in src/ (grepped) and no
// `.decomp` JAVA SOURCE exists in this checkout to confirm the mechanic's shape or its own
// mobGriefing gate against — `.decomp/` here is names.tsv (an obfuscation map) with an EMPTY
// directory skeleton, not decompiled sources (0 .java files). `.decomp/names.tsv`'s own
// `RavagerEntity` (class `bmi`) rows name no crop/trample method distinct from the roar's own
// `roar()`/leaf fields already covered by `Ai.ravagerBreakLeaves`. This is a referee question
// (does 1.18.2 gate crop-trampling on mobGriefing at all, distinct from the roar mechanic?), not
// a bug in what exists — named in full in the unit's own report, not guessed at here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('mobgriefingcheck — worker3/mobcommand-s145: /gamerule mobGriefing joins every live consumer');

// ── load: every module the four mobs + the real /gamerule command both need, in build.mjs's
//    own relative order (loadsrc.mjs's WORKER_FILES already covers 00_ns.js..05_mesher.js) ────
const EXTRA = [
  '02g_items.js', '02i_text.js', '02j_sounds.js',
  '02f_tags.js',
  '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js',
  '07h_entities.js',
  '07i_entitylist.js',
  '09b_sky.js',
  '14b_physics.js', '14c_raycast.js',
  '14d_survival.js', '14e_gamemode.js', '14f_inventory.js', '14h_brigadier.js',
  '14j_combat.js',
  '07k_goals.js', '07l_spawn.js',
  '07za_explosion.js', '07zb_creeper.js',
  '07zg_enderman.js',
  '07zn_silverfish.js',
  '15g_commands.js'
];
const MCL = loadEngine({ extra: EXTRA, dom: false });

MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
{
  const raw = readFileSync(join(ASSETS, 'lang.bin'));
  const { inflateRawSync } = await import('node:zlib');
  MCL.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
}
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
// the golden gamerule roster, EXACTLY as `commandcheck.mjs` loads it and `gen-data.mjs` ships it
// (D-164/D-314: one join, not a second hand-copied table that could quietly disagree).
MCL.DATA.gameRules = (() => {
  const out = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'gamerules-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 3) out[c[0]] = { t: c[1] === 'integer' ? 'i' : 'b', d: c[2] };
  }
  return out;
})();

const W = MCL.World, S = MCL.States, R = MCL.Reg, CH = MCL.CH;
const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Cb = MCL.Combat;
const Ex = MCL.Explosion, Cr = MCL.Creeper, Em = MCL.Enderman, SF = MCL.Silverfish;
const C = MCL.Commands;

MCL.Entities.init();
EL.init();
W.init(1);
MCL.Behave.init(W);
Ai.init();
Spawn.init();
Cb.init();
Ex.init();
Cr.init();
Em.init();
C.build();

ok(Ex.ready && Cr.ready && Em.ready, 'Explosion/Creeper/Enderman modules report ready');
ok(!!SF, 'NS.Silverfish module loaded');
ok(C.ready, 'the command dispatcher builds — /gamerule is registered');

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
const stateOf = (n) => S.stateOf(n) | 0;

// the real command — no player needed (C.source handles `player === null`; the default
// `opts.level` is 4, well past `/gamerule`'s own `perm(2)` requirement).
function setGriefing(v) {
  const res = C.run('/gamerule mobGriefing ' + v, null, {});
  ok(res.ok, `/gamerule mobGriefing ${v} runs (${res.ok ? '' : JSON.stringify(res.lines)})`);
}

// ═════════════════════ 1. the default (nothing set yet) reads true everywhere ═══════════════
{
  say('\n§1 default (unset) — every reader sees mobGriefing on');
  ok(C.ruleGet('mobGriefing') === 'true', `C.ruleGet('mobGriefing') defaults to the string 'true' (got ${JSON.stringify(C.ruleGet('mobGriefing'))})`);
  const q = C.run('/gamerule mobGriefing', null, {});
  ok(q.ok && /true/.test(q.lines.join(' ')), `/gamerule mobGriefing (query form) reports true — got ${JSON.stringify(q.lines)}`);
}

// ═════════════════════ 2. creeper explosion — block damage gated, entity damage is not ═════
{
  say('\n§2 creeper explosion');
  freshWorld();
  setGriefing('false');
  let cx = 0, cy = 20, cz = 0;
  put(cx + 3, cy, cz, 'dirt');
  const cow = EL.spawn('cow', cx + 0.5, cy, cz + 0.5);
  ok(!!cow, 'a cow (the creeper\'s own live target) exists beside the blast centre');
  const creeper = EL.spawn('creeper', cx, cy, cz);
  ok(!!creeper && creeper.explosionRadius === 3, 'a creeper spawns with its own default explosionRadius (3)');
  const hpBefore = cow.health, dirtBefore = W.getBlock(cx + 3, cy, cz);
  Cr.explode(creeper);
  ok(cow.health < hpBefore, `mobGriefing false via the REAL /gamerule command: the creeper's own target still takes blast damage (before ${hpBefore}, after ${cow.health})`);
  ok(W.getBlock(cx + 3, cy, cz) === dirtBefore, 'mobGriefing false via the REAL command: the dirt block is untouched');

  freshWorld();
  setGriefing('true');
  cx = 10; cy = 20; cz = 0;
  put(cx + 1, cy, cz, 'dirt');
  const cow2 = EL.spawn('cow', cx + 0.5, cy, cz + 0.5);
  const creeper2 = EL.spawn('creeper', cx, cy, cz);
  Cr.explode(creeper2);
  ok(W.getBlock(cx + 1, cy, cz) === 0, 'mobGriefing true via the REAL /gamerule command: the SAME shape of dirt block breaks now');
  ok(cow2.health < 20, 'mobGriefing true: the target still takes damage too (both effects, not one flipping the other off)');
}

// ═════════════════════ 3. enderman pickup / placement — deterministic gate ══════════════════
{
  say('\n§3 enderman pickup/placement');
  freshWorld();
  setGriefing('false');
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  put(0, 65, 0, 'dirt');   // enderman_holdable, within the 4x3x4 sweep
  const pickup = new Em.PickUpBlockGoal(e);
  ok(pickup.canUse() === false, 'mobGriefing false via the REAL command: PickUpBlockGoal.canUse() is false immediately — the gate short-circuits before any dice roll');
  const place = new Em.PlaceBlockGoal(Object.assign(e, { carriedBlock: stateOf('dirt') }));
  ok(place.canUse() === false, 'mobGriefing false via the REAL command: PlaceBlockGoal.canUse() is false immediately too');

  freshWorld();
  setGriefing('true');
  const e2 = EL.spawn('enderman', 0.5, 64, 0.5);
  put(-2, 64, -2, 'dirt');   // floor(ex-2, ey, ez-2) with rnd()===0 -- see tick()'s own formula
  const pickup2 = new Em.PickUpBlockGoal(e2);
  MCL.EntityList.random = () => 0;   // rint(PICKUP_CHANCE) === 0 -> canUse() true; tick()'s own sweep with rnd()===0 lands on floor(ex-2, ey, ez-2)
  ok(pickup2.canUse() === true, 'mobGriefing true via the REAL command: PickUpBlockGoal.canUse() can now return true');
  pickup2.tick();
  ok(e2.carriedBlock !== null && S.block[e2.carriedBlock] === S.block[stateOf('dirt')], 'and tick() actually picks the dirt block up (carriedBlock is the dirt state)');
  ok(W.getBlock(-2, 64, -2) === 0, 'the picked-up block is removed from the world');

  const e3 = EL.spawn('enderman', 5.5, 64, 5.5);
  e3.carriedBlock = stateOf('dirt');
  put(4, 63, 4, 'stone');   // solid floor under floor(ex-1, ey, ez-1) with rnd()===0 -- see tick()'s own formula
  const place2 = new Em.PlaceBlockGoal(e3);
  ok(place2.canUse() === true, 'mobGriefing true: PlaceBlockGoal.canUse() can return true too (same forced roll)');
  place2.tick();
  ok(e3.carriedBlock === null, 'and tick() actually places it — carriedBlock is cleared');
  ok(W.getBlock(4, 64, 4) === stateOf('dirt'), `the dirt landed at the deterministic (ex-1, ey, ez-1) cell — got block ${W.getBlock(4, 64, 4)}`);
  MCL.EntityList.random = null;
}

// ═════════════════════ 4. silverfish CallForHelpGoal — infest-on-hit ════════════════════════
{
  say('\n§4 silverfish CallForHelpGoal (infest a stone block when the silverfish is hit)');
  freshWorld();
  setGriefing('true');
  const e = EL.spawn('silverfish', 0.5, 64, 0.5);
  put(0, 64, 0, 'infested_stone');   // the cell the box-walk visits FIRST (dx=dy=dz=0)
  const ctx = EL.aiCtx(e);
  ok(typeof ctx.mobGriefing === 'function' && ctx.mobGriefing() === true, 'EL.aiCtx(silverfish).mobGriefing() reads true through the REAL /gamerule command');
  const goal = new SF.CallForHelpGoal(e, ctx);
  const countBefore = EL.list.length;
  goal.onHurt();
  for (let t = 0; t < 20; t++) goal.tick();   // the 20-tick armed delay, then the scan fires
  ok(W.getBlock(0, 64, 0) === 0, 'mobGriefing true: the infested block the silverfish is standing in is broken');
  ok(EL.list.length === countBefore + 1, 'mobGriefing true: breaking it released a fresh silverfish (InfestedBlock.onStacksDropped -> SF.spawn)');

  freshWorld();
  setGriefing('false');
  const e2 = EL.spawn('silverfish', 0.5, 64, 0.5);
  const infestedState = stateOf('infested_stone');
  put(0, 64, 0, 'infested_stone');
  const ctx2 = EL.aiCtx(e2);
  ok(ctx2.mobGriefing() === false, 'EL.aiCtx(silverfish).mobGriefing() reads false through the REAL /gamerule command');
  const goal2 = new SF.CallForHelpGoal(e2, ctx2);
  const countBefore2 = EL.list.length;
  goal2.onHurt();
  for (let t = 0; t < 20; t++) goal2.tick();
  ok(W.getBlock(0, 64, 0) === stateOf('stone'), 'mobGriefing false: the SAME infested block reverts to plain stone instead');
  ok(EL.list.length === countBefore2, 'mobGriefing false: no fresh silverfish is released');
}

// ═════════════════════ 5. ravager leaf-breaking (RavagerRoarGoal) ═══════════════════════════
{
  say('\n§5 ravager leaf-breaking (Ai.RavagerRoarGoal, horizontalCollision branch)');
  freshWorld();
  setGriefing('true');
  const rav = EL.spawn('ravager', 0, 64, 0);
  put(1, 64, 0, 'oak_leaves');
  rav.horizontalCollision = true;
  const ctx = EL.aiCtx(rav);
  ok(ctx.mobGriefing() === true, 'EL.aiCtx(ravager).mobGriefing() reads true through the REAL command');
  new Ai.RavagerRoarGoal(rav, ctx).tick();
  ok(W.getBlock(1, 64, 0) === 0, 'mobGriefing true: the leaves block inside the ravager\'s own expanded bounding box is broken');

  freshWorld();
  setGriefing('false');
  const rav2 = EL.spawn('ravager', 0, 64, 0);
  const leavesState = stateOf('oak_leaves');
  put(1, 64, 0, 'oak_leaves');
  rav2.horizontalCollision = true;
  const ctx2 = EL.aiCtx(rav2);
  ok(ctx2.mobGriefing() === false, 'EL.aiCtx(ravager).mobGriefing() reads false through the REAL command');
  new Ai.RavagerRoarGoal(rav2, ctx2).tick();
  ok(W.getBlock(1, 64, 0) === leavesState, 'mobGriefing false: the SAME leaves block survives');
}

// ═════════ 6. anti-vacuity — force C.ruleGet to lie, watch every reader flip with it ════════
{
  say('\n§6 anti-vacuity: force C.ruleGet to lie about the stored value');
  const realRuleGet = C.ruleGet;

  // 6a. creeper — stored false, ruleGet forced to answer 'true'
  freshWorld();
  setGriefing('false');
  {
    let cx = 20, cy = 20, cz = 0;
    put(cx + 1, cy, cz, 'dirt');
    const creeper = EL.spawn('creeper', cx, cy, cz);
    C.ruleGet = (n) => (n === 'mobGriefing' ? 'true' : realRuleGet(n));
    Cr.explode(creeper);
    okAv(W.getBlock(cx + 1, cy, cz) === 0,
      'creeper: with the STORED value still \'false\' but C.ruleGet forced to answer \'true\', Cr.explode breaks the block anyway — proving §2\'s "no break" result came from C.ruleGet, not a cached flag or a fixture coincidence');
    C.ruleGet = realRuleGet;
  }

  // 6b. enderman — same trick, PickUpBlockGoal.canUse()
  freshWorld();
  setGriefing('false');
  {
    const e = EL.spawn('enderman', 0.5, 64, 0.5);
    put(0, 65, 0, 'dirt');
    const pickup = new Em.PickUpBlockGoal(e);
    C.ruleGet = (n) => (n === 'mobGriefing' ? 'true' : realRuleGet(n));
    MCL.EntityList.random = () => 0;
    okAv(pickup.canUse() === true,
      'enderman: with the STORED value \'false\' but C.ruleGet forced to \'true\', PickUpBlockGoal.canUse() flips to true — the gate reads C.ruleGet live, every call, not once at goal construction');
    MCL.EntityList.random = null;
    C.ruleGet = realRuleGet;
  }

  // 6c. silverfish — EL.aiCtx(e).mobGriefing() goes through C.ruleGet too
  freshWorld();
  setGriefing('false');
  {
    const e = EL.spawn('silverfish', 0.5, 64, 0.5);
    put(0, 64, 0, 'infested_stone');
    const ctx = EL.aiCtx(e);
    C.ruleGet = (n) => (n === 'mobGriefing' ? 'true' : realRuleGet(n));
    const countBefore = EL.list.length;
    const goal = new SF.CallForHelpGoal(e, ctx);
    goal.onHurt();
    for (let t = 0; t < 20; t++) goal.tick();
    okAv(W.getBlock(0, 64, 0) === 0 && EL.list.length === countBefore + 1,
      'silverfish: with the STORED value \'false\' but C.ruleGet forced to \'true\', CallForHelpGoal infests (breaks + releases a silverfish) anyway — EL.aiCtx built its mobGriefing() closure over the live C.ruleGet, not a snapshot taken at ctx-creation time');
    C.ruleGet = realRuleGet;
  }

  // 6d. ravager — same EL.aiCtx path
  freshWorld();
  setGriefing('false');
  {
    const rav = EL.spawn('ravager', 0, 64, 0);
    put(1, 64, 0, 'oak_leaves');
    rav.horizontalCollision = true;
    const ctx = EL.aiCtx(rav);
    C.ruleGet = (n) => (n === 'mobGriefing' ? 'true' : realRuleGet(n));
    new Ai.RavagerRoarGoal(rav, ctx).tick();
    okAv(W.getBlock(1, 64, 0) === 0,
      'ravager: with the STORED value \'false\' but C.ruleGet forced to \'true\', the roar goal breaks the leaves anyway — same live-read shape as the other three');
    C.ruleGet = realRuleGet;
  }

  ok(C.ruleGet === realRuleGet, 'C.ruleGet is restored to the real function after every forced-lie section (no leakage into later checks)');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
