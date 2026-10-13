#!/usr/bin/env node
// endermancheck — loop/enderman-s98 (QUEUE 0.2 G18c): the enderman. Drives the REAL modules
// (07zg_enderman.js through EL.spawn/EL.tickOne, Spawn.RULES.enderman, Ai.ROSTER.enderman,
// Cb.hurt) against .decomp/net/minecraft/entity/mob/EndermanEntity.java (read in full).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('endermancheck — loop/enderman-s98 (QUEUE 0.2 G18c): the enderman');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
          '07l_spawn.js', '14j_combat.js', '07zf_bat.js', '07zg_enderman.js', '07zn2_endermite.js', '07zw_mobnbt.js', '07q_effects.js', '07z_potion.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Enderman.init();
const EL = M.EntityList, W = M.World, S = M.States, Em = M.Enderman, Spawn = M.Spawn, Cb = M.Combat, T = M.Tags, R = M.Reg;
ok(T && T.ready === true, 'the tag payload (02f_tags.js) decoded — enderman_holdable needs it');

for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0;
const dirt = S.stateOf('dirt') | 0;
// -20..20 so a full teleportRandomly()/teleportToward() offset (up to +-32/+-8 respectively,
// smaller with the fixed mock random this check drives) still lands on solid ground.
for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) W.setBlock(x, 63, z, stone);
// synthetic chunks start with a zeroed heightmap (no real worldgen ran) -- patch it so
// W.heightAt/skyVisible see the stone floor this check just placed, the same way a chunk
// loaded through worldgen would already have hmap populated.
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.get(cx, cz);
  for (let i = 0; i < 256; i++) c.hmap[i] = 64 - M.CFG.WORLD_MIN_Y;
}

const stubPlayer = (x, y, z, extra) => Object.assign({
  x, y, z, EYE: 1.62, eyeHeight: 1.62, dead: false,
  lookVec: () => ({ x: 0, y: 0, z: -1 }),
  inventory: { slots: [] }
}, extra || {});

// ── §1 spawn / attributes / motion (D-336/D-307 tables, no per-mob code needed) ─────────────
{
  const m = EL.motionFor('enderman');
  ok(m && m[0] === 0.08 && m[1] === 0.98, `enderman motion is the plain MobEntity [0.08, 0.98] (got ${JSON.stringify(m)})`);
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  ok(!!e && !!e.ai, 'EL.spawn(enderman) returns a mob with a goal selector');
  ok(e.maxHealth === 40, `createEndermanAttributes: max health 40 — got ${e.maxHealth}`);
  ok(Math.abs(M.Entities.attrsOf('enderman').speed - 0.3) < 1e-6, 'movement_speed 0.3');
  ok(M.Entities.attrsOf('enderman').dmg === 7, 'attack_damage 7');
  ok(M.Entities.attrsOf('enderman').follow === 64, 'follow_range 64');
  ok(e.width === 0.6 && Math.abs(e.height - 2.9) < 1e-6, `dimensions 0.6 x 2.9 — got ${e.width}x${e.height}`);
  ok(e.carriedBlock === null, 'a fresh enderman carries no block (CARRIED_BLOCK Optional.empty())');
  ok(e.angerTime === 0 && e.angryAt === null && e.provoked === false, 'ANGRY/PROVOKED start false, angerTime 0');
  // the witness is PICKED, not hard-coded (squidcheck.mjs's own D-567 fix, repeated here after
  // shulker's cloud-unit motion row (confident-lamport-asj6ue) turned it green and would have
  // made this red).
  const VANILLA_UNBUILT = ['ender_dragon', 'wither', 'giant'];
  const witness = VANILLA_UNBUILT.find((t) => !EL.canSpawn(t));
  okAv(witness ? !EL.canSpawn(witness) : !EL.canSpawn('not_a_mob'), `a type nobody built (${witness || 'not_a_mob'}) is still refused — the closed set is real`);
}

