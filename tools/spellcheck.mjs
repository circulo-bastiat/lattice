#!/usr/bin/env node
// spellcheck.mjs — QUEUE 0.2 raid loop (loop/spells-s93): the evoker/illusioner SPELL-CAST
// state machine (`NS.Spell`, src/07v_spell.js) actually casts. Proves the four wired spells —
// `ConjureFangsGoal` (fang placement pattern + the real 6-magic-damage tick),
// `BlindTargetGoal`/`GiveInvisibilityGoal` (calling `NS.Effects`'s existing API, not
// reimplementing it) — against LIVE `EL.spawn`'d mobs run through the real `EL.tick()` loop,
// the same standard `raidmobcheck.mjs`/`aicheck.mjs` already hold themselves to, plus the raw
// state-machine helpers (`SP.findFangGround`, `SP.castFangs`) in isolation, and (loop/
// raidvex-s96) `SummonVexGoal` — a live evoker really spawning three moving, owned,
// life-ticked `vex` (`raidvexcheck.mjs` has the FULL vex substrate; this file only proves
// the evoker side casts it). `WololoGoal` is asserted STILL UNWIRED — `Spell.OWED` says why
// (no sheep colour state) — the same "prove the refusal, not just the feature" shape
// `raidmobcheck.mjs` already holds itself to for vex's own motion row.
//
//   node tools/spellcheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('spellcheck — QUEUE 0.2 raid loop: evoker/illusioner spell-cast state machine');

const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js',
          // KW-41 (s151) -- `SP.difficultyAboveEasy` now reads the real `Eq.localDifficulty()`
          // (07y_equip.js) instead of the bare global-difficulty-LEVEL index; no `NS.Items`
          // in this file's own module set, so `Ai.holdsBow`'s "no equipment system: assumed"
          // fallback still holds for KW-40's BowAttackGoal below (07ox_enchhelper.js is
          // loadsrc.mjs's own auto-added dependency of 07y_equip.js).
          '07y_equip.js',
          '07v_spell.js', '07k_goals.js',
          // loop/raidvex-s96 -- `Ai.ROSTER.vex` (07k_goals.js) constructs `NS.Fly.
          // VexMoveControl`, and `SP.castSummonVex` (07v_spell.js) can now spawn a real vex
          // through `ctx.spawnFn` mid-test (an evoker's own `SummonVexGoal`).
          '07t_fly.js', '07l_spawn.js',
          // s98 -- WololoGoal's own live sheep (Ai.ROSTER.sheep needs Passive.EatGrassGoal).
          '07m_breed.js', '07w_passive.js']
});
const entitiesJson = JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'));
M.DATA = Object.assign({}, M.DATA, { entities: entitiesJson });
M.Entities.init();
M.EntityList.init();
M.Hand.init();
M.Combat.init();
M.Ai.init();
M.Spell.init();
if (M.Passive && M.Passive.init) M.Passive.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');
ok(M.Spell.ready, 'Spell module reports ready (needs NS.Effects)');

const EL = M.EntityList, Ai = M.Ai, SP = M.Spell, ES = M.Effects, Ph = M.Physics, CH = M.CH, W = M.World, Diff = M.Diff, Eq = M.Equip;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  ok(W.loadedAt(0, 0), 'a chunk is loaded to place into');
}
function plate(radius) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    W.setBlock(x, PLAT_Y, z, STONE);
  }
}
function mkPlayer(over) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1, health: 20, maxHealth: 20
  }, over || {});
}
/** Ticks every live `evoker_fangs` entity's own state machine alongside `EL.tick()` —
 *  `SP.tickFangs`'s own header: it is a free function, not wired into `EL.tick`, same standing
 *  `Rd.tick`'s header already gives the raid module. */
// D-512: EL.tick() now dispatches evoker_fangs to SP.tickFangs itself (07i_entitylist.js), so
// this helper is a no-op — ticking here too would run every fang twice a tick.
function tickFangsInList(ctx) { /* D-512: EL.tick owns it */ }

