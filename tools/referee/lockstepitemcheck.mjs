// lockstep-item -- #6309 (G17-L57): lockstep scenario 'item': dropped ItemEntity stacks, 20 salts, per-tick `entities` rows [type,x,y,z,vx,vy,vz,count,age,pickupDelay] + the removal tick.
// Reference = .decomp ItemEntity.tick (pickupDelay-- unless 32767; gravity -0.04; move only if !onGround || hSpeed^2 > 1e-5 || (age+id)%4==0, collision zeroes vy, then x0.98/0.98;
// merge when age%(blockChanged?2:40)==0 && canMerge, tryMerge over getEntitiesByClass(box.expand(0.5,0,0.5)): smaller count absorbed, pickupDelay=max, itemAge=min;
// itemAge++ then discard at itemAge>=6000) and ItemEntity.hurt/Entity.setOnFireFromLava (LAVA 4.0 per tick in lava vs ItemEntity health 5 -> gone on the 2nd tick).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14j_combat.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
const EL = M.EntityList;
const cobble = M.Items.idOf ? M.Items.idOf('cobblestone') : 'cobblestone';
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 6002, W = 0.25, H = 0.25;
function scenario(salt) {
  cells.clear(); EL.clear();
  const stone = M.States.stateOf('stone'), lava = M.States.stateOf('lava');
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(x, -1, z, stone);
  w.set(6, 0, 0, lava);
  const r = stream(salt); EL.random = r; Math.random = r;
  const dx = 0.2 + r() * 0.5, ca = 1 + Math.floor(r() * 20), cb = 1 + Math.floor(r() * 20), cc = 1 + Math.floor(r() * 20);
  const mk = (x, z, n) => EL.dropStack(x, 0, z, cobble, n, { vx: 0, vy: 0, vz: 0 });
  // A + B overlap (dx < 0.75), C is 0.8 from A on the far side (outside the 0.5 inflate), L sits in lava, S is the lone survivor
  const A = mk(0.5, 0.5, ca), B = mk(0.5 + dx, 0.5, cb), C = mk(0.5 - 0.8, 0.5, cc), L = mk(6.5, 0.5, 2), S = mk(-6.5, -6.5, 3);
  const ents = [A, B, C, L, S];
  // reference state per item
  const R = ents.map((e) => ({ e, x: e.x, y: 0, z: e.z, vx: 0, vy: 0, vz: 0, count: e.count, age: 0, itemAge: 0, pd: 10, onGround: false, alive: true, hp: 5, lava: e === L }));
  const E = [], X = [];
  for (let t = 1; t <= TICKS; t++) {
    EL.tick();
    // --- reference tick (spawn order, like iterateEntities)
    for (const q of R) {
      if (!q.alive) continue;
      q.age++;
      if (q.lava && q.age >= 2) { q.hp -= 4; if (q.hp <= 0) { q.alive = false; continue; } }   // Entity.baseTick -> isInLava (false while firstUpdate) -> setOnFireFromLava -> damage(LAVA, 4.0)
      if (q.pd > 0 && q.pd !== 32767) q.pd--;
      if (q.lava) {   // applyLavaBuoyancy: v*(0.95, 1, 0.95), vy += (vy < 0.06 ? 5.0E-4F : 0); then move (airborne) and x0.98
        q.vx *= 0.95; q.vz *= 0.95; q.vy += q.vy < Math.fround(0.06) ? Math.fround(5.0E-4) : 0;
        q.y += q.vy; q.vx *= 0.98; q.vy *= 0.98; q.vz *= 0.98;
        continue;
      }
      q.vy -= 0.04;
      if (!q.onGround || q.vx * q.vx + q.vz * q.vz > 1e-5 || (q.age + q.e.id) % 4 === 0) {
        q.onGround = true; q.vy = 0;   // floor at y 0: the fall is blocked and vy is zeroed by the collision
        q.vx *= 0.6 * 0.98; q.vz *= 0.6 * 0.98; q.vy *= 0.98;
      }
      if (q.age % 40 === 0 && q.itemAge < 6000 && q.count < 64) {
        for (const o of R) {
          if (o === q || !o.alive || o.itemAge >= 6000 || o.count >= 64) continue;
          if (Math.abs(o.x - q.x) >= W + 0.5 || Math.abs(o.z - q.z) >= W + 0.5) continue;   // box.expand(0.5, 0, 0.5)
          if (o.count + q.count > 64) continue;
          const [big, small] = o.count < q.count ? [q, o] : [o, q];
          big.count += small.count; big.pd = Math.max(big.pd, small.pd); big.itemAge = Math.min(big.itemAge, small.itemAge); small.alive = false;
          if (!q.alive) break;
        }
      }
      if (q.alive) { q.itemAge++; if (q.itemAge >= 6000) q.alive = false; }
    }
    const row = (xs) => ({ tick: t, entities: xs });
    E.push(row(ents.filter((e) => !e.removed).map((e) => ['item', e.x, e.y, e.z, e.vx, e.vy, e.vz, e.count, e.age, e.pickupDelay])));
    X.push(row(R.filter((q) => q.alive).map((q) => ['item', q.x, q.y, q.z, q.vx, q.vy, q.vz, q.count, q.age, q.pd])));
  }
  return { E, X, ents, R };
}
const diff = (s) => compareTraces(s.X, s.E, { fields: ['entities'] });
const first = (s) => { const d = diff(s); return d && d.tick; };
for (const salt of salts) {
  const s = scenario(salt), d = diff(s);
  ok(!d, 'salt ' + salt + (d ? ` tick ${d.tick} ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}` : ''));
  if (salt === 0) {
    ok(s.ents[3].removed && s.ents[4].removed, 'lava stack and survivor both discarded');
    const has = (t) => s.E[t - 1].entities.some((r) => r[1] === -6.5);
    ok(has(5999) && !has(6000), 'lone stack present at tick 5999, gone at tick 6000');
    ok(has(2) && s.E[1].entities.every((r) => r[1] !== 6.5 || r[7] === 2) && !s.E[2].entities.some((r) => r[1] > 6), 'lava stack present at tick 2, gone at tick 3');
  }
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const mb = EL.ITEM_MERGE_BOX; EL.ITEM_MERGE_BOX = 0.6;
{ const t = first(scenario(3)); brk(t === 40, `merge radius 0.5 -> 0.6 reported at the merge tick (${t})`); }
EL.ITEM_MERGE_BOX = mb;
const lt = EL.ITEM_LIFETIME; EL.ITEM_LIFETIME = 5999;
{ const t = first(scenario(3)); brk(t === 5999, `despawn 6000 -> 5999 reported at tick ${t}`); }
EL.ITEM_LIFETIME = lt;
console.log(`lockstep-item: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