// ── §2 the goal selector shape (initGoals, .decomp:92-105) ─────────────────────────────────
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  const ctx = EL.aiCtx(e);
  ok(!!ctx, 'EL.aiCtx builds a context for the enderman');
  const priorities = e.ai.entries.map((x) => x.priority + '/' + x.flags).sort().join(',');
  // s115: + priority-3 TARGET ActiveTargetGoal<EndermiteEntity> (EndermanEntity.java:101-104), now an endermite exists.
  ok(e.ai.entries.length === 12, `12 goals registered (initGoals adds 8 MOVE/LOOK + 4 TARGET, one PickUp/PlaceBlock pair unsplit) — got ${e.ai.entries.length}: ${priorities}`);
  ok(e.ai.entries.some((x) => x.priority === 3 && (x.flags & M.Ai.TARGET)), 'priority 3 TARGET (ActiveTargetGoal<EndermiteEntity>) is registered');
  const hasMove1 = e.ai.entries.some((x) => x.priority === 1 && (x.flags & M.Ai.MOVE));
  ok(hasMove1, 'priority 1 MOVE (ChasePlayerGoal) is registered');
  const hasTarget1 = e.ai.entries.some((x) => x.priority === 1 && (x.flags & M.Ai.TARGET));
  ok(hasTarget1, 'priority 1 TARGET (TeleportTowardsPlayerGoal) is registered');
  const noControlCount = e.ai.entries.filter((x) => x.flags === 0).length;
  ok(noControlCount === 2, `PickUpBlockGoal/PlaceBlockGoal declare no controls (flags 0) — got ${noControlCount}`);  // UniversalAngerGoal is a TARGET-selector goal (#2159)
}

// ── §3 isPlayerStaring (.decomp:211-224) ─────────────────────────────────────────────────────
{
  const e = EL.spawn('enderman', 10.5, 64, 10.5);
  // aim exactly at the enderman's own eye (e.y + Em.EYE_HEIGHT), the way a real player turning
  // to face it would -- a fixed (0,0,1) look vector would miss by the eye-height difference.
  const aimAt = (px, py, pz) => {
    const dx = 10.5 - px, dy = (64 + Em.EYE_HEIGHT) - (py + 1.62), dz = 10.5 - pz;
    const len = Math.hypot(dx, dy, dz);
    return { x: dx / len, y: dy / len, z: dz / len };
  };
  const looking = stubPlayer(10.5, 64, 8.5, { lookVec: () => aimAt(10.5, 64, 8.5) });
  ok(Em.isPlayerStaring(e, looking), 'a player looking straight at the enderman, unobstructed, is staring');
  const away = stubPlayer(10.5, 64, 8.5, { lookVec: () => ({ x: 0, y: 0, z: -1 }) });
  okAv(!Em.isPlayerStaring(e, away), 'the SAME player looking the OTHER way is not staring — the dot product is really asked');
  const pumpkin = stubPlayer(10.5, 64, 8.5, {
    lookVec: () => aimAt(10.5, 64, 8.5),
    inventory: { slots: (() => { const s = []; s[M.Inventory.ARMOR_START + 3] = { i: M.Items.of('carved_pumpkin'), n: 1 }; return s; })() }
  });
  okAv(!Em.isPlayerStaring(e, pumpkin), 'a carved_pumpkin worn on the head exempts a player from staring, even face-on');
  // #2905 TeleportTowardsPlayerGoal.canUse: createAttackable refuses creative/spectator players
  {
    const prev = M.Player;
    const g = new Em.TeleportTowardsPlayerGoal(e);
    M.Player = looking;
    const survival = g.canUse();
    M.Player = Object.assign({}, looking, { invulnerableGamemode: true });
    const creative = g.canUse();
    M.Player = prev;
    ok(survival, 'a staring survival player starts TeleportTowardsPlayerGoal');
    okAv(!creative, 'a staring creative/spectator player does NOT start TeleportTowardsPlayerGoal (createAttackable)');
  }
  // #3922 canUse range = max(64 * attackScale, 2): sneaking x0.8 -> 51.2, so 55 blocks away does not provoke
  {
    const prev = M.Player, far = (o) => stubPlayer(e.x + 55, e.y, e.z, Object.assign({ lookVec: () => ({ x: -1, y: 0, z: 0 }) }, o));
    const g = new Em.TeleportTowardsPlayerGoal(e);
    M.Player = far({}); const stand = g.canUse();
    M.Player = far({ crouching: true }); const sneak = g.canUse();
    M.Player = prev;
    ok(stand, 'a standing staring player 55 blocks away provokes (range 64)');
    okAv(!sneak, 'a SNEAKING staring player 55 blocks away does not (range 64 x 0.8 = 51.2)');
  }
  // blocked line of sight
  W.setBlock(10, 64, 9, stone); W.setBlock(11, 64, 9, stone); W.setBlock(10, 65, 9, stone); W.setBlock(11, 65, 9, stone);
  okAv(!Em.isPlayerStaring(e, looking), 'a wall between the player and the enderman blocks the stare — canSee is really asked');
  W.setBlock(10, 64, 9, 0); W.setBlock(11, 64, 9, 0); W.setBlock(10, 65, 9, 0); W.setBlock(11, 65, 9, 0);
}

