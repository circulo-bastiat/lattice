// lockstep-angerspread -- #6797 (G17-L146): Angerable (.decomp Angerable.java, ZombifiedPiglinEntity, WolfEntity, BeeEntity): hit one of 5 piglins / a wolf pack / a bee; angerTime in the 20..39 s range (400..780 ticks, TimeHelper.betweenSeconds), group alert box (followRange,10,followRange), tame/owner gate, universalAnger gamerule, forgive/decrement. 20 salts.
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
// reference constants (Angerable / TimeHelper.betweenSeconds(20,39)): 400..780 ticks inclusive
const LO = 400, HI = 780, ALERT_Y = 10;
let rule = 'false';
M.Commands = Object.assign(M.Commands || {}, { ruleGet: (n) => (n === 'universalAnger' ? rule : 'false') });
function mk(type, x, z, extra) { const e = EL.spawn(type, x, 0, z); Object.assign(e, extra || {}); return e; }
function hit(e, rnd, pack, withUniversal) {
  M.Player = { x: 0, y: 0, z: 0, width: 0.6, height: 1.8 };
  e.lastHurtByEntity = M.Player; e.hurtSeq = (e.hurtSeq || 0) + 1;
  const g = new M.Ai.HurtByTargetGoal(e, rnd, () => pack.filter((o) => o !== e));
  if (g.canUse()) g.start();
  if (withUniversal) { const u = new M.Ai.UniversalAngerGoal(e, rnd, true, () => pack.filter((o) => o !== e)); if (u.canUse()) u.start(); }
}
function lane(salt, mode) {
  EL.list.length = 0; const rnd = stream(salt + 3); EL.random = stream(salt + 9);
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const type = mode === 'wolf' ? 'wolf' : mode === 'bee' ? 'bee' : 'zombified_piglin';
  const pack = [];
  for (let i = 0; i < 5; i++) pack.push(mk(type, i * 4 + (salt % 3), (i * 7) % 11, { y: i === 4 ? 14 + (salt % 2) * 20 : 0 }));
  const v = pack[0];
  hit(v, rnd, pack, false);
  if (!(v.angerTime >= LO && v.angerTime <= HI)) note(`${mode} angerTime ${v.angerTime} outside ${LO}..${HI}`);
  if (v.target !== M.Player) note('victim target not set');
  const fr = M.Ai.followRangeOf(v);
  for (const o of pack.slice(1)) {
    const want = Math.abs(o.x - v.x) <= fr && Math.abs(o.z - v.z) <= fr && Math.abs(o.y - v.y) <= ALERT_Y;
    if (!!o.target !== want) note(`${mode} neighbour at dx=${o.x - v.x} dy=${o.y - v.y}: target ${!!o.target}, reference ${want}`);
  }
  // universal anger gamerule: only fires when true; always re-rolls in range for the pack in the box
  const w = pack[1]; w.angerTime = 0; w.target = null; w.lastHurtByEntity = null;
  rule = 'false'; const u0 = new M.Ai.UniversalAngerGoal(v, rnd, true, () => pack.filter((o) => o !== v));
  v.lastHurtByEntity = M.Player; v.hurtSeq = (v.hurtSeq || 0) + 1;
  if (u0.canUse()) note('universalAnger false but goal can start');
  rule = 'true'; if (!u0.canUse()) note('universalAnger true but goal cannot start');
  u0.start();
  if (!(v.angerTime >= LO && v.angerTime <= HI) || v.angryAt !== null) note('universal re-roll out of range');
  if (mode !== 'bee' && Math.abs(w.x - v.x) <= fr && Math.abs(w.z - v.z) <= fr && !(w.angerTime >= LO && w.angerTime <= HI)) note('universal neighbour not angered');
  rule = 'false';
  return bad;
}
for (let s = 0; s < 20; s++) for (const m of ['piglin', 'wolf', 'bee']) { const r = lane(s, m); ok(!r, `angerspread salt ${s} ${m}: ${r}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const sMax = M.Ai.ANGER_TIME_MAX, sMin = M.Ai.ANGER_TIME_MIN;
M.Ai.ANGER_TIME_MAX = 1200;
{ let r = null; for (let s = 0; s < 20 && !r; s++) r = lane(s, 'wolf'); brk(!!r, `anger range 20..60 s reported: ${r}`); }
M.Ai.ANGER_TIME_MAX = sMax; M.Ai.ANGER_TIME_MIN = 100;
{ let r = null; for (let s = 0; s < 20 && !r; s++) r = lane(s, 'piglin'); brk(!!r, `anger range 5..39 s reported: ${r}`); }
M.Ai.ANGER_TIME_MIN = sMin;
console.log(`lockstep-angerspread: ${60 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
