#!/usr/bin/env node
// batcheck — D-533 (QUEUE 0.2 G18c): the bat. Drives the REAL modules (07zf_bat.js through
// EL.spawn/EL.tickOne, Spawn.RULES.bat, Cb.hurt) on generated chunks, against
// .decomp/net/minecraft/entity/passive/BatEntity.java (read in full).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('batcheck — D-533 (QUEUE 0.2 G18c): the bat');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
          '07l_spawn.js', '14j_combat.js', '07zf_bat.js', '07zzp_mobvoice.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Bat.init();
const EL = M.EntityList, W = M.World, S = M.States, Bat = M.Bat, Spawn = M.Spawn, Cb = M.Combat;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0;
// a sealed 5x5x4 air pocket at y=10..13 with a stone floor (9) and ceiling (14)
const box = (fill) => { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 9; y <= 14; y++) {
  const wall = x === -3 || x === 3 || z === -3 || z === 3 || y === 9 || y === 14;
  W.setBlock(x, y, z, wall ? stone : fill);
} };
box(0);
let seq = 0; const seqRnd = (vals) => () => vals[(seq++) % vals.length];
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };

// §1 closed set / spawn
{
  const m = EL.motionFor('bat');
  ok(m && m[0] === 0.08 && m[1] === 0.98, `bat motion is the plain MobEntity [0.08, 0.98] (got ${JSON.stringify(m)})`);
  const e = EL.spawn('bat', 0.5, 13.1, 0.5);
  ok(!!e && !!e.ai, 'EL.spawn(bat) returns a mob with a (empty) goal selector');
  ok(e && e.roosting === true, 'a new bat is born roosting (constructor setRoosting(true))');
  ok(e && e.maxHealth === 6, `bat max health 6 (createBatAttributes) — got ${e && e.maxHealth}`);
  // the witness is PICKED, not hard-coded (squidcheck.mjs's own D-567 fix; endermancheck.mjs/
  // passivecheck.mjs already carry this same fix after shulker's cloud-unit motion row
  // (confident-lamport-asj6ue) turned this hard-coded one green and would have made it red —
  // this file was the one left behind, caught by the D-773 cloud unit that gave shulker its AI).
  const VANILLA_UNBUILT = ['ender_dragon', 'wither', 'giant'];
  const witness = VANILLA_UNBUILT.find((t) => !EL.canSpawn(t));
  okAv(witness ? !EL.canSpawn(witness) : !EL.canSpawn('not_a_mob'), `a type nobody built (${witness || 'not_a_mob'}) is still refused — the closed set is real`);
}
// §2 roosting under a ceiling: snapped to floor(y)+1-height, zero velocity, stays put
{
  EL.list.length = 0;
  const e = EL.spawn('bat', 0.5, 13.0, 0.5);
  Bat.random = () => 0.5;   // never the 1/200 yaw roll
  for (let i = 0; i < 20; i++) EL.tickOne ? EL.tickOne(e) : EL.tickMob(e);
  const want = 13 + 1 - e.height;
  ok(e.roosting, 'a bat under solid stone with no player near keeps roosting');
  ok(Math.abs(e.y - want) < 1e-9 && e.vx === 0 && e.vy === 0 && e.vz === 0,
    `roosting pins y to floor(y)+1-height (${want}) with zero velocity — got y=${e.y} v=${[e.vx, e.vy, e.vz]}`);
  // player within 4 and visible -> wakes
  M.Player = { x: 0.5, y: 10, z: 2.0, EYE: 1.62 };
  EL.tickOne ? EL.tickOne(e) : EL.tickMob(e);
  ok(!e.roosting, 'a visible player within 4 blocks wakes the roosting bat');
  // anti-vacuity: the same player behind a wall does NOT wake it
  EL.list.length = 0;
  const f = EL.spawn('bat', 0.5, 13.0, 0.5);
  W.setBlock(0, 11, 1, stone); W.setBlock(0, 12, 1, stone); W.setBlock(0, 13, 1, stone);
  W.setBlock(1, 11, 1, stone); W.setBlock(-1, 11, 1, stone); W.setBlock(1, 12, 1, stone); W.setBlock(-1, 12, 1, stone);
  M.Player = { x: 0.5, y: 10, z: 2.0, EYE: 1.62 };
  EL.tickOne ? EL.tickOne(f) : EL.tickMob(f);
  okAv(f.roosting, 'the same player, walled off (no line of sight), does NOT wake it — canSee is really asked');
  box(0);
  // a far player never wakes it
  M.Player = { x: 0.5, y: 6, z: 0.5, EYE: 1.62 };
  const g = EL.spawn('bat', 0.5, 13.0, 0.5);
  M.Player = { x: 50, y: 13, z: 50, EYE: 1.62 };
  EL.tickOne ? EL.tickOne(g) : EL.tickMob(g);
  ok(g.roosting, 'a player 70 blocks away does not wake it');
  // no ceiling -> wakes
  W.setBlock(0, 14, 0, 0);
  EL.tickOne ? EL.tickOne(g) : EL.tickMob(g);
  ok(!g.roosting, 'with the ceiling block removed, the bat lets go (isSolidBlock above is false)');
  box(0);
}
// §3 flight: steering law and vy*0.6
{
  EL.list.length = 0;
  M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
  const e = EL.spawn('bat', 0.5, 11.0, 0.5);
  e.roosting = false; e.hangingPos = [2, 12, 2]; e.vx = e.vy = e.vz = 0;
  Bat.random = () => 0.99;  // never re-pick (nextInt(30)=29), never roost (nextInt(100)=99)
  Bat.mobTick(e);
  ok(Math.abs(e.vx - 0.05) < 1e-9 && Math.abs(e.vz - 0.05) < 1e-9 && Math.abs(e.vy - 0.07) < 1e-9,
    `steer: v += (signum(d)*0.5 - v)*0.1, y 0.7 — got ${[e.vx, e.vy, e.vz]}`);
  ok(e.zza === 0.5, 'forwardSpeed = 0.5F');
  ok(Math.abs(e.yaw - Math.atan2(0.05, -0.05)) < 1e-9, 'yaw faces the new velocity (engine yaw convention)');
  e.vy = 0.5; Bat.postTick(e);
  ok(Math.abs(e.vy - 0.3) < 1e-9, 'tick(): a flying bat\'s vy *= 0.6');
  // re-pick when within 2 of the hanging pos
  e.x = 2.5; e.y = 12.5; e.z = 2.5; e.hangingPos = [2, 12, 2];
  Bat.random = () => 0.0; Bat.mobTick(e);
  ok(e.hangingPos[1] === Math.floor(12.5 - 2), `within 2 blocks of its target it re-picks (nextInt(6)-2 → y ${e.hangingPos[1]})`);
  Bat.random = null;
}
// §4 damage wakes, bat not pushed
{
  EL.list.length = 0;
  const e = EL.spawn('bat', 0.5, 13.0, 0.5);
  if (Cb && Cb.hurt) { Cb.hurt(e, 1, 0, false); ok(!e.roosting, 'any hit wakes a roosting bat (BatEntity.damage)'); }
  else ok(false, 'Combat module loaded');
}
// §5 spawn rule
{
  const r = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const rint = (vals) => { const f = r(vals); return () => f(); };
  ok(!Bat.lightRule(63, 0, 63, rint([0]), false), 'y >= sea level refuses');
  ok(!Bat.lightRule(20, 0, 63, rint([1]), false), 'outside halloween, nextBoolean()=true refuses first');
  ok(Bat.lightRule(20, 3, 63, rint([0, 3]), false), 'light 3 vs nextInt(4)=3 passes');
  ok(!Bat.lightRule(20, 3, 63, rint([0, 2]), false), 'light 3 vs nextInt(4)=2 refuses');
  ok(Bat.lightRule(20, 6, 63, rint([6]), true), 'halloween: bound 7 and no coin flip — light 6 vs 6 passes');
  ok(Bat.isHalloween(new Date(2026, 9, 20)) && Bat.isHalloween(new Date(2026, 10, 3)) &&
     !Bat.isHalloween(new Date(2026, 9, 19)) && !Bat.isHalloween(new Date(2026, 10, 4)), 'halloween window is Oct 20 .. Nov 3');
  ok(typeof Spawn.RULES.bat === 'function' && Spawn.canPlace('bat'), 'Spawn.RULES.bat is wired');
  const save = Bat.lightRule; Bat.lightRule = () => true;
  const under = Spawn.RULES.bat(0, 10, 0, 'natural', () => 0);
  Bat.lightRule = () => false;
  const refused = Spawn.RULES.bat(0, 10, 0, 'natural', () => 0);
  Bat.lightRule = save;
  ok(under === true, 'with the light rule passing, a cell over stone passes canMobSpawn');
  okAv(refused === false, 'breaking the light rule makes Spawn.RULES.bat refuse — the rule is really consulted');
}
// §6 voice: roosting ambient gate + take-off sound (world event 1025)
{
  const MV = M.MobVoice || M.MV;
  if (!MV) ok(false, 'MobVoice loaded');
  else {
    M.DATA = M.DATA || {}; M.DATA.mobSounds = { bat: ['entity.bat.ambient'] };
    const N = 4000; let q = 0;
    for (let i = 0; i < N; i++) if (MV.pick({ type: 'bat', roosting: true }, 'ambient') === null) q++;
    ok(q > N * 0.70 && q < N * 0.80, `roosting bat ambient is null ~75% (${q}/${N})`);
    let c = 0; for (let i = 0; i < 200; i++) if (MV.pick({ type: 'bat', roosting: false }, 'ambient') === 'entity.bat.ambient') c++;
    okAv(c === 200, 'a flying bat always chirps');
    const played = []; M.Sound = M.Sound || {}; const sp = M.Sound.play; M.Sound.play = (ev) => { played.push(ev); return true; };
    EL.list.length = 0; M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
    const e = EL.spawn('bat', 0.5, 13.0, 0.5); e.roosting = true; Bat.random = () => 0.5;
    W.setBlock(0, 14, 0, stone); W.setBlock(0, 14, 0, 0); Bat.mobTick(e);
    ok(!e.roosting && played.includes('entity.bat.takeoff'), 'waking (ceiling gone) plays entity.bat.takeoff');
    played.length = 0; W.setBlock(0, 14, 0, stone); e.roosting = true; e.silent = true; W.setBlock(0, 14, 0, 0); Bat.mobTick(e);
    okAv(played.length === 0, 'a silent bat takes off quietly');
    M.Sound.play = sp; Bat.random = null; box(0);
  }
}
// §7 getAttackDistanceScalingFactor: an invisible player at 3 blocks does not wake a roosting bat
{
  const Iv = M.Inventory;
  const slots = new Array(Iv.ARMOR_START + 4).fill(null);
  const mk = (inv) => ({ x: 0.5, y: 10.0, z: 0.5, EYE: 1.62, inventory: { slots }, effects: inv ? { invisibility: { duration: 99 } } : {} });
  M.Effects = { hasStatusEffect: (p, k) => !!(p.effects && p.effects[k] && p.effects[k].duration > 0) };
  const wakes = (P) => { EL.list.length = 0; M.Player = P; const e = EL.spawn('bat', 0.5, 13.0, 0.5); e.roosting = true; Bat.random = () => 0.5; Bat.mobTick(e); return !e.roosting; };
  W.setBlock(0, 14, 0, stone);
  ok(wakes(mk(false)), 'visible player at 3 blocks wakes the roosting bat');
  W.setBlock(0, 14, 0, stone);
  ok(!wakes(mk(true)), 'invisible player (no armour, 4*0.07 -> 2) at 3 blocks leaves it asleep');
  ok(Math.abs(Bat.attackScale(mk(true)) - 0.07) < 1e-9, 'invisible unarmoured scale = 0.7*0.1');
  const sv = Bat.attackScale; Bat.attackScale = () => 1;
  W.setBlock(0, 14, 0, stone);
  okAv(wakes(mk(true)), 'breaking attackScale makes the invisible player wake the bat');
  Bat.attackScale = sv; Bat.random = null; delete M.Effects; box(0);
}
console.log('================ batcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