// ═══ 1. constants — every literal transcribed off .decomp, not guessed ═════════════════
console.log('\n 1. spell timing/damage constants match .decomp (SpellcastingIllagerEntity/EvokerEntity/EvokerFangsEntity/IllusionerEntity)');
ok(SP.FANG_DAMAGE === 6, 'EvokerFangsEntity.damage(): 6.0F magic damage');
ok(SP.FANGS_TICKS_LEFT === 22, "EvokerFangsEntity's own `ticksLeft = 22` field init");
ok(SP.BLINDNESS_DURATION === 400, 'IllusionerEntity$BlindTargetGoal.castSpell: StatusEffectInstance(BLINDNESS, 400)');
ok(SP.INVISIBILITY_DURATION === 1200, 'IllusionerEntity$GiveInvisibilityGoal.castSpell: StatusEffectInstance(INVISIBILITY, 1200)');
{
  const fangs = new SP.ConjureFangsGoal({ x: 0, y: 0, z: 0, age: 0 }, {});
  ok(typeof fangs.start === 'function' && typeof fangs.tick === 'function', 'ConjureFangsGoal has the CastSpellGoal shape');
}

// ═══ 2. SP.findFangGround — the do-while ground search, isolated ══════════════════════
console.log('\n 2. SP.findFangGround finds the top of solid ground, and refuses when there is none');
{
  const solidAt = (x, y, z) => y === 4;   // one solid layer at y=4
  ok(SP.findFangGround(solidAt, 0.5, 0.5, 3, 8) === 5, 'ground at y=4 -> fang spawns at y=5 (one above the solid block)');
  ok(SP.findFangGround(() => false, 0.5, 0.5, 3, 8) === null, 'no solid block anywhere in range -> null (refused, not defaulted)');
}
// ANTI-VACUITY: a solidAt that always returns true (every voxel solid) must find ground on the
// VERY FIRST probe (at maxY) — proving the loop actually reads solidAt's return value rather
// than looping to some other fixed answer.
okAv(SP.findFangGround(() => true, 0, 0, 0, 10) === 10, 'an always-solid probe finds ground at exactly floor(maxY) — the search reads solidAt, not a hard-coded fallback');

// #1123 — isSideSolidFullSquare(UP) below, plus collision max-Y offset of the block AT pos.
{
  const FULL = [[0, 0, 0, 1, 1, 1]], SNOW4 = [[0, 0, 0, 1, 0.5, 1]], SLAB = [[0, 0, 0, 1, 0.5, 1]];
  const mk = (map) => (x, y, z) => map[y] || null;
  ok(SP.findFangGround(null, 0.5, 0.5, 3, 8, mk({ 4: FULL, 5: SNOW4 })) === 5.5, 'snow_layer x4 at pos over a full block -> fang at y+0.5');
  ok(SP.findFangGround(null, 0.5, 0.5, 3, 8, mk({ 4: SLAB })) === null, 'bottom slab below is not a full top -> no ground');
  okAv(SP.findFangGround(null, 0.5, 0.5, 3, 8, mk({ 4: FULL, 5: SNOW4 })) !== 5, 'the snow offset is read from the shape at pos: same ground without it would give 5, not 5.5');
  ok(SP.findFangGround(null, 0.5, 0.5, 3, 8, mk({ 4: FULL })) === 5, 'plain full block, air at pos -> y unchanged');
ok(!SP.OWED.some(t => /partial-block-height|nothing is owed|not built/.test(t)), 'SP.OWED holds no stale fang-ground / fang-client claims (both are built)');
}

