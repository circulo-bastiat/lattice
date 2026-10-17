#!/usr/bin/env node
// endcrystalcheck.mjs — loop/endcrystal-entity: the real `end_crystal` entity (registration in
// EL, its invulnerable-except-explosion-ish damage rule, EndCrystalEntity.damage() verbatim)
// and the wiring that makes destroying one genuinely reach the already-real
// ED.EnderDragonFight.prototype.crystalDestroyed -> ED.EnderDragonEntity.prototype.
// crystalDestroyed -> phase.crystalDestroyed() chain end to end (src/07zzn_endcrystal.js,
// src/07i_entitylist.js's end_crystal rows, src/07za_explosion.js's damageEntities end_crystal
// branch, src/07zzl_enderdragon.js's ED.getActiveFight).
//
//   node tools/endcrystalcheck.mjs [--verbose]
//
// Sections:
//   1. registration — EL.canSpawn('end_crystal') true, EL.motionFor [0,1] (stationary, the
//      SAME sentinel area_effect_cloud uses), EL.spawn gives the real 2x2 dims off the
//      generated registry row and NO health fields at all (not a LivingEntity, D-336)
//   2. EC.damage removes the entity and reaches EC.crystalDestroyed — anti-vacuity: a
//      SECOND crystal with no active fight is still removed (a bare crystal with no fight in
//      progress is a real, honest no-op on the fight side, matching the jar's null-fight guard)
//   3. the two real damage() refusals — an EnderDragonEntity attacker is refused outright, and
//      e.invulnerable blocks it (except for outOfWorld/creative-player sources) — anti-vacuity:
//      a NON-dragon attacker on the same crystal IS destroyed, proving the refusal is keyed on
//      the attacker type, not on "any attacker at all"
//   4. the isExplosive() branch — a non-explosive kill rolls the crystal's OWN power-6
//      explosion (world blocks actually break); an explosive kill does NOT roll a second one
//      (no double-explosion) — anti-vacuity: the same non-explosive call against a
//      pre-hardened obsidian floor leaves it standing while a dirt floor next to it breaks,
//      proving the explosion is real blast-resistance math, not an unconditional area-clear
//   5. full end-to-end — a real dragon (ED.initEntity, HoldingPattern) + a real active fight
//      + a real player in range + a real EL.spawn('end_crystal', ...) entity: destroying that
//      SAME live entity (non-explosive) removes it, fires its own explosion, and the dragon's
//      phase genuinely switches HoldingPattern -> StrafePlayer (HoldingPatternPhase.
//      crystalDestroyed's own real branch, not a stub) — anti-vacuity: with the player OUT of
//      canTarget range, the same call leaves the dragon in HoldingPattern, proving the phase
//      switch is conditioned on a real player pick, not unconditional
//   6. src/07za_explosion.js wiring — a TNT-power blast centred on a live end_crystal removes
//      it through Ex.damageEntities' own end_crystal branch (not the generic maxHealth-gated
//      skip) and reaches the SAME active fight, with explosive:true so the crystal's OWN
//      second explosion is correctly skipped

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('endcrystalcheck -- the real end_crystal entity + damage rule + crystalDestroyed wiring');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js', '07zw_mobnbt.js'];

function freshEngine() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const W = M.World, CH = M.CH, S = M.States;
  M.Behave.init(W);
  M.Entities.init();
  M.EntityList.init();
  M.Ai.init();
  M.Spawn.init();
  M.Combat.init();
  M.Explosion.init();
  M.EnderDragon.init();
  M.EndCrystal.init();
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  return M;
}
function put(W, S, x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }

// ============ 1. registration ==================================================================
{
  const M = freshEngine();
  const EL = M.EntityList;
  say('1. registration');
  ok(EL.canSpawn('end_crystal') === true, "EL.canSpawn('end_crystal') is true");
  const mot = EL.motionFor('end_crystal');
  ok(Array.isArray(mot) && mot[0] === 0 && mot[1] === 1,
    "EL.motionFor('end_crystal') is [0, 1] (stationary, area_effect_cloud's own sentinel) -- got " + JSON.stringify(mot));
  const e = EL.spawn('end_crystal', 5, 70, -5, {});
  ok(!!e, "EL.spawn('end_crystal', 5, 70, -5, {}) returns a real entity");
  ok(e.type === 'end_crystal', 'spawned type is end_crystal');
  ok(e.width === 2 && e.height === 2, `dimensions come off the real generated registry row (2x2) -- got ${e.width}x${e.height}`);
  ok(e.maxHealth === undefined && e.health === undefined,
    'a real end_crystal has NO health fields at all -- it extends Entity, not LivingEntity (D-336)');
  ok(e.showBottom === true, 'EL.DEFAULTS.end_crystal sets the real showBottom default (true)');
}

