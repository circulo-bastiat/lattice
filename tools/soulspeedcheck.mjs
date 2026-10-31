#!/usr/bin/env node
// soulspeedcheck -- #5769: Soul Speed. Boots level I-III on soul_sand/soul_soil give the movement_speed modifier
// 0.03F*(1+level*0.35F) (LivingEntity.addSoulSpeedBoostIfNeeded), no boots keep the soul_sand 0.4 slowdown, stepping off
// removes the modifier, 4% of adds wear the boots. Drives the real SoulSpeed.tick + Physics.tick; breaks four steps of it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07q_effects.js', '14b_physics.js', '14f_inventory.js', '14j_combat.js', '07zzv_soulspeed.js'];
const fails = []; let asserted = 0;
const ok = (c, m) => { asserted++; if (!c) fails.push(m); };
const F = Math.fround;

function setup() {
  const MCL = loadEngine({ extra: EXTRA, dom: false });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const PHYS = rdj('block-physics.json'); MCL.Reg.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions });
  MCL.World.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = MCL.World.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(cx, cz), c); }
  return MCL;
}
function player(MCL, level, floor) {
  const Iv = MCL.Inventory, W = MCL.World, S = (n) => MCL.States.stateOf(n) | 0;
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { W.setBlock(x, 63, z, S(floor)); W.setBlock(x, 64, z, 0); W.setBlock(x, 65, z, 0); }
  const e = { type: 'player', x: 0.5, y: 64, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, onGround: true, living: true, inventory: Iv.create() };
  if (level) {
    const id = MCL.Items.of('iron_boots');
    e.inventory.slots[Iv.ARMOR_START] = { i: id, n: 1, d: 0, t: { Enchantments: [{ id: 'minecraft:soul_speed', lvl: level }] } };
  }
  return e;
}
const ctl = (extra) => Object.assign({ fwd: 0, strafe: 0, jump: false, sprint: false, sneak: false }, extra);
const rnd = (v) => () => v;

function suite(tag, MCL, expectCatch) {
  const SS = MCL.SoulSpeed, Ph = MCL.Physics, f = [];
  const no = (c, m) => { asserted++; if (!c) f.push(tag + ': ' + m); };
  for (const floor of ['soul_sand', 'soul_soil'])
    for (const lvl of [1, 2, 3]) {
      const e = player(MCL, lvl, floor);
      SS.tick(e, rnd(0.99));
      const want = F(F(0.03) * F(1 + F(lvl * F(0.35))));
      no(e.soulSpeedMod === want, `${floor} level ${lvl}: modifier ${e.soulSpeedMod} != ${want}`);
      no(MCL.Physics.speedFactorOf(e) === 1, `${floor} level ${lvl}: slowdown not negated`);
    }
  { const a = player(MCL, 1, 'soul_sand'), b = player(MCL, 3, 'soul_sand'); SS.tick(a, rnd(0.99)); SS.tick(b, rnd(0.99)); no(b.soulSpeedMod > a.soulSpeedMod, 'level 3 not faster than level 1'); }
  { const e = player(MCL, 0, 'soul_sand'); SS.tick(e, rnd(0.99)); no(!e.soulSpeedMod, 'boost without boots'); no(Ph.speedFactorOf(e) === F(0.4) || Math.abs(Ph.speedFactorOf(e) - 0.4) < 1e-6, 'no boots: slowdown ' + Ph.speedFactorOf(e)); }
  for (const floor of ['stone', 'netherrack', 'sand']) { const e = player(MCL, 3, floor); SS.tick(e, rnd(0.99)); no(!e.soulSpeedMod, 'boost on ' + floor); }
  { // faster on soul sand than no boots there
    const dist = (lvl) => { const e = player(MCL, lvl, 'soul_sand'); for (let i = 0; i < 20; i++) { SS.tick(e, rnd(0.99)); Ph.tick(e, ctl({ fwd: 1 })); } return Math.hypot(e.x - 0.5, e.z - 0.5); };
    no(dist(3) > dist(0) * 1.5, 'soul speed boots not clearly faster than bare on soul sand');
  }
  { // step onto stone: modifier removed
    const e = player(MCL, 2, 'soul_sand'); SS.tick(e, rnd(0.99)); no(e.soulSpeedMod > 0, 'setup');
    const W = MCL.World; for (let x = 5; x <= 7; x++) for (let z = -1; z <= 1; z++) W.setBlock(x, 63, z, MCL.States.stateOf('stone') | 0);
    e.x = 6.5; SS.tick(e, rnd(0.99)); no(!e.soulSpeedMod, 'modifier kept after leaving soul sand');
  }
  { // boot wear: 0.03 -> wear, 0.05 -> none
    const dur = (e) => e.inventory.slots[MCL.Inventory.ARMOR_START].d | 0;
    const w = player(MCL, 1, 'soul_sand'); SS.tick(w, rnd(0.03)); no(dur(w) === 1, 'no boot wear at roll 0.03: ' + dur(w));
    const n = player(MCL, 1, 'soul_sand'); SS.tick(n, rnd(0.05)); no(dur(n) === 0, 'boot wear at roll 0.05: ' + dur(n));
  }
  { const e = player(MCL, 1, 'soul_sand'); e.vx = 0.1; e.vz = 0.1; e.soulAge = 4; let got = 0; MCL.Particle = { spawn: (t) => { if (t === 'soul') got++; } }; SS.tick(e, rnd(0.5)); no(got === 1, 'soul particle count ' + got); }
  if (expectCatch) return f;
  for (const m of f) fails.push(m);
  return f;
}

const base = setup(); suite('real', base, false);
const MUT = {
  'level ignored': (S) => { S.modifierFor = () => F(0.03 * 1.35); },
  'boost on non-soul blocks': (S) => { S.onSoulBlock = () => true; },
  'modifier never removed': (S) => { S.remove = () => {}; },
  'no boot damage': (S) => { S.damageBoots = () => {}; },
};
let caught = 0;
for (const [name, fn] of Object.entries(MUT)) {
  const M = setup(); fn(M.SoulSpeed);
  const f = suite(name, M, true);
  if (f.length) { caught++; console.log('   ✓ break caught: ' + name); } else fails.push('break not caught: ' + name);
}
console.log(`soulspeedcheck: ${asserted} assertions, ${fails.length} failures, ${caught} breaks caught`);
for (const m of fails) console.log(' FAIL ' + m);
process.exit(fails.length ? 1 : 0);