// ── §4 teleport (.decomp:273-317): refuses lava, lands on the first solid floor ─────────────
{
  W.setBlock(0, 70, 0, 0); W.setBlock(0, 60, 0, stone);
  const e = EL.spawn('enderman', 0.5, 75, 0.5);
  M.EntityList.random = () => 0.5;
  M.Sound = M.Sound || {}; const played = []; const oldPlay = M.Sound.play; M.Sound.play = (ev, o) => { played.push([ev, o]); return true; };
  const okTp = Em.teleportTo(e, 0.5, 65.7, 0.5);
  ok(okTp && Math.abs(e.y - 64.7) < 1e-9, 'teleportTo a spot floating in air steps down 1 per block keeping the fractional y (#2805, #4217: 65.7 -> 64.7)');
  okAv(played.length === 2 && played.every(p => p[0] === 'entity.enderman.teleport') && played[0][1].y === 75 && Math.abs(played[1][1].y - 64.7) < 1e-9, '#2805 teleport sound plays at origin AND destination');
  M.Sound.play = oldPlay;
  W.setBlock(5, 64, 5, stone); W.setBlock(5, 65, 5, stone); W.setBlock(5, 66, 5, stone); W.setBlock(5, 67, 5, stone);
  const b5 = { x: e.x, y: e.y, z: e.z };
  okAv(!Em.teleportTo(e, 5.5, 65, 5.5) && e.x === b5.x && e.y === b5.y, '#2805 a target inside solid geometry is refused (isSpaceEmpty) and the entity stays put');
  for (let y = 64; y <= 67; y++) W.setBlock(5, y, 5, 0);
  ok(!Em.teleportTo(e, 0.5, -100, 0.5), 'teleportTo refuses a column with no solid floor above bedrock (walked past BOTTOM_Y)');
  const before = { x: e.x, y: e.y, z: e.z };
  const lavaId = R.id && R.id.lava;
  if (lavaId !== undefined) {
    const lavaState = S.stateOf ? S.stateOf('lava') : lavaId;
    W.setBlock(3, 63, 3, lavaState || lavaId);   // overwrite the general floor AT the same height
    okAv(!Em.teleportTo(e, 3.5, 65.0, 3.5), 'teleportTo refuses landing in lava (the blocksMovement-but-not-lava gate)');
    ok(e.x === before.x && e.y === before.y && e.z === before.z, 'a refused teleport leaves the entity exactly where it was');
    W.setBlock(3, 63, 3, stone);                 // restore for anything after this block
    W.setBlock(3, 64, 3, S.stateOf ? S.stateOf('water') : R.id.water);   // #2855 a lake over solid floor: bbox in water -> refused
    okAv(!Em.teleportTo(e, 3.5, 66, 3.5) && e.y === before.y, '#2855 teleport into a water column is refused (scan passes through water, containsFluid)');
    W.setBlock(3, 64, 3, 0);
    W.setBlock(7, 63, 7, stone); W.setBlock(7, 64, 7, S.stateOf('white_carpet'));   // #3602 carpet is notSolid: scan walks through to the stone, the carpet then overlaps the box
    okAv(!Em.teleportTo(e, 7.5, 65, 7.5) && e.y === before.y, '#3602 teleport onto a carpet-covered floor is refused (Material.blocksMovement, not has-collision-shape)');
    W.setBlock(7, 64, 7, 0);
    // #3601 a waterlogged slab is Material STONE: vanilla lands ON it
    let wl = 0; for (let l = 0; l < 6 && !wl; l++) { const x = S.withLocal('oak_slab', l); if (S.waterIn[x]) wl = x; }
    W.setBlock(3, 64, 3, wl);
    okAv(wl > 0 && Em.teleportTo(e, 3.5, 67, 3.5) && e.y === 65, '#3601 teleport lands on top of a waterlogged slab, not through it');
    W.setBlock(3, 64, 3, 0);
  } else {
    ok(false, 'NS.Reg.id.lava resolved');
  }
}