// ═══ 3. SP.castFangs — the close-range ring vs the far-range line ══════════════════════
console.log('\n 3. ConjureFangsGoal.castSpell places the right PATTERN for close vs far targets');
function collectFangs(e, ctx) {
  const spawned = [];
  const spawnCtx = Object.assign({}, ctx, {
    spawnFn: (type, x, y, z) => { const f = { type, x, y, z }; spawned.push(f); return f; }
  });
  SP.castFangs(e, spawnCtx);
  return spawned;
}
{
  const solidAt = (x, y, z) => y === 4;
  const evoker = { x: 0, y: 5, z: 0, target: { x: 2, y: 5, z: 0 } };   // squared dist 4 < 9 -> close
  const near = collectFangs(evoker, { solidAt });
  ok(near.length === 13, `close target (dist²<9) places 5+8=13 fangs, got ${near.length}`);
}
{
  const solidAt = (x, y, z) => y === 4;
  const evoker = { x: 0, y: 5, z: 0, target: { x: 20, y: 5, z: 0 } };  // far
  const far = collectFangs(evoker, { solidAt });
  ok(far.length === 16, `far target places 16 fangs in a line, got ${far.length}`);
  const dists = far.map((f) => Math.hypot(f.x - evoker.x, f.z - evoker.z)).sort((a, b) => a - b);
  ok(Math.abs(dists[0] - 1.25) < 1e-6, `nearest far-line fang is 1.25*(0+1) away, got ${dists[0]}`);
  ok(Math.abs(dists[15] - 1.25 * 16) < 1e-6, `farthest far-line fang is 1.25*16 away, got ${dists[15]}`);
}
// ANTI-VACUITY: with no ground anywhere, castFangs must place ZERO fangs, not fall back to a
// default height — proving the pattern loop is actually gated on SP.findFangGround's refusal.
{
  const evoker = { x: 0, y: 5, z: 0, target: { x: 2, y: 5, z: 0 } };
  const none = collectFangs(evoker, { solidAt: () => false });
  okAv(none.length === 0, 'with no solid ground anywhere, castFangs places zero fangs');
}

// ═══ 4. a live evoker actually casts ConjureFangsGoal through EL.tick(), damaging the target ═
console.log('\n 4. a live evoker casts ConjureFangsGoal on the real player and the fangs deal real damage');
freshWorld();
plate(20);
{
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0 });
  const evoker = EL.spawn('evoker', 0, PLAT_Y + 1, 0);
  ok(!!evoker && evoker.ai instanceof Ai.GoalSelector, "EL.spawn('evoker') carries a real GoalSelector");
  const ctx = EL.aiCtx(evoker);
  const hp0 = M.Player.health;
  let sawFangs = false, sawSpellId = false;
  for (let t = 0; t < 400; t++) {
    EL.tick();
    tickFangsInList(ctx);
    if (evoker.spell === SP.FANGS) sawSpellId = true;
    if (EL.list.some((o) => o.type === 'evoker_fangs')) sawFangs = true;
    // keep ticking past the hit so the LookAtTargetGoal's own spellTicks countdown (separate
    // from the fang's own warmup) has a chance to reach zero and reset e.spell — the ONE extra
    // condition beyond "damage landed" this loop waits for.
    if (M.Player.health < hp0 && evoker.spell === SP.NONE) break;
  }
  ok(sawSpellId, 'evoker.spell reads SP.FANGS (2) while ConjureFangsGoal is casting');
  ok(sawFangs, 'a real evoker_fangs entity appeared in EL.list');
  ok(M.Player.health < hp0, `the player took real fang damage (${hp0} -> ${M.Player.health}) through Cb.hurt`);
  ok(evoker.spell === SP.NONE, "evoker.spell resets to SP.NONE once spellTicks (and LookAtTargetGoal) end");
  EL.clear();
}
// ANTI-VACUITY: an evoker with no target never casts — no fangs, no damage, in the same window.
{
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 1000, y: PLAT_Y + 1, z: 0 });   // far outside NearestAttackableTargetGoal's range
  const evoker = EL.spawn('evoker', 0, PLAT_Y + 1, 0);
  const ctx = EL.aiCtx(evoker);
  for (let t = 0; t < 250; t++) { EL.tick(); tickFangsInList(ctx); }
  okAv(!EL.list.some((o) => o.type === 'evoker_fangs'), 'with no reachable target, the evoker never summons a fang in 250 ticks');
  EL.clear();
}

