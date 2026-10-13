// lockstep-egglay -- #6327 (G17-L67): lockstep scenario 'egglay', 20 salts: one adult chicken in a fenced pen for 13000 ticks, then a baby for 24000.
// Reference = .decomp Chicken.aiStep (eggTime-- ; <=0 -> playSound, spawnAtLocation(EGG), eggTime = nextInt(6000)+6000; not for babies/jockeys) and AgeableMob.aiStep (age++ toward 0, baby start -24000).
// The reference replays the timer from the first observed value: the egg must drop on exactly the tick the countdown hits 0, every reset must land in 6000..11999, a baby never lays, and its age reaches 0 after 24000 ticks.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
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
M.Mount.init();
const { EntityList: EL, Mount: Mn, Passive: Ps } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) w.set(x, -1, z, stone);
  for (let i = -3; i <= 3; i++) for (const [x, z] of [[i, -3], [i, 3], [-3, i], [3, i]]) for (let y = 0; y < 2; y++) w.set(x, y, z, stone);
}
const ADULT_TICKS = 13000, BABY_TICKS = 24000;
let seen = new Set();   // item entities are tracked by identity: an egg despawns after 6000 ticks, the count of eggs ever seen must not
const eggs = () => { for (const x of EL.list) if (x.type === 'item' && x.item === 'egg') seen.add(x); return seen.size; };
function lane(salt, fault) {
  floor(); seen = new Set();
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn('chicken', 0.5, 0, 0.5);
  e.persistent = true;
  const start = e.eggLayTime; let want = start, wantEggs = 0, bad = null, first = null; const laid = [];
  const note = (m) => { if (!bad) bad = m; };
  for (let t = 1; t <= ADULT_TICKS; t++) {
    const prev = e.eggLayTime;
    EL.tick();
    want = fault && t === 1 ? want : want - 1;
    const n = eggs();
    if (want <= 0) {   // reference: the egg drops now, the timer re-rolls in 6000..11999 (6000+nextInt(6000))
      wantEggs++; laid.push(t);
      if (e.eggLayTime < 6000 || e.eggLayTime > 11999) note(`tick ${t} reset ${e.eggLayTime} outside 6000..11999`);
      want = e.eggLayTime;
    }
    if (n !== wantEggs) note(`tick ${t} egg items ${n} vs ${wantEggs}`);
    if (e.eggLayTime !== want) note(`tick ${t} eggTime ${e.eggLayTime} vs ${want} (was ${prev})`);
    if (bad) break;
  }
  if (!bad && !laid.length) note('no egg in 13000 ticks');
  return { bad, laid, start };
}
function baby(salt) {
  floor(); seen = new Set();
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn('chicken', 0.5, 0, 0.5);
  e.persistent = true; M.Breed.setBaby(e, true);
  const n0 = eggs(); let age = -24000;
  for (let t = 1; t <= BABY_TICKS; t++) {
    EL.tick(); age++;
    if (e.growAge !== age) return `tick ${t} age ${e.growAge} vs ${age}`;
    if (t < BABY_TICKS && eggs() !== n0) return `baby laid at tick ${t}`;
  }
  return e.growAge === 0 && M.Breed.isBaby(e) === false ? null : 'not adult after 24000';
}
const salts20 = salts;
for (const s of salts20) { const r = lane(s); ok(!r.bad, 'egglay salt ' + s + ' ' + r.bad); }
for (const s of [0, 1, 2]) { const b = baby(s); ok(!b, 'baby salt ' + s + ' ' + b); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const rt = Ps.rollEggTimer; Ps.rollEggTimer = () => 5999;   // 6000+5999 style: a reset under the 6000 floor
{ const r = lane(3); brk(!!r.bad, `6000+5999 style reset reported: ${r.bad}`); }
Ps.rollEggTimer = rt;
{ const r = lane(3, true); brk(!!r.bad, `timer off by one reported: ${r.bad}`); }
const tc = Ps.tickChicken; Ps.tickChicken = (e, rnd) => { const x = tc(e, rnd); return false; };
{ const r = lane(4); brk(!!r.bad, `egg never dropped reported: ${r.bad}`); }
Ps.tickChicken = tc;
console.log(`lockstep-egglay: ${20 + 3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
