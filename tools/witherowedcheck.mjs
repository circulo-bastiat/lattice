#!/usr/bin/env node
// witherowedcheck.mjs — D-803 (session 159, loop/wither-owed): the four remaining
// src/07zzm_wither.js Wi.OWED items closed together --
//   1. damage()'s own invulnerability gate (WitherEntity.damage, .decomp:443-470)
//   2. the boss bar percent readout (bossBar.setPercent, both mobTick() branches)
//   3. the soul-sand + 3-skull summoning-structure detector (WitherSkullBlock.onPlaced)
//   4. blockBreakingCooldown / the 3x3x4 block-destruction tick (mobGriefing-gated)
//
//   node tools/witherowedcheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('witherowedcheck -- D-803: damage() invuln gate, boss bar percent, soul-sand+3-skull summon detector, blockBreakingCooldown');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zzh_blaze.js', '07zzi_ghast.js',
  '07c_blockentity.js', '07zzm_wither.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat;
const Ex = MCL.Explosion, Wi = MCL.Wither, BE = MCL.BlockEntities, T = MCL.Tags, Diff = MCL.Diff;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();
BE.init();

ok(Wi.ready === true, 'Wi.ready is true once loaded');
ok(T.ready === true, 'Tags loaded (needed for wither_immune / wither_summon_base_blocks)');
ok(BE.ready === true, 'BlockEntities loaded');
ok(T.blockTag('wither_immune') >= 0, 'the real wither_immune tag is packed');
ok(T.blockTag('wither_summon_base_blocks') >= 0, 'the real wither_summon_base_blocks tag is packed');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
  BE.clear();
  Diff.set('normal');
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }

// ============ 1. damage()'s own invulnerability gate =========================================
say('\n§1 damage()\'s own invulnerability gate (.decomp WitherEntity.java:443-470)');
{
  freshWorld();
  const w = spawn('wither', 0.5, 70, 0.5, {});
  w.health = w.maxHealth; w.invulTimer = 100;
  const h0 = w.health;
  const hit = Cb.hurt(w, 20, undefined, true);
  ok(hit === false, 'a hit while invulTimer > 0 returns false (Cb.hurt refuses the hit)');
  ok(near(w.health, h0), `and health is completely unchanged (${h0} -> ${w.health})`);

  // anti-vacuity: the SAME wither, timer at 0, the SAME hit now lands -- proves the block above
  // is really reading the timer and not just always refusing wither damage.
  w.invulTimer = 0;
  const hit2 = Cb.hurt(w, 20, undefined, true);
  okAv(hit2 === true && w.health < h0, `the SAME hit lands once invulTimer is 0 (${h0} -> ${w.health})`);

  // DamageSource.OUT_OF_WORLD is the one real vanilla exception: it bypasses the gate even
  // while the timer is running (.decomp: "source != OUT_OF_WORLD").
  w.invulTimer = 150; w.health = w.maxHealth;
  const h1 = w.health;
  const hitVoid = Cb.hurt(w, 1e9, undefined, false, { bypassArmor: true, source: 'outOfWorld' });
  ok(hitVoid === true && w.health < h1, `DamageSource.OUT_OF_WORLD still lands while invulTimer > 0 (${h1} -> ${w.health})`);
  ok(w.invulTimer === 150, 'and the invuln timer itself is untouched by that exception');
}

// ============ 2. the boss bar percent readout =================================================
say('\n§2 the boss bar percent readout (bossBar.setPercent, both mobTick() branches)');
{
  freshWorld();
  const w = spawn('wither', 200, 70, 0, {});
  ok(!!w.bossBar && w.bossBar.name === 'Wither', 'a spawned wither carries a bossBar data record');
  ok(near(w.bossBar.percent, 1.0), `the real ServerBossBar() ctor default, 1.0 (got ${w.bossBar.percent})`);

  Wi.onSummoned(w);
  ok(near(w.bossBar.percent, 0.0), 'onSummoned() drops the bar to the real 0.0F');

  // invuln branch: percent = 1 - (post-decrement timer)/220
  w.invulTimer = 220;
  Wi.tickInvuln(w);   // timer -> 219
  ok(w.invulTimer === 219, 'sanity: the timer actually decremented');
  ok(near(w.bossBar.percent, 1.0 - 219 / 220), `invuln branch: percent tracks 1-timer/220 (got ${w.bossBar.percent})`);

  Wi.tickInvuln(w);   // timer -> 218
  const p2 = w.bossBar.percent;
  okAv(near(p2, 1.0 - 218 / 220) && p2 !== (1.0 - 219 / 220), `the percent actually MOVES tick to tick (now ${p2}), not frozen at one value`);

  // normal branch (not invulnerable): percent = health/maxHealth, driven off Wi.tickMovement's
  // own else-branch (the real call site, not a bespoke test-only formula).
  w.invulTimer = 0;
  w.health = w.maxHealth / 2;
  w.age = 1;   // avoid the age%20==0 tick coinciding, irrelevant to this unit's own scope
  Wi.tickMovement(w);
  ok(near(w.bossBar.percent, 0.5), `normal branch: percent tracks health/maxHealth (${w.health}/${w.maxHealth}, got ${w.bossBar.percent})`);

  w.health = w.maxHealth;
  Wi.tickMovement(w);
  okAv(near(w.bossBar.percent, 1.0), `and rises again once health does (got ${w.bossBar.percent}) -- not a stub frozen at 0.5`);
}