// ═══ 5. a live illusioner casts BlindTargetGoal and GiveInvisibilityGoal ═══════════════════
console.log('\n 5. a live illusioner blinds the player and turns itself invisible, both via NS.Effects');
freshWorld();
plate(20);
{
  // KW-41 (s151): BlindTargetGoal's own gate is real local difficulty > 2 (see section 9) — a
  // fresh 'normal' world sits at 1.5 and never blinds, so this section (proving the CAST itself
  // works once the gate opens) explicitly runs on 'hard' (fresh-world local difficulty 2.25,
  // real > 2). Section 9 below is the one that proves 'normal' stays silent.
  Diff.set('hard');
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0 });
  const illusioner = EL.spawn('illusioner', 0, PLAT_Y + 1, 0);
  ok(!!illusioner && illusioner.ai instanceof Ai.GoalSelector, "EL.spawn('illusioner') carries a real GoalSelector");
  let blinded = false, invis = false;
  for (let t = 0; t < 400; t++) {
    EL.tick();
    if (ES.hasStatusEffect(M.Player, 'blindness')) blinded = true;
    if (ES.hasStatusEffect(illusioner, 'invisibility')) invis = true;
    if (blinded && invis) break;
  }
  ok(blinded, "the player carries a real 'blindness' NS.Effects instance from BlindTargetGoal");
  ok(invis, "the illusioner carries a real 'invisibility' NS.Effects instance from GiveInvisibilityGoal");
  const bi = ES.getStatusEffect(M.Player, 'blindness');
  ok(!!bi && bi.duration <= SP.BLINDNESS_DURATION, `blindness duration (${bi && bi.duration}) is SP.BLINDNESS_DURATION or less (already ticking down)`);
  EL.clear();
  Diff.set('normal');
}
// ANTI-VACUITY: with NS.Effects.addStatusEffect stubbed to a no-op, neither effect appears —
// proving the two goals actually CALL the shared effects API rather than setting a field
// spellcheck happens to also read.
{
  freshWorld(); plate(20);
  const saved = ES.addStatusEffect;
  ES.addStatusEffect = () => false;
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0 });
  const illusioner = EL.spawn('illusioner', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 400; t++) EL.tick();
  okAv(!ES.hasStatusEffect(M.Player, 'blindness') && !ES.hasStatusEffect(illusioner, 'invisibility'),
    'with NS.Effects.addStatusEffect stubbed to a no-op, neither spell leaves a real effect — the goals call the shared API, not a private copy');
  ES.addStatusEffect = saved;
  EL.clear();
}

// ═══ 6. SummonVexGoal (loop/raidvex-s96 -- CLOSED) really summons vex; WololoGoal is not ═
console.log('\n 6. a live evoker really summons vex (loop/raidvex-s96); WololoGoal wired s98 (section s98)');
ok(typeof SP.SummonVexGoal === 'function', 'SP.SummonVexGoal exists (loop/raidvex-s96)');
ok(typeof SP.WololoGoal === 'function', 'SP.WololoGoal exists (s98 — sheep carry e.woolColor since D-523)');
{
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0 });
  EL.spawn('evoker', 0, PLAT_Y + 1, 0);
  // 340-tick startTimeDelay (EvokerEntity$SummonVexGoal.startTimeDelay(), javap'd) plus the
  // base CastSpellGoal's own initial cooldown -- 500 ticks is comfortable headroom, the same
  // margin `raidmobcheck.mjs`'s own multi-hundred-tick live runs already use.
  let sawVex = false;
  for (let t = 0; t < 500 && !sawVex; t++) { EL.tick(); sawVex = EL.list.some((o) => o.type === 'vex'); }
  ok(sawVex, 'a live evoker summons at least one real, spawned vex within 500 ticks');
  const vexes = EL.list.filter((o) => o.type === 'vex');
  ok(vexes.length > 0 && vexes.every((v) => v.owner && v.owner.type === 'evoker'), 'every summoned vex carries its owner evoker (setOwner)');
  ok(vexes.every((v) => v.vexAlive && v.vexLifeTicks > 0), 'every summoned vex is life-ticked (setLifeTicks — a natural vex, if this engine ever gets one, never would be)');
  EL.clear();
}
{
  // ANTI-VACUITY -- an evoker with NO live target never casts (the base CastSpellGoal's own
  // canStart requires one); disabling targeting proves the 500-tick run above is measuring
  // the real gate, not a goal that fires unconditionally on a timer.
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 500, y: PLAT_Y + 1, z: 500 });   // far outside followRange (12)
  EL.spawn('evoker', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 500; t++) EL.tick();
  okAv(!EL.list.some((o) => o.type === 'vex'), 'with no reachable target, the same evoker summons no vex in 500 ticks — the gate is real, not luck');
  EL.clear();
}

