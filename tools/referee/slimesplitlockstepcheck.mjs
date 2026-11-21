// Reference = .decomp PathAwareEntity.updateLeash (:39-72) after MobEntity.updateLeash (:1173): float distanceTo; > 10 -> detachLeash(true,true) (Items.lead dropped);
// > 6 -> velocity += copySign(d*d*0.4, d) per axis, d = (holder - mob) / (double)dist. Per tick: leash holder, vel, lead drops through lockstep/trace.mjs compareTraces.
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
// slimesplitlockstepcheck.mjs -- #6318 (G17-L64): lockstep scenario 'slimesplit': a size 4 / 2 / 1 slime and a size 2 magma_cube die at a scripted tick; 20 salts.
// Reference = .decomp SlimeEntity.remove (:183-210): size>1 && dead -> count = 2 + nextInt(3), child size = size/2, offsets ((k%2)-0.5f)*size/4f and ((k/2)-0.5f)*size/4f,
// child at (x+ox, y+0.5, z+oz); setSize: health = size^2 (MAX_HEALTH), speed 0.2+0.1*size, magma armor 3*size. Per tick: children count, size, pos, health, through compareTraces.
const { EntityList: EL, Slime: Sl } = M;
if (Sl.init) Sl.init();
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let a = (salt * 2654435761 + 12345) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 12, f = Math.fround;
const LANES = [['slime', 4], ['slime', 2], ['slime', 1], ['magma_cube', 2]];
const deathTick = (salt, i) => 3 + ((salt + i) % 5);
const spawnAt = (salt, i) => [salt * 1.5 + i * 10, 64, salt * 0.5 - i * 7];
// reference: the same draw order as the vanilla method (count first, then one yaw draw per child)
function reference(salt, i, r) {
  const [type, size] = LANES[i], [x, y, z] = spawnAt(salt, i), dt = deathTick(salt, i), rows = [];
  let kids = [];
  for (let t = 1; t <= TICKS; t++) {
    if (t === dt && size > 1) {
      const n = 2 + Math.floor(r() * 3), q = f(size / 4), cs = (size / 2) | 0;
      for (let k = 0; k < n; k++) {
        kids.push({ size: cs, pos: [x + f(f(k % 2 - 0.5) * q), y + 0.5, z + f(f(Math.floor(k / 2) - 0.5) * q)], hp: cs * cs });
        r();
      }
    }
    rows.push({ tick: t, dead: t >= dt, kids: kids.map((c) => ({ ...c })) });
  }
  return rows;
}
function engine(salt, i, r, r2 = () => r) {
  const [type, size] = LANES[i], [x, y, z] = spawnAt(salt, i), dt = deathTick(salt, i), rows = [];
  cells.clear(); EL.list.length = 0; EL.random = r; Math.random = r;
  const e = EL.spawn(type, x, y, z, { size }); e.persistent = true;
  EL.random = r2(); Math.random = EL.random;   // spawn's own draws (size roll, AI) are not the split's: the split starts on a fresh stream
  for (let t = 1; t <= TICKS; t++) {
    if (t === dt) { e.dead = true; EL.remove(e); }
    const kids = EL.list.filter((q) => q !== e && q.type === type).map((q) => ({ size: q.size, pos: [q.x, q.y, q.z], hp: q.health }));
    rows.push({ tick: t, dead: t >= dt, kids });
  }
  return rows;
}
const fm = (c) => `${c.size}@${c.pos.map((v) => v.toFixed(4))}:${c.hp}`;
const norm = (rows) => rows.map((r) => ({ tick: r.tick, goals: [[0, r.dead ? 'dead' : 'alive'], [1, 'n' + r.kids.length], ...r.kids.map((c, j) => [2 + j, fm(c)])] }));
function lane(salt, i) {
  const R = reference(salt, i, stream(salt + 100)), E = engine(salt, i, stream(salt + 100), () => stream(salt + 100));
  return { d: compareTraces(norm(R), norm(E), { fields: ['goals'] }), R };
}
const report = (res) => res.map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3);
LANES.forEach((L, i) => {
  const res = salts.map((salt) => ({ salt, ...lane(salt, i) }));
  ok(res.every((r) => !r.d), L.join(' ') + ' lane: ' + JSON.stringify(report(res.filter((r) => r.d))));
  const counts = new Set(res.map((r) => r.R[TICKS - 1].kids.length));
  if (L[1] > 1) ok(counts.has(2) && counts.has(3) && counts.has(4), L.join(' ') + ' reference covers 2,3,4 children: ' + [...counts]);
  else ok(counts.size === 1 && counts.has(0), 'size 1 never splits');
});
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const any = () => LANES.some((_, i) => salts.some((s) => lane(s, i).d));
const os = Sl.split;
Sl.split = (e, sp) => { const o = EL.random; EL.random = () => Math.floor(o() * 2) / 3; os(e, sp); EL.random = o; };
brk(any(), '2 + nextInt(2) instead of nextInt(3) is reported'); Sl.split = os;
Sl.split = (e, sp) => { const sz = e.size; e.size = sz; os(Object.assign(Object.create(e), { size: sz }), (t, a, b, c, o) => sp(t, a, b + 1, c, o)); };
brk(any(), 'child y jitter off by 1 is reported'); Sl.split = os;
const oset = Sl.setSize;
Sl.setSize = (e, s, h) => { oset(e, s, h); e.health = e.maxHealth = s; };
brk(any(), 'health = size instead of size^2 is reported'); Sl.setSize = oset;
Sl.split = (e, sp) => { if (e.type !== 'magma_cube') os(e, sp); };
brk(any(), 'magma cube not splitting is reported'); Sl.split = os;
console.log(`slimesplitlockstepcheck: ${LANES.length * 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
