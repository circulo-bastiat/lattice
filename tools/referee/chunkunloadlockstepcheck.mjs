// chunkunloadlockstepcheck.mjs -- #7090 (G17-L227): lockstep scenario 'chunkunload', 20 salts: a cow, a zombie with a fire timer, a dropped item with age and a baby cow in a chunk the scripted player walks away from until it is unloaded, then returns to. Vanilla: ServerWorld.unload saves each entity (Entity.writeNbt), a non-ticking chunk's entities do not tick (so no age, fire, growth or despawn roll), reload reads them back (EntityType.loadEntity). Per tick, exact doubles: the entities field and each entity's x/y/z, health, fire ticks, item age, pickup delay and growth age, on the reload tick and for 100 ticks after, against a run of the same salt that never unloaded (frozen ticks do not advance anything).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const Y = 100;

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js', '07c_blockentity.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const stone = M.States.stateOf('stone');
const w = { get: (x, y, z) => (y < Y ? stone : 0) };
w.getBlock = w.get; w.setBlock = () => {};
w.getLight = () => 0; w.canSeeSky = () => false;
w.chunks = new Map(); w.loadedAt = () => true;
let camCx = 0;
w.tickingAt = (x) => Math.abs((Math.floor(x) >> 4) - camCx) <= 8;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(M.World);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
M.Player.init(); M.Gamemode.set(M.Player, M.Gamemode.CREATIVE);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.Spawn.init(); M.Spawn.ready = true;
if (M.Sky) { M.Sky.darknessNow = () => 0; M.Sky.isThundering = () => false; }
const { EntityList: EL, MobNbt: Mb } = M;
const P = M.Player;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'health', 'remainingFireTicks', 'age', 'pickupDelay', 'growAge'];
const snap = () => EL.list.filter((e) => !e.removed).map((e) => {
  const o = { type: e.type };
  for (const f of FIELDS) if (f === 'age' ? e.type === 'item' : true) o[f] = e[f] === undefined ? null : e[f];
  return JSON.stringify(o);
}).sort();
function setup(salt) {
  EL.list.length = 0; camCx = 0;
  let s = (salt * 2654435761 + 977) >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) / 16777216; };
  Math.random = r; EL.random = r; EL.wr = r;
  P.x = 0.5; P.y = Y + 0.5; P.z = 0.5; P.dead = false; P.health = 20;
  const at = (i) => 2 + i * 1.5;
  EL.spawn('cow', at(0), Y, 3.5, { aiDisabled: true });
  const z = EL.spawn('zombie', at(1), Y, 5.5, { aiDisabled: true });
  z.remainingFireTicks = 60 + (salt * 7) % 200; z.persistent = true;
  const it = EL.spawn('item', at(2), Y, 7.5, { item: 'stone', count: 1 + salt % 5 });
  const b = EL.spawn('cow', at(3), Y, 9.5, { aiDisabled: true }); b.growAge = -(400 + salt * 31);
  for (const e of EL.list) if (e.type === 'item') e.age = 100 + salt * 13;
  return r;
}
const diff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] + ' vs ' + b[i]; return null; };
function lane(salt) {
  const T0 = 40, AWAY = 100 + salt * 3, AFTER = 100;
  // reference: never unloaded; the AWAY ticks do not exist for it
  const rr = setup(salt);
  const ref = [];
  for (let t = 0; t < T0 + AFTER; t++) { EL.tick(); if (t >= T0 - 1) ref.push(snap()); }
  // engine: walk away until unloaded, come back, reload
  setup(salt);
  for (let t = 0; t < T0; t++) EL.tick();
  const pre = snap();
  if (diff(pre, ref[0])) return 'salt ' + salt + ' pre-unload ' + diff(pre, ref[0]);
  camCx = 40;                                      // the chunk is out of simulation distance and unloads
  for (let t = 0; t < AWAY; t++) { EL.tick(); const d = diff(snap(), pre); if (d) return 'salt ' + salt + ' ticked while unloaded, tick ' + t + ' ' + d; }
  const recs = JSON.parse(JSON.stringify(Mb.serializeAll()));
  EL.list.length = 0;
  if (snap().length) return 'salt ' + salt + ' entities not cleared';
  camCx = 0; Mb.restoreAll(recs);                  // the player is back: the chunk loads, its entities are read
  const d0 = diff(snap(), pre);
  if (d0) return 'salt ' + salt + ' reload tick ' + d0;
  for (let t = 1; t <= AFTER; t++) { EL.tick(); const d = diff(snap(), ref[t]); if (d) return 'salt ' + salt + ' tick +' + t + ' ' + d; }
  return null;
}
const run = () => { const bad = []; for (let sl = 0; sl < 20; sl++) { const r = lane(sl); if (r) bad.push(r); } return bad; };
const base = run();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
const realFor = Mb.fieldsFor;
Mb.fieldsFor = (t) => realFor(t).filter((f) => f !== 'remainingFireTicks');
brk(run().length > 0, 'saved fire timer dropped caught');
Mb.fieldsFor = (t) => realFor(t).filter((f) => f !== 'age');
brk(run().length > 0, 'item Age not restored caught');
Mb.fieldsFor = realFor;
console.log(`chunkunloadlockstepcheck: ${1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