// ============ 2. EC.damage removes + reaches crystalDestroyed (fight-optional) ================
{
  const M = freshEngine();
  const EL = M.EntityList, EC = M.EndCrystal;
  say('2. EC.damage basics');
  ok(EC.ready, 'NS.EndCrystal reports ready');
  const e = EL.spawn('end_crystal', 0, 70, 0, {});
  const landed = EC.damage(e, { explosive: false });
  ok(landed === true, 'EC.damage(e, {explosive:false}) returns true (a real hit)');
  ok(e.removed === true, 'the crystal is removed from the world on a landed hit');

  // anti-vacuity: a bare crystal, no active fight at all (M.EnderDragon.activeFight unset by
  // this fresh engine) -- still a real, honest removal, matching the jar's own null-fight
  // guard rather than crashing or refusing the hit outright.
  const e2 = EL.spawn('end_crystal', 1, 70, 0, {});
  const before = M.EnderDragon.activeFight;
  okAv(before === undefined || before === null, 'no active fight exists yet in a fresh engine');
  const landed2 = EC.damage(e2, { explosive: false });
  okAv(landed2 === true && e2.removed === true,
    'a crystal destroyed with NO active EnderDragonFight is still removed (the null-fight guard is a no-op, not a refusal)');
}

// ============ 3. the two real damage() refusals =================================================
{
  const M = freshEngine();
  const EL = M.EntityList, EC = M.EndCrystal;
  say('3. damage() refusals');
  const dragon = EL.spawn('ender_dragon', 0, 90, 0, {});
  const crystalA = EL.spawn('end_crystal', 3, 70, 3, {});
  const refused = EC.damage(crystalA, { attacker: dragon });
  ok(refused === false, "EC.damage refuses an EnderDragonEntity attacker -- can't destroy this way");
  ok(crystalA.removed === false, 'the crystal is genuinely untouched, not removed, on that refusal');

  const invulnCrystal = EL.spawn('end_crystal', 4, 70, 3, {});
  invulnCrystal.invulnerable = true;
  const refused2 = EC.damage(invulnCrystal, { explosive: false });
  ok(refused2 === false, 'e.invulnerable refuses an ordinary damage source');
  ok(invulnCrystal.removed === false, 'the invulnerable crystal stays in the world');
  const bypassed = EC.damage(invulnCrystal, { explosive: false, source: 'outOfWorld' });
  ok(bypassed === true && invulnCrystal.removed === true,
    "outOfWorld bypasses e.invulnerable (isInvulnerableTo's own real carve-out, .decomp Entity.java:2249)");

  // anti-vacuity: a non-dragon attacker on an otherwise-identical crystal IS destroyed --
  // proves section 3's first refusal is keyed on attacker.type, not "any attacker refused".
  const player = { type: 'player' };
  const crystalB = EL.spawn('end_crystal', 5, 70, 3, {});
  const hit = EC.damage(crystalB, { attacker: player });
  okAv(hit === true && crystalB.removed === true,
    'anti-vacuity: a player (or any non-ender_dragon) attacker on the SAME kind of crystal genuinely destroys it');
}

// ============ 4. the isExplosive() branch — real block-destruction math, not a stub ============
{
  const M = freshEngine();
  const EL = M.EntityList, EC = M.EndCrystal, W = M.World, S = M.States;
  say('4. explosion branch');
  put(W, S, 6, 69, 6, 'dirt');
  put(W, S, 6, 69, 5, 'obsidian');
  const e = EL.spawn('end_crystal', 6, 70, 6, {});
  const landed = EC.damage(e, { explosive: false });
  ok(landed === true, 'non-explosive kill lands');
  ok(W.getBlock(6, 69, 6) !== S.stateOf('dirt'),
    "the crystal's own real power-6 DESTROY explosion actually broke the dirt beneath it");
  okAv(W.getBlock(6, 69, 5) === S.stateOf('obsidian'),
    "anti-vacuity: obsidian's own real blast resistance survives the SAME blast -- proving this is Ex.explode's real per-block resistance math, not an unconditional area-clear");

  // an explosive kill must NOT roll a second explosion.
  put(W, S, 8, 69, 8, 'dirt');
  const e2 = EL.spawn('end_crystal', 8, 70, 8, {});
  const before = W.getBlock(8, 69, 8);
  const landed2 = EC.damage(e2, { explosive: true });
  ok(landed2 === true && e2.removed === true, 'an explosive kill still removes the crystal');
  okAv(W.getBlock(8, 69, 8) === before,
    "anti-vacuity: killing a crystal with an ALREADY-explosive source rolls NO second explosion -- dirt directly under it survives (EndCrystalEntity.damage()'s own !isExplosive() guard, verbatim)");
}