// ═══ 7. evoker_fangs is a real, spawnable entity (07i_entitylist.js) ═══════════════════════
console.log('\n 7. evoker_fangs spawns through EL.spawn (motion special-case, not the measured table)');
freshWorld();
plate(20);
{
  const fangs = EL.spawn('evoker_fangs', 0, PLAT_Y + 1, 0);
  ok(!!fangs, "EL.spawn('evoker_fangs') returns a live entity");
  ok(fangs && fangs.width > 0 && fangs.height > 0, 'it carries real dimensions off assets/entities.json');
  const before = { x: fangs.x, y: fangs.y, z: fangs.z };
  for (let t = 0; t < 10; t++) EL.tick();
  ok(fangs.x === before.x && fangs.z === before.z, 'it never drifts horizontally — zero gravity/drag, stationary like vanilla’s own (no move()/travel() override)');
  EL.clear();
}
// ═══ D-512: the LIVE join — EL.tick itself bites; take the dispatch away and nothing does ═══
console.log('\n D-512. EL.tick() ticks evoker_fangs (the live caller the worker pass left out)');
{
  const run = () => {
    freshWorld(); plate(20);   // #1122: the victim must stand on the fang's level, not fall out of the un-grown box
    const victim = EL.spawn('zombie', 0.5, PLAT_Y + 1, 0.5);
    const f = EL.spawn('evoker_fangs', 0.5, PLAT_Y + 1, 0.5);
    f.warmup = 0;
    const h0 = victim.health;
    for (let t = 0; t < 40; t++) EL.tick();
    const out = { dmg: h0 - victim.health, gone: !!f.removed };
    EL.clear();
    return out;
  };
  const live = run();
  ok(live.dmg > 0 && live.gone, `a fang spawned on a zombie bites it through EL.tick alone (${live.dmg} damage) and is discarded after`);
  const saved = SP.tickFangs; SP.tickFangs = function () {};
  const cut = run();
  SP.tickFangs = saved;
  okAv(cut.dmg === 0 && !cut.gone, 'with SP.tickFangs cut out of the loop the same fang never bites and never leaves — the dispatch is what does it');
}
// #206 added a proved static [0,1] row (extract-entity-static-src); EL.motionFor's special case must agree with it, and a wrong row must be caught.
{
  const row = M.DATA.entities.motion && M.DATA.entities.motion.evoker_fangs;
  const same = (r) => !!r && r[0] === 0 && r[1] === 1;
  okAv(same(row) && same(EL.motionFor('evoker_fangs')), "evoker_fangs' generated static motion row and EL.motionFor's special case both say [0, 1]");
  okAv(!same([0.04, 0.98]), 'a gravity-bearing row would not pass the same agreement test');
}