// ── §5 mobTick: daytime teleport-away and water damage (.decomp:261-271, hurtByWater) ───────
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  e.target = { x: 1, y: 64, z: 1, type: 'zombie' };
  e.age = 700; e.ageWhenTargetSet = 0;
  ok(Math.abs(M.Ai.movementSpeedOf(e) - 0.45) < 1e-6, 'targeting: movement speed 0.3+0.15 = 0.45');
  { const t = e.target; e.target = null; ok(Math.abs(M.Ai.movementSpeedOf(e) - 0.3) < 1e-6, 'no target: 0.3'); e.target = t; }
  M.Sky = { isDay: () => true, isRainingAt: () => false };
  Em.mobTick(e);
  ok(e.ageWhenTargetSet === 700 && e.target !== null, 'acquiring a target sets ageWhenTargetSet = age (no instant daylight vanish)');
  e.age = 701; e.ageWhenTargetSet = 0; e._tgtSeen = true;
  M.Sky = { isDay: () => true, isRainingAt: () => false };
  EL.list.length = 0; EL.list.push(e);
  e.provoked = true;
  const before = { x: e.x, y: e.y, z: e.z };
  M.EntityList.random = () => 0.55;  // rnd()*30=16.5, NOT < 1.2 -- pick a value that both
  // (a) passes the roll (rnd()*30 < 1.2 needs rnd() < 0.04) and (b) gives a nonzero teleport
  // offset is impossible with ONE fixed mock value feeding both the roll and the offset, so
  // this uses TWO calls off a tiny queue instead: first call answers the roll, the rest feed
  // teleportRandomly's own three nextDouble()/nextInt() reads.
  { let n = 0; const seq = [0.0, 0.53, 0.53, 0.53]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; }
  const realB = M.Ai.lightLevelDependentMagicValue, realSky = W.canSeeSky;
  let bright = 1.0, sees = true;
  M.Ai.lightLevelDependentMagicValue = () => bright; W.canSeeSky = () => sees;
  // (b-0.4)*2 with b=0.5 is 0.2 -> rnd()*30 = 0 passes; b=0.5 is NOT > 0.5 (rain/dusk dimming) -> no roll
  const rolled = (b, s2) => { bright = b; sees = s2; e.target = { x: 1, y: 64, z: 1, type: 'zombie' }; e._tgtSeen = true; e.age = 701; e.ageWhenTargetSet = 0;
    let n = 0; const seq = [0.0, 0.53, 0.53, 0.53]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; Em.mobTick(e); return e.target === null; };
  ok(!rolled(0.5, true), 'brightness at eyes 0.5 (dimmed) does not roll');
  ok(!rolled(1.0, false), 'no sky at the block does not roll');
  { bright = 0.45; sees = true; e.target = { x: 1, y: 64, z: 1, type: 'zombie' }; e._tgtSeen = true; e.age = 701; e.ageWhenTargetSet = 0;
    M.EntityList.random = () => 0.2; Em.mobTick(e); ok(e.target !== null, 'b=0.45: threshold 0.1 -> rnd()*30=6 fails (not the fixed 1.2)'); }
  e.target = { x: 1, y: 64, z: 1, type: 'zombie' }; e._tgtSeen = true; e.age = 701; e.ageWhenTargetSet = 0; e.provoked = true;
  { let n = 0; const seq = [0.0, 0.53, 0.53, 0.53]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; }
  bright = 1.0; sees = true;
  Em.mobTick(e);
  M.Ai.lightLevelDependentMagicValue = realB; W.canSeeSky = realSky;
  ok(e.target === null && e.provoked === false, 'the daytime roll clears e.target and PROVOKED (setTarget(null))');
  okAv(e.x !== before.x || e.z !== before.z || e.y !== before.y, 'the daytime roll actually moved the enderman — teleportRandomly really ran');

  const w = EL.spawn('enderman', 0.5, 64, 0.5);
  w.inWater = true;
  M.EntityList.random = () => 0.99;   // rint(10) = 9, the "stay and take it" branch
  const hp0 = w.health;
  Em.applyWaterDamage(w);
  ok(w.health === hp0 - 1, `standing in water takes exactly 1 damage per tick (hurtByWater -> Cb.hurt(e,1)) — got ${w.health} from ${hp0}`);
  const w2 = EL.spawn('enderman', 0.5, 64, 0.5);
  w2.inWater = true;
  const before2 = { x: w2.x, y: w2.y, z: w2.z };
  { let n = 0; const seq = [0.53, 0.53, 0.53, 0.53]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; }   // rint(10)=5 (escapes), then a nonzero teleport offset
  Em.applyWaterDamage(w2);
  okAv(w2.x !== before2.x || w2.y !== before2.y || w2.z !== before2.z, '9-in-10 of the time, water damage also teleports the enderman away');
  // #1750: damage()'s else-branch -- a non-living attacker (fire) teleports 9 in 10, a living one does not
  const f1 = EL.spawn('enderman', 0.5, 64, 0.5), b1 = { x: f1.x, y: f1.y, z: f1.z };
  { let n = 0; const seq = [0.53, 0.53, 0.53, 0.53]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; }
  Cb.hurt(f1, 1, undefined, false, { bypassArmor: true, source: 'onFire' });
  okAv(f1.x !== b1.x || f1.y !== b1.y || f1.z !== b1.z, '#1750 fire damage (no living attacker) teleports the enderman 9 in 10');
  const f2 = EL.spawn('enderman', 0.5, 64, 0.5), b2 = { x: f2.x, y: f2.y, z: f2.z };
  { let n = 0; const seq = [0.53, 0.53, 0.53, 0.53]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; }
  Cb.hurt(f2, 1, undefined, true, { attacker: { x: 0, y: 64, z: 0 } });
  ok(f2.x === b2.x && f2.y === b2.y && f2.z === b2.z, '#1750 a player melee hit (living attacker) does not trigger the else-branch teleport');
  M.EntityList.random = null;
}