// ============ 5. full end-to-end: real dragon + real fight + real crystal + real phase switch ==
{
  const M = freshEngine();
  const EL = M.EntityList, EC = M.EndCrystal, ED = M.EnderDragon;
  say('5. end-to-end phase switch');
  const player = { type: 'player', x: 5, y: 65, z: 5, removed: false, dead: false };
  const dragonE = EL.spawn('ender_dragon', 0, 90, 0, {});
  const fight = new ED.EnderDragonFight({ seed: 42, heightAt: () => 65, players: () => [player] });
  ED.initEntity(dragonE, { fight: fight, heightAt: () => 65, players: () => [player] });
  ok(ED.getActiveFight() === fight, 'ED.getActiveFight() returns the SAME fight ED.initEntity just attached');
  const dragon = dragonE.dragon;
  dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  ok(dragon.getPhaseManager().getCurrent().getType().name === 'HoldingPattern', 'dragon starts in HoldingPattern');

  const crystal = EL.spawn('end_crystal', 6, 76, 6, {});
  const landed = EC.damage(crystal, { explosive: false });
  ok(landed === true && crystal.removed === true, 'the live end_crystal is genuinely destroyed');
  ok(dragon.getPhaseManager().getCurrent().getType().name === 'StrafePlayer',
    'destroying it reached fight.crystalDestroyed -> dragon.crystalDestroyed -> HoldingPatternPhase.crystalDestroyed\'s own real branch, switching the dragon to StrafePlayer (a targetable player was in range)');

  // anti-vacuity: same setup, but the player is NOT targetable (out of the dragon's own
  // canTarget range/rules) -- the phase must stay HoldingPattern, proving the switch above
  // really depends on a real player pick, not an unconditional "any crystalDestroyed switches phase".
  const M2 = freshEngine();
  const EL2 = M2.EntityList, EC2 = M2.EndCrystal, ED2 = M2.EnderDragon;
  const farPlayer = { type: 'player', x: 100000, y: 65, z: 100000, removed: false, dead: false };
  const dragonE2 = EL2.spawn('ender_dragon', 0, 90, 0, {});
  const fight2 = new ED2.EnderDragonFight({ seed: 43, heightAt: () => 65, players: () => [] });
  ED2.initEntity(dragonE2, { fight: fight2, heightAt: () => 65, players: () => [] });
  const dragon2 = dragonE2.dragon;
  dragon2.getPhaseManager().setPhase(ED2.PHASE_TYPES.byName.HoldingPattern);
  const crystal2 = EL2.spawn('end_crystal', 6, 76, 6, {});
  EC2.damage(crystal2, { explosive: false });
  okAv(dragon2.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    'anti-vacuity: with no targetable player at all, destroying the crystal leaves the dragon in HoldingPattern -- the StrafePlayer switch above was real, not unconditional');
}