// ═══ s98. WololoGoal — a live evoker turns a BLUE sheep RED (EvokerEntity.java:316-390) ═══
console.log('\n s98. WololoGoal: a live evoker with no target recolours a blue sheep red after its 40-tick cooldown');
function mkSheep(x, z, color) {
  let sh = EL.spawn('sheep', x, PLAT_Y + 1, z);
  if (!sh) { sh = { type: 'sheep', x, y: PLAT_Y + 1, z, w: 0.9, h: 1.3, health: 8, maxHealth: 8 }; EL.list.push(sh); }
  sh.woolColor = color;
  return sh;
}
function runWololo(griefing, ticks, wall) {
  freshWorld(); plate(24);
  M.Player = mkPlayer({ x: 1000, y: PLAT_Y + 1, z: 0 });
  const saved = M.Commands;
  M.Commands = { ruleGet: (n) => (n === 'mobGriefing' ? (griefing ? 'true' : 'false') : null) };
  const evoker = EL.spawn('evoker', 0.5, PLAT_Y + 1, 0.5);
  const blue = mkSheep(6.5, 0.5, 'blue');
  if (wall) for (let y = 0; y < 5; y++) for (let z = -3; z <= 3; z++) W.setBlock(3, PLAT_Y + 1 + y, z, STONE);
  const white = mkSheep(-5.5, 0.5, 'white');
  const farBlue = mkSheep(20.5, 0.5, 'blue');
  let flippedAt = -1;
  for (let t = 0; t < ticks; t++) {
    EL.tick();
    // keep the sheep in place — this checks the spell, not sheep wandering
    evoker.x = 0.5; evoker.z = 0.5; // a wandering evoker could cross the wall (flaky)
    blue.x = 6.5; blue.z = 0.5; farBlue.x = 20.5; farBlue.z = 0.5; white.x = -5.5; white.z = 0.5;
    if (flippedAt < 0 && blue.woolColor === 'red') flippedAt = t;
  }
  M.Commands = saved;
  const r = { evoker, blue, white, farBlue, flippedAt };
  EL.clear();
  return r;
}
{
  ok(SP.WOLOLO_FROM === 'blue' && SP.WOLOLO_TO === 'red', 'DyeColor.field_7966 (blue) -> field_7964 (red), off DyeColor.java:22/25');
  const r = runWololo(true, 120);
  ok(!!r.evoker, 'a live evoker spawned');
  ok(r.blue.woolColor === 'red', `the blue sheep 6 blocks away turned RED (flipped at tick ${r.flippedAt})`);
  ok(r.flippedAt >= 39 && r.flippedAt <= 45, `it flipped after the 40-tick getInitialCooldown, not at once (tick ${r.flippedAt})`);
  ok(r.white.woolColor === 'white', 'a WHITE sheep is never a wololo target (the predicate is color == BLUE)');
  ok(r.farBlue.woolColor === 'blue', 'a blue sheep 20 blocks off is outside the 16-block base distance');
  const g = runWololo(false, 120);
  okAv(g.blue.woolColor === 'blue', 'anti-vacuity: mobGriefing=false, the same evoker leaves the blue sheep blue — the gamerule gate is read');
  const wl = runWololo(true, 120, true);
  ok(wl.blue.woolColor === 'blue' && !wl.evoker.wololoTarget, 'a blue sheep behind a solid wall is not a wololo target (TargetPredicate respects visibility)');
  const savedCs = M.Ai.canSee; M.Ai.canSee = () => true;
  const wl2 = runWololo(true, 120, true); M.Ai.canSee = savedCs;
  okAv(wl2.blue.woolColor === 'red', 'anti-vacuity: with canSee forced true the walled sheep is recoloured — the canSee test is what stops it');
  const savedFrom = SP.WOLOLO_FROM;
  SP.WOLOLO_FROM = 'green';
  const b = runWololo(true, 120);
  SP.WOLOLO_FROM = savedFrom;
  okAv(b.blue.woolColor === 'blue', 'anti-vacuity: with the source colour moved off blue nothing is recoloured — the predicate reads SP.WOLOLO_FROM');
}

// ═══ 8. KW-40 — illusioner's roster now carries a real BowAttackGoal, and fires a real arrow ═
console.log("\n 8. KW-40: a live illusioner's rostered BowAttackGoal fires a real 'arrow' at the player");
freshWorld();
plate(20);
{
  M.Player = mkPlayer({ x: 8, y: PLAT_Y + 1, z: 0 });
  const illusioner = EL.spawn('illusioner', 0, PLAT_Y + 1, 0);
  ok(!!illusioner, "EL.spawn('illusioner') returns a live entity");
  // vanilla: 20-tick draw + a real cooldown before the first shot (IllusionerEntity.java:67's
  // own `BowAttackGoal(0.5, 20, 15.0F)`) -- 150 ticks is comfortable headroom, the same margin
  // section 6's own vex wait already uses for a goal with a startTimeDelay.
  let shotAt = -1;
  for (let t = 0; t < 150 && shotAt < 0; t++) {
    EL.tick();
    if (EL.list.some((o) => o.type === 'arrow' && o.shooter === illusioner)) shotAt = t;
  }
  ok(shotAt >= 0, `the illusioner fired a real 'arrow' entity (shooter === illusioner) within 150 ticks (tick ${shotAt})`);
  EL.clear();
}
{
  // ANTI-VACUITY -- an illusioner with no reachable target never draws a bow at all (BowAttackGoal
  // .canStart() requires e.target); proves the 150-tick run above measured a real gate, not an
  // unconditional timer firing regardless of a target.
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 500, y: PLAT_Y + 1, z: 500 });   // far outside targeting range
  const illusioner = EL.spawn('illusioner', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 150; t++) EL.tick();
  okAv(!EL.list.some((o) => o.type === 'arrow'), 'with no reachable target, the same illusioner fires no arrow in 150 ticks — the gate is real');
  EL.clear();
}

