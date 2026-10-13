#!/usr/bin/env node
// fireballcheck.mjs — #646: Gh.tickFireball vs ExplosiveProjectileEntity.tick (.decomp).
//   1. air: 40 ticks match the reference recurrence pos+=v; v=(v+power)*0.95
//   2. water: same with drag 0.8
//   3. thin-target sweep: a fast fireball crossing a thin mob in one tick hits it
//   4. owner removed -> discarded
//   5. anti-vacuity: break each and confirm the check notices
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('fireballcheck — #646: ExplosiveProjectileEntity.tick (drag, water, swept hit, owner discard)');
const M = loadEngine({
  extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js',
          '07b_behaviour.js', '09c_weather.js', '07zzh_blaze.js', '07zzi_ghast.js', '07za_explosion.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); M.Combat.init();
const EL = M.EntityList, W = M.World, CH = M.CH;
const WATER = M.States.stateOf('water') | 0;
function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const bw = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st), getLight: () => 15 << 4 };
  bw.getBlock = bw.get; bw.setBlock = bw.set;
  M.Behave.init(bw);
  EL.clear();
}
const owner = () => ({ x: 0, y: 200, z: 0, removed: false, width: 0.6, height: 1.8 });
function flight(drag, wet) {
  freshWorld();
  if (wet) for (let x = -5; x <= 60; x++) for (let y = 90; y <= 110; y++) for (let z = -5; z <= 5; z++) W.setBlock(x, y, z, WATER);
  const o = owner();
  const e = EL.spawn('fireball', 0, 100, 0, { shooter: o, power: [1, 0, 0], explosionPower: 1 });
  let x = e.x, vx = e.vx; const px = e.powerX;
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    EL.tick();
    x += vx; vx = (vx + px) * drag;
    worst = Math.max(worst, Math.abs(e.x - x), Math.abs(e.vx - vx));
  }
  const alive = !e.removed;
  EL.clear();
  return { worst, alive };
}
{
  const a = flight(0.95, false);
  ok(a.alive && a.worst < 1e-9, 'air flight matches the reference recurrence (worst error ' + a.worst + ')');
  const w = flight(0.8, true);
  ok(w.alive && w.worst < 1e-9, 'water flight matches drag 0.8 (worst error ' + w.worst + ')');
  const wrong = flight(0.95, true);
  okAv(!(wrong.worst < 1e-9), 'water flight compared to the AIR recurrence must differ');
}
function sweep() {
  freshWorld();
  const o = owner();
  const t = EL.spawn('turtle', 10, 100, 0); t.maxHealth = t.health = 1000;
  const e = EL.spawn('fireball', 0, 100.2, 0, { shooter: o, power: [1, 0, 0], explosionPower: 1 });
  e.vx = 40; e.vy = 0; e.vz = 0; e.powerX = 0; e.powerY = 0; e.powerZ = 0;
  EL.tick();
  const r = { removed: !!e.removed, hurt: t.health < t.maxHealth };
  EL.clear();
  return r;
}
{
  const r = sweep();
  ok(r.removed && r.hurt, 'a 40 b/t fireball crossing a thin mob in one tick hits it (removed=' + r.removed + ', hurt=' + r.hurt + ')');
  const saved = M.Combat.rayBox;
  M.Combat.rayBox = () => null;
  const b = sweep();
  M.Combat.rayBox = saved;
  okAv(!(b.removed && b.hurt), 'with the sweep disabled the thin mob is tunnelled');
}
{
  freshWorld();
  const o = owner();
  const e = EL.spawn('fireball', 0, 100, 0, { shooter: o, power: [1, 0, 0], explosionPower: 1 });
  EL.tick(); ok(!e.removed, 'fireball lives while the owner lives');
  o.removed = true; EL.tick();
  ok(e.removed === true, 'fireball discarded once its owner is removed');
  EL.clear();
}
const fake = { yaw: 1.5, bodyYaw: 1.5, vx: 0, vz: 0, target: null };
{
  const g = new M.Ghast.LookAtTargetGoal(fake); g.tick();
  ok(Math.abs(fake.yaw - Math.PI) < 1e-9, 'idle ghast at rest faces vanilla yaw 0 (south = engine PI), not left at 1.5');
}
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity)`);
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