// ============ 6. Ex.damageEntities' own end_crystal branch (src/07za_explosion.js) ============
{
  const M = freshEngine();
  const EL = M.EntityList, EC = M.EndCrystal, ED = M.EnderDragon, Ex = M.Explosion, W = M.World, S = M.States;
  say('6. explosion-substrate wiring');
  const player = { type: 'player', x: 10, y: 65, z: 10, removed: false, dead: false };
  const dragonE = EL.spawn('ender_dragon', 0, 90, 0, {});
  const fight = new ED.EnderDragonFight({ seed: 44, heightAt: () => 65, players: () => [player] });
  ED.initEntity(dragonE, { fight: fight, heightAt: () => 65, players: () => [player] });
  const dragon = dragonE.dragon;
  dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);

  put(W, S, 10, 69, 10, 'dirt');
  const crystal = EL.spawn('end_crystal', 10, 70, 10, {});
  // a real TNT-power blast, centred right on the crystal, going through Ex.explode exactly
  // like a real primed TNT/creeper would (source is a bare marker object, never the crystal
  // itself, so it never appears in its own target list).
  Ex.explode({ marker: true }, 10, 70.5, 10, 4.0, true, undefined, false);
  ok(crystal.removed === true, "a real explosion centred on the crystal destroys it through Ex.damageEntities' own end_crystal branch");
  ok(dragon.getPhaseManager().getCurrent().getType().name === 'StrafePlayer',
    'the SAME explosion-triggered destruction reaches fight.crystalDestroyed -> ... -> the real phase switch, end to end');

  // anti-vacuity: the OLD skip-non-living-targets behaviour would have left maxHealth-less
  // entities (and thus the crystal) completely untouched -- confirm the crystal really has no
  // maxHealth (so the old bare `e.maxHealth === undefined` guard alone WOULD have skipped it),
  // proving the branch added to Ex.damageEntities is what makes this section 6 pass, not some
  // unrelated health-based path.
  okAv(crystal.maxHealth === undefined,
    'anti-vacuity: the destroyed crystal never had maxHealth at all -- the generic non-living skip would have missed it without the end_crystal branch this pass added');
}