// ============ 3. the soul-sand + 3-skull summoning-structure detector =========================
say('\n§3 the soul-sand + 3-skull summoning structure detector (WitherSkullBlock.onPlaced)');
function buildBase(x, y, z, axis, baseName) {
  // axis 'x': row runs east-west (dx=1); axis 'z': row runs north-south (dz=1).
  const dx = axis === 'x' ? 1 : 0, dz = axis === 'x' ? 0 : 1;
  for (let i = 0; i < 3; i++) put(x + i * dx, y - 1, z + i * dz, baseName);
  put(x + dx, y - 2, z + dz, baseName);   // the middle pedestal, one level lower
}
function placeSkulls(x, y, z, axis, skip) {
  const dx = axis === 'x' ? 1 : 0, dz = axis === 'x' ? 0 : 1;
  for (let i = 0; i < 3; i++) {
    if (skip === i) continue;
    // W.setBlock already calls Behave.changed -> BE.onChanged (the ONE place a block can
    // change, 07_world.js's own header) -- a caller placing a skull calls THIS, not BE.onChanged
    // a second time; the detector's own real call site is `put`/`W.setBlock`, not a test-only hook.
    put(x + i * dx, y, z + i * dz, 'wither_skeleton_skull');
  }
}
{
  freshWorld();
  const x = 5, y = 70, z = 5;
  buildBase(x, y, z, 'x', 'soul_sand');
  placeSkulls(x, y, z, 'x', 2);   // two ends placed already, middle placed last below
  ok(EL.list.length === 0, 'sanity: no wither yet with only 2 of 3 skulls placed');

  const before = EL.list.length;
  put(x + 2, y, z, 'wither_skeleton_skull');   // the THIRD skull -- structure complete, real setBlock
  ok(EL.list.length === before + 1, 'placing the third skull spawns exactly one real wither');
  const w = EL.list[EL.list.length - 1];
  ok(w.type === 'wither', 'the spawned entity really is a wither');
  ok(near(w.health, w.maxHealth / 3), `onSummoned() already applied: health == maxHealth/3 (got ${w.health}/${w.maxHealth})`);
  ok(Wi.getInvulnerableTimer(w) === 220, 'onSummoned() already applied: invuln timer == 220');
  ok(near(w.x, x + 1 + 0.5) && near(w.z, z + 0.5), `spawned centred over the row's MIDDLE column (x=${w.x}, z=${w.z})`);
  ok(W.getBlock(x, y, z) === 0 && W.getBlock(x + 1, y, z) === 0 && W.getBlock(x + 2, y, z) === 0,
    'all three skull cells were cleared to air');
  ok(W.getBlock(x, y - 1, z) === 0 && W.getBlock(x + 1, y - 1, z) === 0 && W.getBlock(x + 2, y - 1, z) === 0,
    'all three base-row cells were cleared to air');
  ok(W.getBlock(x + 1, y - 2, z) === 0, 'the pedestal cell was cleared to air too');
  okAv(near(w.yaw, Math.PI / 2) && near(w.yBodyRot, Math.PI / 2) && w.bodyYaw === undefined,
    'X-axis skull row: summon yaw == 90deg in yaw+yBodyRot (WitherSkullBlock.onPlaced), no private bodyYaw');

  // anti-vacuity: the SAME shape, but the base is DIRT (not #wither_summon_base_blocks) --
  // proves the detector reads the real tag rather than "any 3 skulls in a row".
  freshWorld();
  buildBase(x, y, z, 'x', 'dirt');
  placeSkulls(x, y, z, 'x', 2);
  const beforeBad = EL.list.length;
  put(x + 2, y, z, 'wither_skeleton_skull');
  okAv(EL.list.length === beforeBad, 'a dirt base (not soul sand/soil) never spawns a wither');

  // anti-vacuity: peaceful difficulty refuses even a perfectly real structure.
  freshWorld();
  Diff.set('peaceful');
  buildBase(x, y, z, 'x', 'soul_sand');
  placeSkulls(x, y, z, 'x', 2);
  const beforePeace = EL.list.length;
  put(x + 2, y, z, 'wither_skeleton_skull');
  okAv(EL.list.length === beforePeace, 'PEACEFUL difficulty refuses to summon even a real structure');
  Diff.set('normal');

  // the OTHER horizontal axis (north-south) works too -- not a one-orientation stub.
  freshWorld();
  const x2 = -8, y2 = 70, z2 = -8;
  buildBase(x2, y2, z2, 'z', 'soul_soil');
  placeSkulls(x2, y2, z2, 'z', 2);
  const beforeZ = EL.list.length;
  put(x2, y2, z2 + 2, 'wither_skeleton_skull');
  ok(EL.list.length === beforeZ + 1, 'the perpendicular (north-south) orientation, off soul_soil, also summons');
  okAv(near(EL.list[EL.list.length - 1].yaw, 0), 'Z-axis skull row: summon yaw == 0 (forwards on X)');
}

