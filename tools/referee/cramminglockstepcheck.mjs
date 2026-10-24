// cramminglockstepcheck.mjs -- #6299 (G17-L51): lockstep scenario 'cramming': 30 cows in a 1x1 pen, 200 ticks, 20 salts.
// Reference = .decomp LivingEntity.tickCramming (:2622) + Entity.pushAwayFrom (:1269), cows in entity tick order; damage 6.0 on >24 colliding, 1 tick in 4. Per tick: cow 0 pos/vel/health + `entities` (the other 29) through compareTraces.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Combat: CB } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const N = 30, TICKS = 200, W = 0.9, H = 1.4, f = Math.fround;
// salt % 3 == 0: only 25 cows in the pile (24 others each = the exact threshold), the other 5 stand a block away
const place = (salt) => { const r = stream(salt), sp = 0.2 + (salt % 8) * 0.12, K = salt % 3 === 0 ? 25 : N; return Array.from({ length: N }, (_, i) => [r() * sp + (i < K ? 0 : 1.6), r() * sp]); };
// shared script after each full pass: pos += vel, vel *= 0.5 (keeps cows inside the pen and the push alive)
const step = (c) => { c.x += c.vx; c.z += c.vz; c.vx *= 0.5; c.vz *= 0.5; };
const overlap = (a, b) => a.x - W / 2 < b.x + W / 2 && a.x + W / 2 > b.x - W / 2 && a.z - W / 2 < b.z + W / 2 && a.z + W / 2 > b.z - W / 2;
function pushFrom(a, b) {   // a.pushAwayFrom(b): b is the ticking cow's `this` -> LivingEntity.pushAway(other) = other.pushAwayFrom(this)
  let d1 = b.x - a.x, d2 = b.z - a.z, d3 = Math.max(Math.abs(d1), Math.abs(d2));
  if (d3 >= f(0.01)) {
    d3 = Math.sqrt(d3); d1 /= d3; d2 /= d3;
    let d4 = 1 / d3; if (d4 > 1) d4 = 1;
    d1 *= d4; d2 *= d4; d1 *= f(0.05); d2 *= f(0.05);
    a.vx -= d1; a.vz -= d2;
    b.vx += d1; b.vz += d2;
  }
}
const row = (t, cows, dmg) => ({ tick: t, pos: [cows[0].x, 0, cows[0].z], vel: [cows[0].vx, 0, cows[0].vz], health: 10 - dmg[0],
  entities: cows.slice(1).map((c, i) => ['cow', c.x, 0, c.z, c.vx, 0, c.vz, 10 - dmg[i + 1]]) });
function reference(salt, max = 24) {
  const r = stream(salt + 100), P = place(salt), rows = [], dmg = new Array(N).fill(0);
  const cows = P.map(([x, z]) => ({ x, z, vx: 0, vz: 0 }));
  for (let t = 1; t <= TICKS; t++) {
    for (const e of cows) {
      const hit = cows.filter((o) => o !== e && overlap(e, o));
      if (!hit.length) continue;
      if (max > 0 && hit.length > max - 1 && Math.floor(r() * 4) === 0) dmg[cows.indexOf(e)] += 6;   // all free: > max-1 colliding
      for (const o of hit) pushFrom(o, e);
    }
    cows.forEach(step);
    rows.push(row(t, cows, dmg));
  }
  return rows;
}
function engine(salt) {
  cells.clear(); EL.list.length = 0;
  const P = place(salt), dmg = new Array(N).fill(0);
  const cows = P.map(([x, z]) => { const e = EL.spawn('cow', x, 0, z); e.persistent = true; return e; });
  EL.random = Math.random = stream(salt + 100);   // after spawn: spawning draws too
  const oh = CB.hurt; CB.hurt = (e, a) => { dmg[cows.indexOf(e)] += a; return true; };
  const rows = [];
  for (let t = 1; t <= TICKS; t++) {
    for (const e of cows) EL.pushAround(e);
    cows.forEach(step);
    rows.push(row(t, cows, dmg));
  }
  CB.hurt = oh;
  return rows;
}
const first = (salt) => compareTraces(reference(salt), engine(salt), { fields: ['pos', 'vel', 'health', 'entities'] });
const bad = salts.map((s) => [s, first(s)]).filter(([, d]) => d);
ok(!bad.length, 'cramming lane: ' + bad.slice(0, 3).map(([s, d]) => `salt ${s} tick ${d.tick} ${d.field} ${d.a} vs ${d.b}`));
const R0 = reference(3);
ok(R0.some((r) => r.entities.some((e) => e[7] < 10)) || R0.some((r) => r.health < 10), 'reference: somebody is crushed');
ok(R0[5].entities.some((e) => e[4] !== 0), 'reference: cows are pushed');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
EL.maxEntityCramming = 25;
const hit = salts.map((s) => first(s)).find(Boolean);
brk(!!hit, 'maxEntityCramming 25 instead of 24 is reported' + (hit ? ' at tick ' + hit.tick : ''));
EL.maxEntityCramming = undefined;
const pp = M.Physics.PUSH_SCALE; M.Physics.PUSH_SCALE = 0.06;
brk(!!first(0), 'push scale 0.06 instead of 0.05 is reported'); M.Physics.PUSH_SCALE = pp;
console.log(`cramminglockstepcheck: ${20 + 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