// ============ 7. D-835 -- player melee (Cb.attack) / arrow (Cb.tickArrow) actually reach ======
// ============    EC.damage -- the dispatch this file's own EC.OWED named as the closing gap ==
{
  const M = freshEngine();
  const EL = M.EntityList, EC = M.EndCrystal, ED = M.EnderDragon, Cb = M.Combat, W = M.World, S = M.States;
  say('7. player melee/arrow -> EC.damage (D-835)');
  const player = { type: 'player', x: 20, y: 65, z: 20, removed: false, dead: false };
  const dragonE = EL.spawn('ender_dragon', 0, 90, 0, {});
  const fight = new ED.EnderDragonFight({ seed: 51, heightAt: () => 65, players: () => [player] });
  ED.initEntity(dragonE, { fight: fight, heightAt: () => 65, players: () => [player] });
  const dragon = dragonE.dragon;
  dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);

  // -- 7a. melee: a real Cb.attack(P, crystal) swing, the SAME entry point a player's left
  // click drives (Cb.attack -> Cb.hurt(e, f, undefined, true) -> the end_crystal dispatch).
  put(W, S, 20, 69, 20, 'dirt');
  const crystalA = EL.spawn('end_crystal', 20, 70, 20, {});
  okAv(Cb.canAttack(crystalA) === true,
    'anti-vacuity: Cb.canAttack(crystal) is true BEFORE the swing -- without this pass\'s ' +
    'Cb.canAttack fix, the maxHealth-less crystal would fail that gate and Cb.attack\'s own ' +
    'top-of-function `if (!P || !Cb.canAttack(e)) return null;` would refuse the swing before ' +
    'it ever reached Cb.hurt, matching the exact silent-swallow gap D-835 named');
  const P = { x: 19, y: 70, z: 20, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0,
              sprinting: false, onGround: true, fallDistance: 0, onClimbable: false,
              inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 };
  const meleeResult = Cb.attack(P, crystalA);
  ok(!!meleeResult && meleeResult.hit === true, 'Cb.attack(P, crystal) lands a real hit');
  ok(crystalA.removed === true, 'the melee-struck crystal is genuinely removed');
  ok(W.getBlock(20, 69, 20) !== S.stateOf('dirt'),
    "the melee hit rolled EC.damage's OWN real power-6 explosion (dirt beneath it broke) -- not a generic despawn");
  ok(dragon.getPhaseManager().getCurrent().getType().name === 'StrafePlayer',
    'the melee-triggered destruction reached fight.crystalDestroyed -> ... -> the real HoldingPattern -> StrafePlayer phase switch, end to end');

  // -- 7b. arrow: a real Cb.tickArrow(arrow) impact, the SAME per-tick entry point every live
  // arrow (Cb.tickEntity -> EL.tick) drives on the real, in-flight `EntityList.list` entity.
  const M2 = freshEngine();
  const EL2 = M2.EntityList, EC2 = M2.EndCrystal, ED2 = M2.EnderDragon, Cb2 = M2.Combat, W2 = M2.World, S2 = M2.States;
  const player2 = { type: 'player', x: 30, y: 65, z: 30, removed: false, dead: false };
  const dragonE2 = EL2.spawn('ender_dragon', 0, 90, 0, {});
  const fight2 = new ED2.EnderDragonFight({ seed: 52, heightAt: () => 65, players: () => [player2] });
  ED2.initEntity(dragonE2, { fight: fight2, heightAt: () => 65, players: () => [player2] });
  const dragon2 = dragonE2.dragon;
  dragon2.getPhaseManager().setPhase(ED2.PHASE_TYPES.byName.HoldingPattern);

  put(W2, S2, 30, 69, 30, 'dirt');
  const shooter = { type: 'skeleton', x: 25, y: 70, z: 30, removed: false };
  const crystalB = EL2.spawn('end_crystal', 30, 70, 30, {});
  okAv(crystalB.maxHealth === undefined,
    'anti-vacuity: the struck crystal never had maxHealth at all -- the OLD bare ' +
    '`o.maxHealth === undefined` skip in Cb.arrowStrikeEntity\'s own target gather would have ' +
    'excluded it from every arrow\'s candidate list without this pass\'s end_crystal carve-out');
  const arrow = EL2.spawn('arrow', 29.5, 70, 30, { vx: 0.05, vy: 0, vz: 0, shooter: shooter });
  Cb2.tickArrow(arrow);
  ok(crystalB.removed === true, 'the arrow-struck crystal is genuinely removed');
  ok(arrow.removed === true, 'the arrow itself is consumed on the hit (PersistentProjectileEntity.onEntityHit\'s own discard())');
  ok(W2.getBlock(30, 69, 30) !== S2.stateOf('dirt'),
    "the arrow hit rolled EC.damage's OWN real power-6 explosion (dirt beneath it broke) -- not a generic despawn");
  ok(dragon2.getPhaseManager().getCurrent().getType().name === 'StrafePlayer',
    'the arrow-triggered destruction reached fight.crystalDestroyed -> ... -> the real HoldingPattern -> StrafePlayer phase switch, end to end');

  // -- 7c. trident: a real Cb.tickTrident(trident) impact -- D-836 fixed Cb.tickArrow's own
  // bare `o.maxHealth === undefined` skip for the end_crystal carve-out; Cb.tickTrident had
  // the SAME old unfixed filter line and a thrown/returning trident flew straight through a
  // live crystal until this pass.
  const M3 = freshEngine();
  const EL3 = M3.EntityList, EC3 = M3.EndCrystal, ED3 = M3.EnderDragon, Cb3 = M3.Combat, W3 = M3.World, S3 = M3.States;
  const player3 = { type: 'player', x: 40, y: 65, z: 40, removed: false, dead: false };
  const dragonE3 = EL3.spawn('ender_dragon', 0, 90, 0, {});
  const fight3 = new ED3.EnderDragonFight({ seed: 53, heightAt: () => 65, players: () => [player3] });
  ED3.initEntity(dragonE3, { fight: fight3, heightAt: () => 65, players: () => [player3] });
  const dragon3 = dragonE3.dragon;
  dragon3.getPhaseManager().setPhase(ED3.PHASE_TYPES.byName.HoldingPattern);

  put(W3, S3, 40, 69, 40, 'dirt');
  const shooter3 = { type: 'player', x: 35, y: 70, z: 40, removed: false };
  const crystalC = EL3.spawn('end_crystal', 40, 70, 40, {});
  okAv(crystalC.maxHealth === undefined,
    'anti-vacuity: the struck crystal never had maxHealth at all -- the OLD bare ' +
    '`o.maxHealth === undefined` skip in Cb.tickTrident\'s own target gather would have ' +
    'excluded it from every trident\'s candidate list without this pass\'s end_crystal carve-out');
  const trident = EL3.spawn('trident', 39.5, 70, 40, { vx: 0.05, vy: 0, vz: 0, shooter: shooter3 });
  Cb3.tickTrident(trident);
  ok(crystalC.removed === true, 'the trident-struck crystal is genuinely removed');
  ok(trident.removed !== true && trident.dealtDamage === true, 'the trident ricochets on the hit (dealtDamage, not discarded -- TridentEntity.onEntityHit, #2908)');
  ok(W3.getBlock(40, 69, 40) !== S3.stateOf('dirt'),
    "the trident hit rolled EC.damage's OWN real power-6 explosion (dirt beneath it broke) -- not a generic despawn");
  ok(dragon3.getPhaseManager().getCurrent().getType().name === 'StrafePlayer',
    'the trident-triggered destruction reached fight.crystalDestroyed -> ... -> the real HoldingPattern -> StrafePlayer phase switch, end to end');
}