// ============ 4. blockBreakingCooldown / the 3x3x4 block-destruction tick ====================
say('\n§4 blockBreakingCooldown (arms at 20 on a real hit, fires the 3x3x4 destruction)');
{
  freshWorld();
  const x = 5, y = 70, z = -5;
  const w = spawn('wither', x + 0.5, y, z + 0.5, {});
  ok(w.blockBreakingCooldown === 0, 'a freshly spawned wither starts with the cooldown at 0');

  Cb.hurt(w, 5, undefined, true);
  ok(w.blockBreakingCooldown === Wi.BLOCK_BREAK_COOLDOWN && Wi.BLOCK_BREAK_COOLDOWN === 20,
    `a real un-blocked hit arms the cooldown at the real 20 (got ${w.blockBreakingCooldown})`);

  put(x, y + 1, z, 'dirt');       // inside the 3x3x4 volume -- must be destroyed at expiry
  put(x + 5, y + 1, z, 'dirt');   // OUTSIDE the volume -- must survive
  put(x, y, z, 'bedrock');        // #wither_immune -- must survive even inside the volume

  for (let i = 0; i < 19; i++) Wi.tickBlockBreaking(w);
  ok(w.blockBreakingCooldown === 1, `still counting down after 19 ticks (got ${w.blockBreakingCooldown})`);
  ok(W.getBlock(x, y + 1, z) !== 0, 'nothing destroyed yet before the cooldown actually reaches 0');

  Wi.tickBlockBreaking(w);   // the 20th tick -- reaches 0, triggers the real destruction
  ok(w.blockBreakingCooldown === 0, 'cooldown reaches exactly 0 on the expiry tick');
  ok(W.getBlock(x, y + 1, z) === 0, 'the real dirt INSIDE the 3x3x4 volume was destroyed');
  okAv(W.getBlock(x + 5, y + 1, z) !== 0, 'the dirt OUTSIDE the volume survived (not a whole-world clear)');
  okAv(W.getBlock(x, y, z) !== 0, 'the #wither_immune bedrock survived even INSIDE the volume');

  // anti-vacuity: mobGriefing=false -- the SAME expiry must not destroy anything, proving the
  // gate is real (the same convention Wi.tickInvuln's own explosion gate already proves).
  freshWorld();
  const w2 = spawn('wither', x + 0.5, y, z + 0.5, {});
  put(x, y + 1, z, 'dirt');
  Cb.hurt(w2, 5, undefined, true);
  MCL.Commands = { ruleGet: () => 'false' };
  for (let i = 0; i < 20; i++) Wi.tickBlockBreaking(w2);
  delete MCL.Commands;
  okAv(w2.blockBreakingCooldown === 0 && W.getBlock(x, y + 1, z) !== 0,
    'griefing=false: the cooldown still reaches 0 but the real dirt survives');
}

// ============ end-to-end regression ===========================================================
say('\n§5 end-to-end regression -- one real EL.tickMob tick after a real summon, no throw');
{
  freshWorld();
  const x = -5, y = 70, z = -5;
  buildBase(x, y, z, 'x', 'soul_sand');
  placeSkulls(x, y, z, 'x', 2);
  put(x + 2, y, z, 'wither_skeleton_skull');
  const w = EL.list[EL.list.length - 1];
  let threw = null;
  try { EL.tickMob(w); } catch (err) { threw = err; }
  ok(threw === null, 'EL.tickMob(freshly-summoned wither) runs one full tick with no throw' + (threw ? (': ' + threw.stack) : ''));
}

console.log(`witherowedcheck: ${pass} ok, ${fails.length} failed (${breaks} anti-vacuity)`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