// ── §5b (KW-42) projectile hit: teleport-dodge, NOT damage (.decomp EndermanEntity.java:351-364)
// -- `Cb.hurt`'s own `src.source === 'projectile'` gate, wired from `Cb.tickArrow`'s entity-hit
// branch (src/14j_combat.js). Before the fix this was plain `Cb.hurt(e, 6, ...)` -- straight
// health loss, same as any other mob -- so this section is RED without it.
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  const hp0 = e.health;
  const before = { x: e.x, y: e.y, z: e.z };
  { let n = 0; const seq = [0.53, 0.53, 0.53]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; }
  const hit = Cb.hurt(e, 6, undefined, false, { attacker: null, source: 'projectile' });
  M.EntityList.random = null;
  ok(hit === true, 'KW-42: a projectile hit that lands a teleport still reports "hit" (matches EndermanEntity.damage() returning true)');
  ok(e.health === hp0, `KW-42: a projectile hit takes NO health from an enderman -- got ${e.health} from ${hp0} (teleport-dodge instead of damage)`);
  okAv(e.x !== before.x || e.y !== before.y || e.z !== before.z, 'KW-42: the projectile hit really teleported the enderman -- teleportRandomly ran, not a no-op');

  // control: the exact SAME call shape but withOUT `source: 'projectile'` (e.g. a melee hit) is
  // untouched by the gate -- damage applies exactly like any other mob, proving this is a
  // projectile-hit-specific dodge and not a blanket "enderman never takes damage" bug.
  const e2 = EL.spawn('enderman', 0.5, 64, 0.5);
  const hp2 = e2.health;
  const hit2 = Cb.hurt(e2, 6, undefined, false, { attacker: null });
  ok(hit2 === true && e2.health === hp2 - 6, 'KW-42 control: a non-projectile (melee) hit still damages an enderman normally -- the gate is projectile-specific, not blanket immunity');
}

// ── §5c #4503 thrown snowball/egg: Cb.hurtZero on an enderman teleports -- no hurt flash, no knockback ──
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  const before = { x: e.x, y: e.y, z: e.z };
  { let n = 0; const seq = [0.3, 0.53, 0.3]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; }
  const hit = Cb.hurtZero(e, stubPlayer(5.5, 64, 0.5));
  M.EntityList.random = null;
  ok(hit === true, '#4503: snowball vs enderman reports a hit');
  okAv(e.x !== before.x || e.y !== before.y || e.z !== before.z, '#4503: snowball vs enderman teleported it');
  ok(!e.hurtTime && !e.invulnerableTime, `#4503: no hurt flash / invulnerability window (hurtTime ${e.hurtTime}, inv ${e.invulnerableTime})`);
}