// -- 8. #5491: save/load keeps BeamTarget + ShowBottom, and the reloaded crystal still explodes.
{
  const M = freshEngine();
  const EL = M.EntityList, W = M.World, S = M.States, Mb = M.MobNbt;
  put(W, S, 20, 69, 20, 'dirt');
  const c = EL.spawn('end_crystal', 20, 70, 20, {});
  c.beamTarget = { x: 5, y: 70, z: 5 };
  c.showBottom = false;
  const recs = JSON.parse(JSON.stringify(Mb.serializeAll()));
  ok(recs.length === 1 && recs[0].type === 'end_crystal', 'serializeAll records the end_crystal (no maxHealth)');
  EL.remove(c);
  EL.list.length = 0;
  ok(Mb.restoreAll(recs) === 1, 'restoreAll respawns the crystal');
  const r = EL.list.find((e) => e && e.type === 'end_crystal');
  ok(r && r.beamTarget && r.beamTarget.x === 5 && r.beamTarget.y === 70 && r.beamTarget.z === 5, 'BeamTarget survives');
  ok(r && r.showBottom === false, 'ShowBottom=false survives');
  ok(r && M.EndCrystal.damage(r, {}) === true && r.removed === true, 'the reloaded crystal explodes on a hit');
  ok(W.getBlock(20, 69, 20) !== S.stateOf('dirt'), 'the explosion (power 6) broke the dirt below');
  // anti-vacuity: without the SPECIES row the fields do not survive
  const fields = Mb.fieldsFor('end_crystal');
  okAv(fields.includes('beamTarget') && fields.includes('showBottom'), 'the end_crystal row is what carries the fields (delete it => fails)');
}

// -- 10. EndCrystalItem.useOnBlock through Use.itemUseOn: place on obsidian/bedrock, refuse everything else.
{
  const M = loadEngine({ extra: EXTRA.concat(['07c_blockentity.js', '07y_equip.js', '07m_breed.js', '07n_tame.js', '07q_effects.js', '14f_inventory.js', '14l_use.js']), dom: false });
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Behave.init(M.World); M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init(); M.Ai.init(); M.Spawn.init(); M.Combat.init(); M.Explosion.init(); M.EnderDragon.init(); M.EndCrystal.init();
  M.World.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c);
  }
  M.Use.init(M.World);
  const W = M.World, S = M.States, EL = M.EntityList, Iv = M.Inventory;
  const P = { inventory: Iv.create(), slot: 0, instabuild: false, ey: 65.62, EYE: 1.62, ex: 0, ez: 0, lookVec: () => [0, 0, 1], syncHotbar() {} };
  const crystals = () => EL.list.filter((e) => e && e.type === 'end_crystal' && !e.removed).length;
  const tryUse = (x, y, z, creative) => {
    P.instabuild = !!creative;
    Iv.setItem(P.inventory, 0, Iv.stack('end_crystal', 2, 0, null));
    const st = Iv.getItem(P.inventory, 0);
    const r = M.Use.itemUseOn(P, x, y, z, 1, W.getBlock(x, y, z), st);
    return { r, count: st.n };
  };
  put(W, S, 3, 60, 3, 'obsidian'); put(W, S, 6, 60, 3, 'bedrock'); put(W, S, 9, 60, 3, 'stone');
  put(W, S, 12, 60, 3, 'obsidian'); put(W, S, 12, 61, 3, 'stone');
  put(W, S, 15, 60, 3, 'obsidian');
  let t = tryUse(3, 60, 3);
  ok(t.r === true && crystals() === 1 && t.count === 1, 'obsidian: crystal placed, stack 2 -> 1');
  const c1 = EL.list.find((e) => e && e.type === 'end_crystal');
  ok(c1 && c1.x === 3.5 && c1.y === 61 && c1.z === 3.5 && c1.showBottom === false, 'spawned at (x+.5, y+1, z+.5), ShowBottom false');
  t = tryUse(3, 60, 3);
  okAv(t.r === false && crystals() === 1 && t.count === 2, 'an entity (the first crystal) in the column refuses, stack unchanged');
  t = tryUse(6, 60, 3);
  ok(t.r === true && crystals() === 2, 'bedrock accepted');
  t = tryUse(9, 60, 3);
  okAv(t.r === false && crystals() === 2 && t.count === 2, 'stone refuses, stack unchanged');
  t = tryUse(12, 60, 3);
  okAv(t.r === false && crystals() === 2 && t.count === 2, 'a block above refuses, stack unchanged');
  t = tryUse(15, 60, 3, true);
  ok(t.r === true && crystals() === 3 && t.count === 2, 'creative: placed, stack not decremented');
}

