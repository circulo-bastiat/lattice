// lockstep-loot -- #6297 (G17-L49): lockstep scenario 'loot': a zombie, cow, skeleton and creeper killed by a scripted hit (Looting 0 / III, burning or not), 20 salts.
// Per-tick `entities` rows [type,x,y,z,vx,vy,vz,count,age,pickupDelay,itemId] for the dropped ItemEntity list, from the death tick on.
// Reference = a hand model of the .decomp draw order: LivingEntity.dropFromLootTable -> LootTable.getRandomItems pool by pool (set_count uniform = nextInt(max-min+1);
// LootingEnchantFunction only at level>0: round(level * nextFloat); random_chance_with_looting nextFloat < 0.025+0.01*level; 3 equal entries = nextInt(3);
// SmeltItemFunction when on fire), then ItemEntity(...) velocity nextDouble*0.2-0.1 x then z, vy 0.2 per stack, then ItemEntity.tick in the air (gravity -0.04, drag 0.98, pickupDelay--, age++).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14j_combat.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const cells = new Map();
const w = { get: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0, set: () => {} };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = () => null; M.Physics.solidAt = () => false;
M.EntityList.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
const EL = M.EntityList, Cb = M.Combat, L = M.Loot, Items = M.Items;
Cb.lootingOf = (a) => (a && a.looting) | 0;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const MOBS = ['zombie', 'cow', 'skeleton', 'creeper'], TICKS = 6, DEATH = 3;
// L.rng-free: both sides read ONE stream through Math.random; the reference draws in decomp order
function refDrops(type, lvl, fire, r) {
  const ni = (n) => Math.floor(r() * n), out = [];
  const looting = (n) => (lvl > 0 ? n + Math.round(lvl * r()) : n);
  const uni = (lo, hi) => lo + ni(hi - lo + 1);
  const add = (item, n) => { if (n > 0) out.push([item, n]); };
  if (type === 'zombie') {
    add('rotten_flesh', looting(uni(0, 2)));
    if (r() < 0.025 + lvl * 0.01) { const k = ni(3); add(['iron_ingot', 'carrot', fire ? 'baked_potato' : 'potato'][k], 1); }
  } else if (type === 'cow') {
    add('leather', looting(uni(0, 2)));
    add(fire ? 'cooked_beef' : 'beef', looting(uni(1, 3)));
  } else if (type === 'skeleton') {
    add('arrow', looting(uni(0, 2)));
    add('bone', looting(uni(0, 2)));
  } else if (type === 'creeper') {
    add('gunpowder', looting(uni(0, 2)));
  }
  return out;
}
function scenario(salt) {
  EL.clear();
  const R = stream(salt);   // the reference's own copy of the same stream
  const lane = salt % 4, lvl = lane & 1 ? 3 : 0, fire = lane >> 1 === 1;
  const mobs = MOBS.map((type, i) => ({ type, x: i * 3 + 0.5, y: 2, z: 0.5, isOnFire: fire, playerHitTimer: 100, attackingPlayer: true, deathAttacker: { type: 'player', looting: lvl } }));
  const refs = [];   // reference ItemEntities, spawn order
  const E = [], X = [];
  for (let t = 1; t <= TICKS; t++) {
    EL.tick();
    if (t === DEATH) {
      const r = stream(salt); EL.random = r; Math.random = r;   // the death tick starts the shared Random (idle ticks may draw)
      for (const m of mobs) {
        Cb.dropLoot(m);
        for (const [name, n] of refDrops(m.type, lvl, fire, R)) {
          R();   // ItemEntity.bobOffset (nextFloat), drawn by the entity constructor before the pop velocity
          const vx = R() * 0.2 - 0.1, vz = R() * 0.2 - 0.1;
          refs.push({ x: m.x, y: m.y, z: m.z, vx, vy: 0.2, vz, count: n, age: 0, pd: 10, id: Items.of(name), born: t });
        }
      }
    } else for (const q of refs) {   // ItemEntity.tick, airborne: pickupDelay--, vy -= 0.04, move, drag 0.98 (spawned this tick = no tick yet)
      q.age++; if (q.pd > 0) q.pd--;
      q.vy -= 0.04; q.x += q.vx; q.y += q.vy; q.z += q.vz; q.vx *= 0.98; q.vy *= 0.98; q.vz *= 0.98;
    }
    const items = EL.all().filter((e) => e.type === 'item');
    E.push({ tick: t, entities: items.map((e) => ['item', e.x, e.y, e.z, e.vx, e.vy, e.vz, e.count, e.age, e.pickupDelay, e.item]) });
    X.push({ tick: t, entities: refs.map((q) => ['item', q.x, q.y, q.z, q.vx, q.vy, q.vz, q.count, q.age, q.pd, q.id]) });
  }
  return { E, X, n: refs.length };
}
const diff = (s) => compareTraces(s.X, s.E, { fields: ['entities'] });
let total = 0;
for (let salt = 0; salt < 20; salt++) {
  const s = scenario(salt), d = diff(s); total += s.n;
  ok(!d, 'salt ' + salt + (d ? ` tick ${d.tick} ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}` : ''));
}
ok(total > 20, 'the 20 salts dropped something (' + total + ' stacks)');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const tb = L.table('entities/zombie'); const fn = tb.pools[0].entries[0].functions[0];
fn.count.max = 3;
{ let t = null; for (let s = 0; s < 20 && t === null; s++) { const d = diff(scenario(s)); if (d) t = d.tick; } brk(t === DEATH, `rotten_flesh 0-2 -> 0-3 reported at the death tick (${t})`); }
fn.count.max = 2;
const tc = L.table('entities/cow').pools[1].entries[0].functions[1]; const was = tc.conditions;
tc.conditions = [];   // beef no longer cooks on a burning cow
{ let t = null; for (let s = 0; s < 20 && t === null; s++) { const d = diff(scenario(s)); if (d) t = d.tick; } brk(t === DEATH, `furnace_smelt dropped from burning cow reported at the death tick (${t})`); }
tc.conditions = was;
console.log(`lockstep-loot: ${20 + breaks + 1} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