// ── §6 carried block: pick up / place, enderman_holdable tag really gates it ────────────────
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  W.setBlock(0, 65, 0, dirt);       // within [e.y, e.y+3) -- dirt IS enderman_holdable
  W.setBlock(1, 65, 1, stone);      // stone is NOT enderman_holdable
  const pickup = new Em.PickUpBlockGoal(e);
  let picked = false;
  for (let i = 0; i < 500 && !picked; i++) {
    const seq = [ (i % 4) / 4, ((i >> 2) % 3) / 3, ((i >> 4) % 4) / 4 ];
    let k = 0; M.EntityList.random = () => seq[k++ % seq.length];
    pickup.tick();
    if (e.carriedBlock !== null) picked = true;
  }
  ok(picked, 'PickUpBlockGoal.tick eventually picks up the dirt block somewhere in its 4x3x4 sweep');
  ok(picked && S.block[e.carriedBlock] === S.block[dirt], 'the carried block state IS the dirt state it picked up');
  ok(W.getBlock(0, 65, 0) === 0, 'the picked-up block is removed from the world');
  M.EntityList.random = null;

  // anti-vacuity: stone (not enderman_holdable) is never picked up, however long it tries
  const e2 = EL.spawn('enderman', 1.5, 64, 1.5);
  W.setBlock(1, 65, 1, stone);
  const pickup2 = new Em.PickUpBlockGoal(e2);
  for (let i = 0; i < 200; i++) {
    const seq = [ (i % 4) / 4, ((i >> 2) % 3) / 3, ((i >> 4) % 4) / 4 ];
    let k = 0; M.EntityList.random = () => seq[k++ % seq.length];
    pickup2.tick();
  }
  okAv(e2.carriedBlock === null, 'a non-enderman_holdable block (stone) is never picked up — the tag really gates it');
  M.EntityList.random = null;

  // #4215 pickup ray is ShapeType.OUTLINE: a no-collision flower/mushroom is picked up, and an outline-only
  // block (torch) between enderman and target blocks the ray
  const sweepPick = (blk, blocker, zo = 0) => {
    for (let x = 38; x < 44; x++) for (let z = 38; z < 46; z++) for (let y = 64; y < 68; y++) W.setBlock(x, y, z, 0);
    W.setBlock(38, 64, 40 + zo, S.stateOf("grass_block")); W.setBlock(39, 64, 40 + zo, stone);   // support for the flower / torch
    W.setBlock(38, 65, 40 + zo, blk);
    if (blocker) W.setBlock(39, 65, 40 + zo, S.stateOf("torch"));
    const en = EL.spawn('enderman', 40.5, 64, 40.5 + zo);
    const g = new Em.PickUpBlockGoal(en);
    for (let i = 0; i < 500 && en.carriedBlock === null; i++) { const q = [(i % 4) / 4, ((i >> 2) % 3) / 3, ((i >> 4) % 4) / 4]; let k = 0; M.EntityList.random = () => q[k++ % 3]; g.tick(); }
    M.EntityList.random = null; en.removed = true;
    return en.carriedBlock !== null;
  };
  // a poppy has an XZ model offset (#4693) that can slide its 6/16-wide outline off the ray's centre line: any of a few cells must be picked up
  ok([0, 1, 2, 3].some(zo => sweepPick(S.stateOf('poppy'), false, zo)), 'a poppy (no collision shape) is picked up');
  ok(!sweepPick(S.stateOf('brown_mushroom'), false), 'a brown_mushroom is NOT picked up: the by+0.5 ray passes over its 6/16-tall outline (vanilla PickUpBlockGoal, #4215)');
  okAv(!sweepPick(S.stateOf('poppy'), true), 'an outline-only torch between enderman and poppy blocks the pickup ray');

  // place: carried dirt onto air over a solid floor
  const e3 = EL.spawn('enderman', 5.5, 64, 5.5);
  e3.carriedBlock = dirt;
  W.setBlock(5, 63, 5, stone);
  const place = new Em.PlaceBlockGoal(e3);
  let placed = false;
  for (let i = 0; i < 200 && !placed; i++) {
    const seq = [ (i % 4) / 4, ((i >> 2) % 3) / 3 ];
    let k = 0; M.EntityList.random = () => seq[k++ % seq.length];
    place.tick();
    if (e3.carriedBlock === null) placed = true;
  }
  ok(placed, 'PlaceBlockGoal.tick eventually places the carried block onto a solid-floored air cell');
  M.EntityList.random = null;

  // canPlaceOn: canPlaceAt + entity overlap (#2806)
  const tryPlace = (blk, floor, withPlayer) => {
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) { W.setBlock(40 + x, 64, 40 + z, 0); W.setBlock(40 + x, 63, 40 + z, floor); }
    const en = EL.spawn('enderman', 41, 64, 41); en.carriedBlock = blk;
    const sv = M.Player; if (withPlayer) M.Player = { x: 41, y: 64, z: 41, width: 3, height: 3 };
    const g = new Em.PlaceBlockGoal(en);
    for (let i = 0; i < 60 && en.carriedBlock !== null; i++) { const q = [(i % 5) / 5, ((i >> 1) % 3) / 3]; let k = 0; M.EntityList.random = () => q[k++ % 2]; g.tick(); }
    M.EntityList.random = null; M.Player = sv;
    en.removed = true;
    return en.carriedBlock === null;
  };
  const sapling = S.stateOf('oak_sapling');
  okAv(!tryPlace(sapling, stone, false), 'a sapling is not placed on stone (canPlaceAt)');
  okAv(tryPlace(sapling, S.stateOf('grass_block'), false), 'a sapling is placed on grass (control)');
  okAv(!tryPlace(dirt, stone, true), 'dirt is not placed into a cell the player occupies');
}