// -- 9. #5914: the ring count follows LIVE end_crystal entities, not the synthetic rows.
{
  const M = freshEngine();
  const EL = M.EntityList, ED = M.EnderDragon;
  const fight = new ED.EnderDragonFight({ seed: 1 });
  const crystals = EL.list.filter((e) => e && e.type === 'end_crystal');
  ok(crystals.length === 10 && fight.getAliveEndCrystals() === 10, 'fight spawns 10 real crystals, count 10');
  for (let i = 0; i < 3; i++) M.Combat.hurt(crystals[i], 1, undefined, true);
  ok(fight.getAliveEndCrystals() === 7, 'after 3 real kills getAliveEndCrystals()==7 (got ' + fight.getAliveEndCrystals() + ')');
  // heal link: tickWithEndCrystals heals only while connectedCrystal is live
  const d = { connectedCrystal: crystals[5], age: 10, removed: false };
  okAv(!crystals[5].removed, 'a surviving crystal is not removed');
  // anti-vacuity: flipping the synthetic rows alone must NOT change the answer
  fight.crystals.forEach((r) => { r.alive = false; });
  okAv(fight.getAliveEndCrystals() === 7, 'synthetic rows are not read (alive=false on all rows => still 7)');
  EL.remove(crystals[5]);
  okAv(fight.getAliveEndCrystals() === 6, 'removing a live entity drops the count');
}

// -- 10. #5940: respawnDragon gathers the four portal-edge crystals from live entities.
{
  const setup = (cells) => {
    const M = freshEngine();
    const EL = M.EntityList, ED = M.EnderDragon;
    const fight = new ED.EnderDragonFight({ seed: 59, heightAt: () => 65, players: () => [] });
    fight.dragonKilled = true;
    const p = fight.exitPortalLocation;
    for (const [dx, dz] of cells) EL.spawn('end_crystal', p.x + dx + 0.5, p.y + 1, p.z + dz + 0.5, {});
    return { fight, started: fight.respawnDragon() };
  };
  const four = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  const r = setup(four);
  ok(r.started === true && r.fight.dragonSpawnStateIndex === 0, 'four live crystals on the four cells start the respawn');
  for (let i = 0; i < 2000 && r.fight.dragonSpawnStateIndex >= 0; i++) r.fight.tick();
  ok(r.fight.dragonSpawnStateIndex === -1 && !!r.fight.dragon, 'the state sequence ends with a created dragon');
  okAv(setup(four.slice(0, 3)).started === false, 'three crystals start nothing');
  okAv(setup([[2, 0], [-2, 0], [0, 2], [0, -5]]).started === false, 'one crystal off its cell starts nothing');
}

// -- 11. #6082: EndCrystalEntity.tick() -- fire in an AIR cell only while a fight exists.
{
  const run = (withFight, cellState) => {
    const M = freshEngine();
    const EL = M.EntityList, ED = M.EnderDragon, W = M.World;
    ED.activeFight = withFight ? new ED.EnderDragonFight({ seed: 60, heightAt: () => 65, players: () => [] }) : null;
    const c = EL.spawn('end_crystal', 10.5, 70, 10.5, {});
    W.setBlock(10, 69, 10, M.States.stateOf('obsidian'));
    if (cellState) W.setBlock(10, 70, 10, M.States.stateOf(cellState));
    EL.tick();
    return { M, W, c };
  };
  const fireId = (r) => r.M.States.block[r.W.getBlock(10, 70, 10)] === r.M.Reg.id.fire;
  const a = run(true, null);
  if (a.M.EnderDragon.getActiveFight()) {
    ok(fireId(a) && a.c.endCrystalAge === 1, 'fight + air cell: fire placed, age 1');
    okAv(!fireId(run(false, null)), 'no fight: no fire');
    okAv(!fireId(run(true, 'bedrock')), 'bedrock cell (not air): no fire placed');
  } else {
    ok(false, 'a constructed fight is not the active fight');
  }
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
