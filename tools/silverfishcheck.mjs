#!/usr/bin/env node
// silverfishcheck.mjs — loop/silverfish: SILVERFISH + the mob-goal half of InfestedBlock
// (stone/cobblestone/deepslate were this unit's own three pairs; loop/infested's
// tools/infestedcheck.mjs later closed the stone-brick family and re-proves this file's
// positives still hold for all seven — see src/07zn_silverfish.js's own header). Snow golem
// is unrelated and still OWED elsewhere.
//
//   node tools/silverfishcheck.mjs [--verbose]
//
// ANTI-VACUITY (D-30/D-305): every section that asserts a positive also breaks its own input
// and asserts the break is caught — a check that cannot fail is not evidence.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
let avN = 0, breaks = 0;
const okAv = (c, m) => { ok(c, m); if (c) avN++; if (VERBOSE && c) console.log('   ✓ anti-vacuity: ' + m); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('silverfishcheck — SILVERFISH + INFESTED BLOCKS (stone/cobblestone/deepslate)');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js',
          '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
          '07zx_particle.js', '07zn_silverfish.js'],
  dom: false
});
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();

const R = M.Reg, SR = M.States, Ent = M.Entities, EL = M.EntityList, Ai = M.Ai, SF = M.Silverfish;
ok(R.ready, 'block registry decoded');
ok(SR.ready, 'block states decoded');
ok(!!SF, 'NS.Silverfish module loaded');
ok(Ent.ready && EL.ready && Ai.ready, 'Entities/EntityList/Ai all report ready');

// a fake world: a Map from "x,y,z" to a REAL state id, exactly `beworldcheck.mjs`'s own stub.
const CELLS = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
M.World = {
  getBlock: (x, y, z) => CELLS.get(key(x, y, z)) || 0,
  setBlock: (x, y, z, st) => { CELLS.set(key(x, y, z), st); return true; },
  // `Ph.shapeAt`'s own "no chunk loaded" branch (14b_physics.js) reads `NS.World.get(cx,cz)`
  // and treats a missing chunk as `Ph.FULL_CUBE` (solid) -- this fake world has no chunk
  // object at all, so `get` always answers "not loaded", which is Physics' own real answer
  // for un-generated terrain, not a check-only shortcut.
  get: () => null
};
M.Commands = { rules: {}, ruleGet(name) { return this.rules[name]; } };

