// lockstep-hurtbytarget -- #7939 (G18b-L26): RevengeGoal.callSameTypeForRevenge (.decomp RevengeGoal.java, TrackTargetGoal.java): Angerable (.decomp Angerable.java, ZombifiedPiglinEntity, WolfEntity, BeeEntity): hit one of 5 piglins / a wolf pack / a bee; angerTime in the 20..39 s range (400..780 ticks, TimeHelper.betweenSeconds), group alert box (followRange,10,followRange), tame/owner gate, universalAnger gamerule, forgive/decrement. 20 salts.
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
const ALERT_Y = 10;
const TYPES = ['zombified_piglin', 'wolf', 'iron_golem', 'bee', 'llama'];
function mk(type, x, z, extra) { const e = EL.spawn(type, x, 0, z); Object.assign(e, extra || {}); return e; }
// reference callSameTypeForRevenge: same type, no target, not self, tame owner equal, box (fr, 10, fr)
function lane(salt, type, alertOff) {
  EL.list.length = 0; const rnd = stream(salt + 3); EL.random = stream(salt + 9);
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const tameable = type === 'wolf', pack = [];
  for (let i = 0; i < 6; i++) pack.push(mk(type, i * 4 + (salt % 3), (i * 7) % 11, { y: i === 4 ? 14 + (salt % 2) * 20 : 0 }));
  if (tameable) { pack[1].tamed = true; pack[1].owner = 'p'; pack[2].tamed = true; pack[2].owner = 'p'; }
  pack[3].target = { dummy: 1 };           // already has a target: must keep it
  const decoy = mk('cow', 2, 2, {}); pack.push(decoy);
  const v = pack[0];
  M.Player = { x: 0, y: 0, z: 0, width: 0.6, height: 1.8, type: 'player' };
  v.lastHurtByEntity = M.Player;
  const g = new M.Ai.HurtByTargetGoal(v, rnd, alertOff ? () => [] : () => EL.list.filter((o) => o.type === type && o !== v));
  if (!g.canUse()) note('canUse false with a live attacker');
  g.start();
  if (v.target !== M.Player) note('victim target not set');
  const fr = M.Ai.followRangeOf(v);
  for (const o of pack.slice(1)) {
    let want = o.type === type && !o.target0;
    if (o === pack[3]) want = false; else if (o === decoy) want = false;
    else want = Math.abs(o.x - v.x) <= fr && Math.abs(o.z - v.z) <= fr && Math.abs(o.y - v.y) <= ALERT_Y && !!o.tamed === !!v.tamed;
    const got = o.target === M.Player;
    if (got !== want) note(`${type} neighbour dx=${o.x - v.x} dy=${o.y - v.y} tamed=${!!o.tamed}: chained ${got}, reference ${want}`);
  }
  if (pack[3].target.dummy !== 1) note('existing target overwritten');
  if (v.angerTime !== undefined && ['zombified_piglin', 'wolf', 'iron_golem', 'bee'].includes(type) && !(v.angerTime >= 400 && v.angerTime <= 780)) note('angerTime out of 400..780');
  // goal keeps running while a target lives, stops once cleared, stop() clears the revenge attacker
  if (!g.canContinueToUse()) note('goal stops with a live target');
  g.stop(); if (v.lastHurtByEntity) note('stop() kept attacker');
  v.target = null; if (g.canContinueToUse()) note('goal continues with no target');
  // creative attacker is refused (canTrack of createAttackable)
  v.lastHurtByEntity = { type: 'player', creative: true, gameMode: 1, isCreative: true, x: 0, y: 0, z: 0, width: .6, height: 1.8 };
  return bad;
}
for (let s = 0; s < 20; s++) for (const t of TYPES) { const r = lane(s, t, false); ok(!r, `hurtbytarget salt ${s} ${t}: ${r}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
{ let r = null; for (let s = 0; s < 20 && !r; s++) r = lane(s, 'zombified_piglin', true); brk(!!r, `pack that does not alert reported: ${r}`); }
{ const h = M.Ai.rollAngerTime; M.Ai.rollAngerTime = () => 1200; let r = null; for (let s = 0; s < 20 && !r; s++) r = lane(s, 'bee', false); M.Ai.rollAngerTime = h; brk(!!r, `anger time out of 20..39 s reported: ${r}`); }
{ const a = M.Ai.ALERT_RANGE_Y; M.Ai.ALERT_RANGE_Y = 100; let r = null; for (let s = 0; s < 20 && !r; s++) r = lane(s, 'bee', false); M.Ai.ALERT_RANGE_Y = a; brk(!!r, `widened box height reported: ${r}`); }
console.log(`lockstep-hurtbytarget: ${100 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