// ── §7 death: carried block drops as an item ────────────────────────────────────────────────
{
  EL.list.length = 0;
  const e = EL.spawn('enderman', 20.5, 64, 20.5);
  e.carriedBlock = dirt;
  EL.list.push(e);
  const before = EL.list.filter((o) => o.type === 'item').length;
  e.dead = true;
  M.Combat.dropCarried(e);   // #4745: drops at death (Cb.tickEntity), no longer in EL.remove
  const after = EL.list.filter((o) => o.type === 'item').length;
  okAv(after === before + 1, 'a dead enderman carrying a block drops exactly one item entity');
  const dropped = EL.list.filter((o) => o.type === 'item').pop();
  ok(dropped && dropped.item === 'dirt', `the dropped item is the carried block's own name — got ${dropped && dropped.item}`);
  ok(e.carriedBlock === null, 'carriedBlock is cleared once dropped');
}

// ── §8 spawn rule: same Monster.checkMonsterSpawnRules shape as zombie/skeleton/spider/creeper
{
  ok(typeof Spawn.RULES.enderman === 'function' && Spawn.canPlace('enderman'), 'Spawn.RULES.enderman is wired');
  ok(Spawn.RULES.enderman !== Spawn.RULES.cow, "enderman's rule is its own function, not shared with cow's Animal rule");
  const origPeaceful = M.Diff.isPeaceful;
  M.Diff.isPeaceful = () => true;
  okAv(Spawn.RULES.enderman(0, 62, 0, 'natural', () => 0) === false, 'PEACEFUL difficulty refuses an enderman spawn — the gate is really consulted');
  M.Diff.isPeaceful = origPeaceful;
}

// ── §9 stare sound, PORTAL particles, NBT round trip (#1751) ────────────────────────────────
{
  const played = [], spawned = [];
  M.Sound = M.Sound || {}; const oldPlay = M.Sound.play; M.Sound.play = (ev, o) => { played.push([ev, o]); return true; };
  M.Particle = M.Particle || {}; const oldSp = M.Particle.spawn; M.Particle.spawn = (t, ...a) => { spawned.push([t, ...a]); return true; };
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  const dbg = (cond) => cond;
  {
    let stopped = 0; e.nav = { stop() { stopped++; } };
    spawned.length = 0;
    okAv(Em.teleportTo(e, 5.5, 64, 5.5) && spawned.length >= 128 && spawned.every(s => s[0] === 'portal') && stopped === 1, '#4216 teleportTo emits 128 portal particles and stops navigation');
    e.x = 0.5; e.y = 64; e.z = 0.5; delete e.nav; played.length = 0;
  }
  spawned.length = 0;
  Em.portalParticles(e);
  okAv(spawned.length === 2 && spawned.every(s => s[0] === 'portal' && s[5] <= 0), `2 portal particles per tick, vy<=0 (got ${spawned.length})`);
  okAv(Em.playAngrySound(e) === true && played.length === 1 && played[0][0] === 'entity.enderman.stare' && played[0][1].volume === 2.5, 'first stare plays entity.enderman.stare at 2.5');
  e.age = 100;
  okAv(Em.playAngrySound(e) === false && played.length === 1, 'second stare within 400 ticks is silent');
  e.age = 401;
  okAv(Em.playAngrySound(e) === true && played.length === 2, 'stare sounds again after 400 ticks');
  okAv(M.MobNbt.fieldsFor('enderman').includes('carriedBlock') && M.MobNbt.fieldsFor('enderman').includes('angerTime'), 'carriedBlock/angerTime are persisted fields (MobNbt)');
  M.Sound.play = oldPlay; M.Particle.spawn = oldSp;
}

