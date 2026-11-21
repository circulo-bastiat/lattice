// lockstep-skeletontrap -- #6782 (G17-L137): SkeletonHorseTrapTriggerGoal (.decomp): canStart = player within 10.0 blocks, trapTime++ per tick (discard at 18000), then tick(): untrap, tame, age 0, cosmetic bolt, trap-horse rider + 3 horses each with a rider. 20 salts x 3 difficulties.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02h_recipes.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
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

const { EntityList: EL } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const RANGE = 10;   // reference: SkeletonHorseTrapTriggerGoal.canStart isPlayerInRange(.., 10.0)
// One lane: player walks in from 14 blocks at 0.1/tick; reference springs on the first tick the distance <= RANGE.
function lane(salt, diff, range) {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) w.set(x, -1, z, stone);
  M.Diff = { get: () => diff }; EL.random = stream(salt + 7);
  const px0 = 14 + (salt % 3);
  M.Player = { x: px0, y: 0, z: 0.5 };
  const h = EL.spawn('skeleton_horse', 0.5, 0, 0.5); h.trapped = true; h.trapTime = 0;
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  let wantSpring = -1, sprung = -1, base = 0;
  for (let t = 0; t < 140 && !bad; t++) {
    M.Player.x = px0 - 0.1 * t;
    const d = M.Player.x - 0.5;
    if (wantSpring < 0 && d * d + 0.25 * 0 <= RANGE * RANGE) wantSpring = t;   // dy = 0, dz = 0
    const before = EL.list.length;
    M.Lightning.tickTrap(h);
    if (sprung < 0 && !h.trapped) {
      sprung = t;
      const nl = EL.list.slice(before), c = (ty) => nl.filter((e) => e.type === ty);
      if (c('lightning_bolt').length !== 1 || !c('lightning_bolt')[0].cosmetic) note('bolt missing or not cosmetic');
      if (c('skeleton').length !== 4) note('skeletons ' + c('skeleton').length);
      if (c('skeleton_horse').length !== 3) note('reinforcement horses ' + c('skeleton_horse').length);
      if (!h.tamed) note('horse not tamed');
      for (const sk of c('skeleton')) { if (!sk.persistent) note('rider not persistent'); }
      for (const hh of c('skeleton_horse')) if (!hh.tamed || !hh.persistent) note('reinforcement not tame/persistent');
      base = before;
    }
    if (sprung < 0 && h.trapTime !== t + 1) note(`tick ${t} trapTime ${h.trapTime}`);
    if (sprung >= 0) { for (const e of EL.list.slice(base)) if (!Number.isFinite(e.x + e.y + e.z)) note('nan pos'); if (t - sprung >= 40) break; }
  }
  if (!bad && sprung !== wantSpring) bad = `sprang at ${sprung}, reference ${wantSpring}`;
  return bad;
}
for (let s = 0; s < 20; s++) for (const d of ['easy', 'normal', 'hard']) { const r = lane(s, d); ok(!r, `skeletontrap salt ${s} ${d}: ${r}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const saved = M.Lightning.TRAP_TRIGGER_RANGE;
M.Lightning.TRAP_TRIGGER_RANGE = 8;
{ const r = lane(1, 'normal'); brk(!!r, `range 8 reported: ${r}`); }
{ const r = lane(5, 'hard'); brk(!!r, `range 8 reported on another salt: ${r}`); }
M.Lightning.TRAP_TRIGGER_RANGE = saved;
console.log(`lockstep-skeletontrap: ${60 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