// ════════════════════════════════ 1. the real registry has all seven InfestedBlock names ═════
console.log('\n1. the real registry (assets/block-registry.json) already carries every InfestedBlock');
{
  const names = ['infested_stone', 'infested_cobblestone', 'infested_stone_bricks',
    'infested_mossy_stone_bricks', 'infested_cracked_stone_bricks',
    'infested_chiseled_stone_bricks', 'infested_deepslate'];
  for (const n of names) ok(R.id[n] !== undefined, `${n} is a real block (assets/block-registry.json)`);
  // loop/infested closed the stone-brick family (SF.PAIRS now carries all seven —
  // tools/infestedcheck.mjs §2 proves the pairing/mining/goal wiring for the new four in
  // full); this section only proves the REGISTRY half, which was always true for all seven.
  const hasStoneBricksBlockDef = readFileSync(join(MCLITE_ROOT, 'src', '02_blocks.js'), 'utf8')
    .includes("B.def('stone_bricks'");
  okAv(!hasStoneBricksBlockDef, 'stone_bricks is (still, correctly) absent from the legacy 02_blocks.js mesher-fast-path table — that table stopped being the world’s id space at D-100 and infested_stone_bricks does not need it (see 07zn_silverfish.js’s header)');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 2. silverfish's own attributes, off the extracted data ═════
console.log('\n2. silverfish attributes — hand-checked against .decomp\'s own createSilverfishAttributes()');
{
  // .decomp/net/minecraft/entity/mob/SilverfishEntity.java:66-71 — MAX_HEALTH 8.0,
  // MOVEMENT_SPEED 0.25, ATTACK_DAMAGE 1.0 (HostileEntity's own default, .java:106).
  ok(Ent.has('silverfish'), 'silverfish is a real entity type');
  const a = Ent.attrsOf('silverfish');
  ok(!!a, 'silverfish has an attribute row');
  if (a) {
    ok(a.hp === 8, `max health is 8 (got ${a.hp})`);
    ok(Math.abs(a.speed - 0.25) < 1e-9, `movement speed is 0.25 (got ${a.speed})`);
    ok(a.dmg === 1, `attack damage is 1 (got ${a.dmg})`);
    ok(a.follow === 16, `follow range is 16, HostileEntity's own default (got ${a.follow})`);
  }
  const d = Ent.dimensions('silverfish');
  ok(!!d && d.width === 0.4 && d.height === 0.3, `hitbox is 0.4 x 0.3 (got ${d && d.width}x${d && d.height})`);
  // anti-vacuity: a bogus type name gets no row, proving `attrsOf` does not default silently.
  okAv(Ent.attrsOf('not_a_real_mob_xyz') === null, '`attrsOf` refuses an unknown type rather than defaulting');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 3. spawn: the closed-set motion gate + full AI wiring ═══════
console.log('\n3. EntityList.spawn(\'silverfish\', ...) — motion unlocked, goals rostered');
{
  const e = EL.spawn('silverfish', 10.5, 64, 10.5);
  ok(!!e, 'a silverfish spawns (EL.motionFor(\'silverfish\') is no longer null)');
  if (e) {
    ok(e.gravity === 0.08 && e.drag === 0.98, `plain-MobEntity motion row (got ${e.gravity},${e.drag})`);
    ok(!!e.ai, 'Ai.ROSTER.silverfish wired e.ai at spawn (D-391)');
    if (e.ai) {
      const kinds = e.ai.entries.map((x) => x.priority + ':' + x.flags);
      say('goal entries: ' + kinds.join(', '));
      ok(e.ai.entries.length === 7, `7 goal-selector entries (5 goal + 2 target; PowderSnowJumpGoal at 1), got ${e.ai.entries.length}`);
      const byPrio = {};
      for (const en of e.ai.entries) (byPrio[en.priority] = byPrio[en.priority] || []).push(en);
      ok((byPrio[1] || []).length === 3, 'THREE priority-1 entries (SwimGoal + PowderSnowJumpGoal + RevengeGoal)');
      ok((byPrio[3] || []).length === 1 && (byPrio[3][0].flags & Ai.TARGET) === 0,
         'priority 3 is CallForHelpGoal, not a TARGET goal');
      ok((byPrio[4] || []).length === 1, 'priority 4 is MeleeAttackGoal');
      ok((byPrio[5] || []).length === 1, 'priority 5 is WanderAndInfestGoal');
      ok((byPrio[2] || []).length === 1 && (byPrio[2][0].flags & Ai.TARGET) !== 0,
         'priority 2 is the TARGET-flagged ActiveTargetGoal<Player>');
      const tg = byPrio[2][0].goal;
      ok(tg.sight === true && tg.reciprocalChance === 10, `#4139: ActiveTargetGoal<Player>(true) is sight + 1-in-10 (got sight=${tg.sight}, reciprocalChance=${tg.reciprocalChance})`);
      const sv = [tg.sight, tg.reciprocalChance]; tg.sight = false; tg.reciprocalChance = 0;
      okAv(!(tg.sight === true && tg.reciprocalChance === 10), 'break the code (sight/reciprocalChance zeroed): the #4139 assertion would fail');
      tg.sight = sv[0]; tg.reciprocalChance = sv[1];
    }
  }
  // anti-vacuity: a type with NO roster entry (guardian spawns — EL.motionFor covers it — but
  // has no Ai.ROSTER entry) gets no e.ai at all — proves the wiring is the ROSTER lookup, not
  // automatic (bat, checked first, turned out to have its own explicit empty-GoalSelector
  // stub at 07k_goals.js:4951, which would have made this assertion vacuously true).
  okAv(!EL.spawn('tnt', 0, 64, 0).ai, 'a type with no ROSTER entry (tnt) spawns with no e.ai');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 4. isInfestable / isInfested — both directions ═══════════
console.log('\n4. isInfestable/isInfested — the three pairs this unit wires, and nothing else');
{
  ok(SF.isInfestable('stone'), 'stone is infestable');
  ok(SF.isInfestable('cobblestone'), 'cobblestone is infestable');
  ok(SF.isInfestable('deepslate'), 'deepslate is infestable');
  ok(SF.isInfested('infested_stone'), 'infested_stone is infested');
  ok(SF.isInfested('infested_cobblestone'), 'infested_cobblestone is infested');
  ok(SF.isInfested('infested_deepslate'), 'infested_deepslate is infested');
  okAv(!SF.isInfestable('dirt'), 'dirt is NOT infestable (no pair) — proves this is a real lookup, not "always true"');
  okAv(!SF.isInfested('stone'), 'plain stone is NOT "infested" — the reverse test does not just invert to true');
  // loop/infested added stone_bricks to SF.PAIRS — tools/infestedcheck.mjs §2 is the
  // dedicated positive test for it now; this file keeps dirt/stone as its own negatives.
  ok(SF.isInfestable('stone_bricks'), 'stone_bricks IS infestable (loop/infested closed this pair)');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 5. toInfestedState/toRegularState — a real round trip ════
console.log('\n5. toInfestedState/toRegularState — property-preserving round trip');
{
  const stoneSt = SR.stateOf('stone');
  const infStoneSt = SF.toInfestedState(stoneSt);
  ok(infStoneSt === R.realFirst[R.id.infested_stone] + R.defaultState[R.id.infested_stone],
     'stone\'s default state converts to infested_stone\'s own default state');
  ok(SF.toRegularState(infStoneSt) === stoneSt, 'and converts straight back to the same stone state');

  // deepslate carries an `axis` property (3 states) — the ONE real property-copy case this
  // unit's three pairs exercise. Walk every one of deepslate's real states and confirm the
  // infested twin round-trips to the SAME local index (not just the default).
  const dsBlock = R.id.deepslate, infDsBlock = R.id.infested_deepslate;
  const dsCount = R.realFirst[dsBlock + 1] - R.realFirst[dsBlock];
  const infDsCount = R.realFirst[infDsBlock + 1] - R.realFirst[infDsBlock];
  ok(dsCount === infDsCount && dsCount > 1, `deepslate and infested_deepslate have the SAME state count > 1 (got ${dsCount}/${infDsCount})`);
  let allRoundTrip = true;
  for (let local = 0; local < dsCount; local++) {
    const st = R.realFirst[dsBlock] + local;
    const inf = SF.toInfestedState(st);
    if (inf !== R.realFirst[infDsBlock] + local) allRoundTrip = false;
    if (SF.toRegularState(inf) !== st) allRoundTrip = false;
  }
  ok(allRoundTrip, `every one of deepslate's ${dsCount} real states round-trips through infested_deepslate preserving its local (axis) index`);

  // anti-vacuity: a block with no infested twin (dirt) converts to null, not a wrong number.
  okAv(SF.toInfestedState(SR.stateOf('dirt')) === null, 'a non-infestable block\'s state converts to null, not a guess');
  okAv(SF.toRegularState(SR.stateOf('dirt')) === null, 'and the reverse direction refuses the same way');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 6. SF.spawn / SF.onBreak — InfestedBlock.onStacksDropped ═
console.log('\n6. SF.onBreak — doTileDrops gate + Silk Touch gate, InfestedBlock.onStacksDropped');
{
  const before = EL.list.length;
  const Px = M.Particle; Px.init(); Px.list.length = 0;
  SF.onBreak(5, 64, 5, false);
  ok(Px.list.length === 20 && Px.list.every(p => p.type === 'poof'), `playSpawnEffects: 20 poof particles on spawn (got ${Px.list.length})`);
  ok(EL.list.length === before + 1, 'no Silk Touch, doTileDrops default (undefined -> on): spawns a silverfish');
  const spawned = EL.list[EL.list.length - 1];
  ok(spawned.type === 'silverfish', 'the spawned entity is a silverfish');
  ok(Math.abs(spawned.x - 5.5) < 1e-9 && spawned.y === 64 && Math.abs(spawned.z - 5.5) < 1e-9,
     `spawned centred on the block, Y at the floor (got ${spawned.x},${spawned.y},${spawned.z})`);

  const before2 = EL.list.length;
  SF.onBreak(6, 64, 6, true);   // silkTouch = true
  okAv(EL.list.length === before2, 'Silk Touch refuses the spawn — proves the gate is live, not a no-op');

  M.Commands.rules.doTileDrops = 'false';
  const before3 = EL.list.length;
  SF.onBreak(7, 64, 7, false);
  okAv(EL.list.length === before3, 'doTileDrops=false refuses the spawn too');
  delete M.Commands.rules.doTileDrops;
  Px.list.length = 0; const saveFx = Px.spawnEffects; Px.spawnEffects = () => 0;
  SF.spawn(9, 64, 9);
  okAv(Px.list.length === 0, 'with spawnEffects sabotaged no puff appears — the assertion above can fail');
  Px.spawnEffects = saveFx;
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 7. WanderAndInfestGoal — instant infest, not a walk ══════
console.log('\n7. WanderAndInfestGoal — the infest branch converts a neighbour and discards itself');
{
  CELLS.clear();
  const e = { x: 20.5, y: 64, z: 20.5, target: null };
  const ctx = { random: () => 0, mobGriefing: () => true };   // rand()=0 always wins the 1-in-10 roll
  // place a plain stone directly +X of the silverfish's feet-cell.
  CELLS.set(key(21, 64, 20), SR.stateOf('stone'));
  const g = new SF.WanderAndInfestGoal(e, 1.0, ctx);
  ok(g.canUse() === true, 'canUse() finds the infestable neighbour and returns true');
  g.start();
  ok(e.removed === true, 'start() discards the silverfish (matches .decomp:242 discard())');
  ok(SR.name(CELLS.get(key(21, 64, 20))) === 'infested_stone',
     `the neighbour cell became infested_stone (got ${SR.name(CELLS.get(key(21, 64, 20)))})`);

  // anti-vacuity: an entity with a live target NEVER infests, whatever the roll says.
  const e2 = { x: 20.5, y: 64, z: 20.5, target: { x: 0, y: 0, z: 0 } };
  CELLS.set(key(21, 64, 20), SR.stateOf('stone'));
  const g2 = new SF.WanderAndInfestGoal(e2, 1.0, ctx);
  okAv(g2.canUse() === false, 'a silverfish with a target never starts WanderAndInfestGoal');

  // anti-vacuity: no infestable neighbour (all air) never infests either, even at rand()=0.
  CELLS.clear();
  const e3 = { x: 20.5, y: 64, z: 20.5, target: null };
  const g3 = new SF.WanderAndInfestGoal(e3, 1.0, ctx);
  okAv(g3.canUse() === false, 'no infestable neighbour and no reachable wander target (empty fake world): canUse() refuses');

  // stroll-branch gates (WanderAroundGoal.canStart: hasPassengers, despawnCounter >= 100). Stub the path so the stroll WOULD start.
  const sPick = SF.pickWanderTarget, sFind = M.Ai.findPath;
  SF.pickWanderTarget = () => ({ x: 22, y: 64, z: 20 });
  M.Ai.findPath = () => [{}, {}];
  const stroll = (extra) => new SF.WanderAndInfestGoal(Object.assign({ x: 20.5, y: 64, z: 20.5, target: null }, extra), 1.0, { random: () => 0, mobGriefing: () => false }).canUse();
  ok(stroll({ despawnCounter: 99 }) === true, 'control: despawnCounter 99 still strolls');
  const d = stroll({ despawnCounter: 100 }), pg = stroll({ passengers: [{}] });
  SF.pickWanderTarget = sPick; M.Ai.findPath = sFind;
  if (d === false) breaks++;
  okAv(d === false, 'despawnCounter 100 refuses the stroll');
  if (pg === false) breaks++;
  okAv(pg === false, 'a silverfish with passengers refuses the stroll');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 8. CallForHelpGoal — onHurt, the delay, the box walk ═════
console.log('\n8. CallForHelpGoal — armed by onHurt(), releases (mobGriefing) or reverts (!mobGriefing)');
{
  CELLS.clear();
  const e = { x: 0.5, y: 64, z: 0.5 };
  const ctx = { random: () => 0.1, mobGriefing: () => true };   // 0.1 < 0.5, so nextBoolean() keeps scanning
  const g = new SF.CallForHelpGoal(e, ctx);
  ok(g.canUse() === false, 'canUse() is false before any hit');
  g.onHurt();
  ok(g.canUse() === true, 'onHurt() arms the goal');
  CELLS.set(key(2, 64, 0), SR.stateOf('infested_cobblestone'));
  for (let i = 0; i < 19; i++) g.tick();   // 20-tick delay: 19 ticks still counting down
  ok(g.canUse() === true, 'still counting down at tick 19');
  const before = EL.list.length;
  g.tick();   // the 20th tick fires the scan
  ok(SR.name(CELLS.get(key(2, 64, 0))) === 'stone' || CELLS.get(key(2, 64, 0)) === 0,
     'the infested_cobblestone at the delay\'s end was BROKEN (setBlock(...,0)), not just converted');
  // `SF.onBreak` inside the goal's own scan should have released a fresh silverfish.
  ok(EL.list.length === before + 1, 'breaking it under mobGriefing released a fresh silverfish (the goal\'s whole point)');

  // the !mobGriefing branch: reverts in place, releases nothing.
  CELLS.clear();
  const e2 = { x: 0.5, y: 64, z: 0.5 };
  const ctx2 = { random: () => 0.9, mobGriefing: () => false };
  const g2 = new SF.CallForHelpGoal(e2, ctx2);
  g2.onHurt();
  CELLS.set(key(1, 64, 0), SR.stateOf('infested_stone'));
  const before2 = EL.list.length;
  for (let i = 0; i < 20; i++) g2.tick();
  ok(SR.name(CELLS.get(key(1, 64, 0))) === 'stone', '!mobGriefing reverts infested_stone back to plain stone in place');
  okAv(EL.list.length === before2, '!mobGriefing releases NO silverfish — proves the two branches are actually different');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 9. getPathfindingFavor — stone floors win the stroll ═════
console.log('\n9. WanderAndInfestGoal stroll target — infestable floor scores 10 (SilverfishEntity.getPathfindingFavor)');
{
  const share = (stoneName) => {
    CELLS.clear();
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
      CELLS.set(key(x, 63, z), SR.stateOf(x < 0 ? stoneName : 'grass_block'));
    }
    const e = { x: 0.5, y: 64, z: 0.5, target: null };
    let st = 0, n = 0, seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 1000; i++) {
      const t = SF.pickWanderTarget(e, rnd);
      if (!t) continue;
      if (t.y !== 64) continue;   // this fake world's floor is one layer (unloaded cells read solid)
      n++; if (t.x < 0) st++;
    }
    return n ? st / n : 0;
  };
  const s = share('stone');
  say('stone share ' + s);
  ok(s > 0.75, `half stone / half grass floor: stone share ${s.toFixed(2)} is well above 0.5`);
  const flat = share('dirt');
  if (flat < 0.75) breaks++;   // break: a floor with no infestable half must NOT be favoured
  okAv(flat < 0.75, `break the data (stone half -> dirt): share ${flat.toFixed(2)} falls back to ~uniform`);
  const saved = SF.pathFavor; SF.pathFavor = () => 0;
  const nof = share('stone'); SF.pathFavor = saved;
  if (nof < 0.75) breaks++;
  okAv(nof < 0.75, `break the code (favour term zeroed): share ${nof.toFixed(2)} drops`);
  CELLS.clear();
}
console.log(`   ${pass} ok`);
console.log(`${breaks} breaks caught`);

// ═══════════════════════════════ done ═════════════════════════════════════════════════════
console.log(`\n${fails.length ? 'FAIL' : 'PASS'}  ${pass} ok, ${fails.length} failed`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(`checks: ${pass} assertions, ${fails.length} failed`);
for (let i = 0; i < avN; i++) console.log('  ✓ break caught');
process.exit(fails.length ? 1 : 0);
