// xporblockstepcheck.mjs -- #6289 (G17-L41): lockstep scenario 'xporb': a cow xporbed to a scripted player / a fence knot, the holder walks away; 20 salts.
// Reference = .decomp PathAwareEntity.updateLeash (:39-72) after MobEntity.updateLeash (:1173): float distanceTo; > 10 -> detachLeash(true,true) (Items.lead dropped);
// > 6 -> velocity += copySign(d*d*0.4, d) per axis, d = (holder - mob) / (double)dist. Per tick: xporb holder, vel, lead drops through lockstep/trace.mjs compareTraces.
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
const { EntityList: EL, Xp } = M;
if (Xp.init) Xp.init();
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 60;
// Reference = .decomp ExperienceOrbEntity.tick (:56-115): gravity -0.03; age%20==1 re-targets a player within 8.0; target pull
// (to y + eye/2) = normalize * (1-d/8)^2 * 0.1 while d^2 < 64; move; drag 0.98 (air). Free fall (no floor) isolates the pull.
function run(salt, radius) {
  EL.list.length = 0;
  const r = stream(salt); EL.random = r; Math.random = r;
  M.Player = { x: 0, y: 100, z: 0, eyeHeight: 1.62, dead: false };
  const R = [], E = [], vals = [1, 3, 17];
  const px = (r() - 0.5) * 16, pz = (r() - 0.5) * 16, py = 100 + (r() - 0.5) * 6;
  M.Player.x = 0; M.Player.y = py; M.Player.z = 0;
  const orbs = vals.map((v, i) => {
    const e = EL.spawn('experience_orb', px, py + 1, pz, { vx: 0, vy: 0, vz: 0 });
    e.value = v; e.pickingCount = 1; e.orbAge = 0; e.vx = e.vy = e.vz = 0; return e;
  });
  const ref = orbs.map((e) => ({ x: e.x, y: e.y, z: e.z, vx: 0, vy: 0, vz: 0, tgt: false, age: 0 }));
  for (let t = 1; t <= TICKS; t++) {
    EL.tick();
    ref.forEach((o, i) => {
      o.vy -= 0.03; o.age++;
      const eye = py + 1.62 / 2;
      if (o.age % 20 === 1) o.tgt = ((o.x) ** 2 + (py - o.y) ** 2 + (o.z) ** 2) <= radius * radius;
      if (o.tgt) {
        const dx = -o.x, dy = eye - o.y, dz = -o.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 64) { const d = Math.sqrt(d2), k = (1 - d / 8) ** 2 * 0.1; o.vx += dx / d * k; o.vy += dy / d * k; o.vz += dz / d * k; }
      }
      o.x += o.vx; o.y += o.vy; o.z += o.vz; o.vx *= 0.98; o.vy *= 0.98; o.vz *= 0.98;
    });
    orbs.forEach((e, i) => {
      E.push({ tick: t * 3 + i, pos: [e.x, e.y, e.z], vel: [e.vx, e.vy, e.vz] });
      R.push({ tick: t * 3 + i, pos: [ref[i].x, ref[i].y, ref[i].z], vel: [ref[i].vx, ref[i].vy, ref[i].vz] });
    });
  }
  return compareTraces(R, E, { fields: ['pos', 'vel'] });
}
for (const s of salts) { const d = run(s, 8); ok(!d, 'pull salt ' + s + (d ? ` tick ${d.tick} ${d.field} ${d.a} vs ${d.b}` : '')); }
// pile of 6 identical orbs merges by pickingCount; a lone orb despawns at 6000
for (const s of salts) {
  EL.list.length = 0; M.Player = { x: 500, y: 100, z: 500, eyeHeight: 1.62 };
  const os = [];
  for (let i = 0; i < 6; i++) { const e = EL.spawn('experience_orb', 0.5, 100, 0.5, { vx: 0, vy: 0, vz: 0 }); e.value = 3; e.pickingCount = 1; e.orbAge = 0; os.push(e); }
  for (let t = 0; t < 22; t++) EL.tick();
  const live = EL.list.filter((e) => e.type === 'experience_orb' && !e.removed);
  ok(live.length === 1 && live[0].pickingCount === 6, 'merge salt ' + s + ' live ' + live.length + ' count ' + (live[0] && live[0].pickingCount));
}
{
  EL.list.length = 0; M.Player = { x: 500, y: 100, z: 500, eyeHeight: 1.62 };
  const e = EL.spawn('experience_orb', 0.5, 100, 0.5, { vx: 0, vy: 0, vz: 0 }); e.value = 1; e.pickingCount = 1; e.orbAge = 0;
  let gone = 0; for (let t = 1; t <= 6000 && !gone; t++) { EL.tick(); if (e.removed) gone = t; }
  ok(gone === 6000, 'despawn at tick ' + gone);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const fr = Xp.FOLLOW_RANGE_SQ; Xp.FOLLOW_RANGE_SQ = 49;
{ let n = 0; for (const s of salts) if (run(s, 8)) n++; brk(n > 0, 'pull radius 8.0 -> 7.0 reported at the first divergent tick (' + n + '/20 salts)'); }
Xp.FOLLOW_RANGE_SQ = fr;
console.log(`lockstep-xporb: ${20 * 2 + 21 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