// ═══ 9. KW-41 — SP.difficultyAboveEasy reads the REAL local difficulty, not the global level ═
console.log('\n 9. KW-41: SP.difficultyAboveEasy() gates on real local difficulty (> NORMAL.ordinal()=2), not the global difficulty level');
{
  Diff.set('normal');
  ok(Eq.localDifficulty() === 1.5, `sanity: a fresh 'normal' world's real local difficulty is 1.5 (Eq.localDifficulty() === ${Eq.localDifficulty()})`);
  ok(SP.difficultyAboveEasy() === false, "a fresh 'normal' world (local difficulty 1.5) is NOT harder than NORMAL (2) — SP.difficultyAboveEasy() is false, matching vanilla's isHarderThan");
  Diff.set('hard');
  ok(Eq.localDifficulty() === 2.25, `sanity: a fresh 'hard' world's real local difficulty is 2.25 (Eq.localDifficulty() === ${Eq.localDifficulty()})`);
  ok(SP.difficultyAboveEasy() === true, "a fresh 'hard' world (local difficulty 2.25) IS harder than NORMAL (2) — SP.difficultyAboveEasy() is true");
  Diff.set('peaceful');
  ok(SP.difficultyAboveEasy() === false, "'peaceful' (local difficulty 0) is never above NORMAL");
  Diff.set('normal');
  // ANTI-VACUITY -- force Eq.localDifficulty() to a fixed value and confirm the gate follows IT,
  // not the (now unrelated) global difficulty level -- proves the comparison really reads the
  // real regional number, not a re-derived copy of the old idx>1 collapse.
  const saved = Eq.localDifficulty;
  Eq.localDifficulty = () => 2.01;
  okAv(SP.difficultyAboveEasy() === true, "anti-vacuity: with Eq.localDifficulty() stubbed to 2.01 on 'normal', the gate flips true — it reads Eq.localDifficulty(), not NS.Diff.get()'s level index");
  Eq.localDifficulty = () => 2.0;
  okAv(SP.difficultyAboveEasy() === false, "anti-vacuity: stubbed to exactly 2.0, the gate is false — isHarderThan is a strict '>', not '>='");
  Eq.localDifficulty = saved;
}
{
  // The end-to-end regression: a live illusioner on a FRESH 'normal' world never blinds the
  // player at all (KW-41's own real-world symptom) — startTimeDelay (180) + spellTicks (20) fit
  // comfortably inside 400 ticks, the same budget section 5 uses on 'hard' to prove it DOES.
  freshWorld(); plate(20);
  Diff.set('normal');
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0 });
  EL.spawn('illusioner', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 400; t++) EL.tick();
  okAv(!ES.hasStatusEffect(M.Player, 'blindness'), "KW-41 regression: on a fresh 'normal' world (real local difficulty 1.5) a live illusioner never blinds the player in 400 ticks");
  EL.clear();
}

// ═══ #1122: fangsDamage box is expand(0.2, 0.0, 0.2) — no vertical growth ═══════════════
{
  const hits = (ty) => { let n = 0; const t = { x: 0, y: ty, z: 0, width: 0.6, height: 1.8, health: 20 };
    SP.fangsDamage({ x: 0, y: 10, z: 0, width: 0.5, height: 0.8 }, { entities: () => [t], hurt: () => { n++; } }); return n; };
  ok(hits(10.9) === 0, '#1122: target feet at fang.y+0.9 (inside the old +0.2 growth) is not hit');
  ok(hits(8.1) === 0, '#1122: target top at fang.y-0.1 is not hit');
  okAv(hits(10.5) === 1 && hits(9.0) === 1, '#1122: targets overlapping the 0.8-high box are still hit');
}

// ═══ #1981: fangs skip spectators ═══
{
  const hit = (extra) => { let n = 0; const t = Object.assign({ x: 0, y: 10, z: 0, width: 0.6, height: 1.8, health: 20 }, extra);
    SP.fangsDamage({ x: 0, y: 10, z: 0, width: 0.5, height: 0.8 }, { entities: () => [t], hurt: () => { n++; } }); return n; };
  ok(hit({ spectator: true }) === 0, '#1981: spectator target is not hit');
  okAv(hit({}) === 1, '#1981: ordinary target is still hit');
}