// ── §10 unseen-teleport timer: `ticksSinceUnseenTeleport++ >= 30` is a POST-increment (.decomp:593-596) ──
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  e.target = stubPlayer(0.5, 64, 30.5);   // > 16 blocks away
  const oldStare = Em.isPlayerStaring, oldTp = Em.teleportToward;
  let calls = 0;
  Em.isPlayerStaring = () => false; Em.teleportToward = () => { calls++; return true; };
  const g = new Em.TeleportTowardsPlayerGoal(e);
  let first = 0;
  for (let i = 1; i <= 40 && !first; i++) { g.tick(); if (calls) first = i; }
  Em.isPlayerStaring = oldStare; Em.teleportToward = oldTp; e.removed = true;
  okAv(first === 31, `first unseen teleport lands on the 31st tick (post-increment), got ${first}`);
}

// ── §11 #3579 shouldContinue: stare only matters during the warmup; afterwards the target is kept ──
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  const pl = stubPlayer(0.5, 64, 30.5);
  const oldStare = Em.isPlayerStaring, oldP = M.Player;
  let stare = true; Em.isPlayerStaring = () => stare; M.Player = pl;
  const g = new Em.TeleportTowardsPlayerGoal(e);
  g.start();
  stare = false;
  okAv(!g.canContinueToUse(), 'warmup: player stops staring -> goal cancelled');
  g.start(); for (let i = 0; i < Em.LOOK_WARMUP; i++) g.tick();
  okAv(e.target === pl, 'warmup done: target acquired');
  for (let i = 0; i < 60; i++) { g.tick(); if (!g.canContinueToUse()) break; }
  okAv(g.canContinueToUse() && e.target === pl, 'player looked away for 60 ticks: target kept');
  Em.isPlayerStaring = oldStare; M.Player = oldP; e.removed = true;
}

// ── §12 #3897 stare warmup = Mob.lookAtEntity(10,10): yaw/pitch snap <=10deg/tick, aimed at the sneak-aware eye ──
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5); e.yaw = 0; e.pitch = 0;
  const pl = stubPlayer(10.5, 64, 0.5);
  const oldStare = Em.isPlayerStaring, oldP = M.Player, oldEye = M.Ai.eyeOf;
  Em.isPlayerStaring = () => true; M.Player = pl;
  const g = new Em.TeleportTowardsPlayerGoal(e); g.start();
  const D = 180 / Math.PI;
  g.canContinueToUse();
  okAv(Math.abs(Math.abs(e.yaw) * D - 10) < 1e-3, `warmup tick 1: yaw moved exactly 10deg (got ${e.yaw * D})`);
  // sneaking eye 1.27: target Y below the enderman's eye (2.55) -> pitch looks down by atan2(2.55-1.27, 10)
  M.Ai.eyeOf = (x) => x === pl ? 1.27 : oldEye(x);
  for (let i = 0; i < 20; i++) g.canContinueToUse();
  const want = Math.atan2(2.55 - 1.27, 10);
  okAv(Math.abs(e.pitch - want) < 0.02, `pitch aimed at sneaking eye Y (want ${want.toFixed(3)}, got ${e.pitch.toFixed(3)})`);
  M.Ai.eyeOf = oldEye; Em.isPlayerStaring = oldStare; M.Player = oldP; e.removed = true;
}

// ── §13 #4746 splash water bottle: damages (damageFromPotion) AND teleports (64-try loop)
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  const hp0 = e.health, before = { x: e.x, y: e.y, z: e.z };
  { let n = 0; const seq = [0.53, 0.53, 0.53]; M.EntityList.random = () => seq[Math.min(n++, seq.length - 1)]; }
  M.Potion.applyWater(0.5, 64, 0.5, [e], null);
  M.EntityList.random = null;
  ok(e.health === hp0 - 1, `#4746: splash water still deals 1 damage (got ${hp0 - e.health})`);
  okAv(e.x !== before.x || e.y !== before.y || e.z !== before.z, '#4746: splash water teleports the enderman');
  e.removed = true;
}

console.log('================ endermancheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('=================================================');
process.exit(fails.length ? 1 : 0);