// ═══ #1121. fang damage is MAGIC (bypasses armour) and spares the owner's teammates ═══════
console.log('\n #1121. SP.fangsDamage: magic source, illagers/owned vexes spared');
freshWorld();
plate(20);
{
  const run = (teammateFn) => {
    const owner = EL.spawn('evoker', 0, PLAT_Y + 1, 0);
    const vind = EL.spawn('vindicator', 0.2, PLAT_Y + 1, 0);
    const vex = EL.spawn('vex', -0.2, PLAT_Y + 1, 0); vex.owner = owner;
    const zomb = EL.spawn('zombie', 0, PLAT_Y + 1, 0.2);
    const fang = { type: 'evoker_fangs', x: 0, y: PLAT_Y + 1, z: 0, width: 0.5, height: 0.8, owner };
    const seen = new Map();
    const ctx = { entities: () => [owner, vind, vex, zomb], hurt: (t, a, src) => { seen.set(t, src); return true; } };
    if (teammateFn) teammateFn();
    SP.fangsDamage(fang, ctx);
    return { seen, vind, vex, zomb, owner };
  };
  const r = run();
  ok(r.seen.has(r.zomb) && r.seen.get(r.zomb) && r.seen.get(r.zomb).source === 'magic' && r.seen.get(r.zomb).bypassArmor === true, 'a zombie is hit with a magic, armour-bypassing source');
  ok(!r.seen.has(r.vind) && !r.seen.has(r.vex) && !r.seen.has(r.owner), 'a vindicator, the owner\'s vex and the owner take nothing');
  const saved = SP.isTeammate; SP.isTeammate = () => false;
  const c = run();
  SP.isTeammate = saved;
  okAv(c.seen.has(c.vind) && c.seen.has(c.vex), 'with the teammate test cut out the vindicator and vex ARE hit');
  // real pipeline: EL.aiCtx.hurt passes the source to Cb.hurt, so armour does not reduce the 6
  const owner = EL.spawn('evoker', 5, PLAT_Y + 1, 5);
  M.Player = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 0, armorBonus: 0 });
  const ctx = EL.aiCtx(owner);
  let seenSrc = null; const Cb = M.Combat, orig = Cb.hurt;
  Cb.hurt = function (e, a, n, b, src) { seenSrc = src; return orig.apply(this, arguments); };
  ctx.hurt(M.Player, 6, { bypassArmor: true, source: 'magic' });
  Cb.hurt = orig;
  ok(seenSrc && seenSrc.source === 'magic', 'aiCtx.hurt forwards the damage source to Combat.hurt');
  okAv(!(function () { seenSrc = null; ctx.hurt(M.Player, 1); return seenSrc; })(), 'a sourceless ctx.hurt still forwards no source');
  EL.clear();
}

// ═══ 10. #2896 — illusioner mirror_move plays at fixed pitch 1.0 (IllusionerEntity.tickMovement) ═══
console.log('\n 10. #2896: mirror_move sound pitch is exactly 1.0');
{
  const illu = { type: 'illusioner', x: 0, y: 0, z: 0, hurtTime: 1, health: 20 };
  const mirrorPitch = () => {
    const seen = []; const origSound = M.Sound;
    M.Sound = { play: (ev, o) => { seen.push([ev, o.pitch]); return true; } };
    ES.addStatusEffect && ES.addStatusEffect(illu, 'invisibility', 100, 0);
    SP.tickMirror(illu);
    M.Sound = origSound;
    return seen.find((x) => x[0] === 'entity.illusioner.mirror_move');
  };
  const got = mirrorPitch();
  ok(got && got[1] === 1, `mirror_move pitch is exactly 1 (got ${got && got[1]})`);
  const orig = SP.evokerSound; SP.evokerSound = (e, ev) => orig(e, ev); // drop the fixedPitch arg
  const bad = mirrorPitch(); SP.evokerSound = orig;
  okAv(bad && bad[1] !== 1, 'with the fixed pitch dropped the check sees a random pitch');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity breaks proven (${breaks} breaks caught)` + (fails.length ? `, ${fails.length} FAILED` : ''));
if (fails.length) {
  console.log('\nFAILED:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
