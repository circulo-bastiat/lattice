// lockstep-cure -- #6679 (G17-L108): lockstep scenario 'cure', 20 salts: zombie_villager + golden apple needs Weakness; conversion 3600+nextInt(2401), per-tick rate (iron bars/beds), villager data kept.
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
const { EntityList: EL, Passive: Ps, Tame: Tm, Breed: Br, Use, Inventory: Iv } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
// Reference = the vanilla 2-ingredient shapeless dye recipes SheepEntity.getChildColor finds through a 2x1 CraftingInventory (order-free); no match -> nextBoolean() picks a parent.
const MIX = { 'red+yellow': 'orange', 'pink+purple': 'magenta', 'blue+white': 'light_blue', 'green+white': 'lime', 'red+white': 'pink', 'black+white': 'gray', 'gray+white': 'light_gray', 'blue+green': 'cyan', 'blue+red': 'purple' };
const mixOf = (a, b) => MIX[[a, b].sort().join('+')] || null;

const Zv = M.ZVillager, Ef = M.Effects;
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) w.set(x, -1, z, stone);
}
// Reference (ZombieVillagerEntity.interactMob/tick/getConversionRate, .decomp): one stream, same draw order as the server.
function ref(rs, rnd, bars) {
  const start = rs() * 2401 | 0; let timer = 3600 + start, n = 0;
  for (;;) {
    n++; let rate = 1;
    if (rnd() < 0.01) { let c = 0;
      for (let dx = -4; dx < 4 && c < 14; dx++) for (let dy = -4; dy < 4 && c < 14; dy++) for (let dz = -4; dz < 4 && c < 14; dz++)
        if (bars.has((dx) + ',' + (dy) + ',' + (dz))) { if (rnd() < 0.3) rate++; c++; } }
    timer -= rate; if (timer <= 0 || n > 20000) return { start, n };
  }
}
function lane(salt) {
  floor(); let bad = null; const note = (m) => { if (!bad) bad = m; };
  const seed = salt + 900, a = stream(seed), b = stream(seed), a2 = stream(seed + 77), b2 = stream(seed + 77);
  const bars = new Set(), ib = M.States.stateOf('iron_bars');
  const nb = salt % 5 === 0 ? 0 : (salt % 20) + 1 + (salt > 12 ? 0 : 0);   // up to 20 bars: the 14 cap matters
  for (let i = 0; i < nb; i++) { const dx = (i % 5) - 2, dy = Math.floor(i / 5) % 4, dz = 2; bars.add(dx + ',' + dy + ',' + dz); w.set(dx, dy, dz, ib); }
  const z = EL.spawn('zombie_villager', 0.5, 0, 0.5, { profession: 'librarian', villagerType: 'snow', villagerLevel: 3, tradeXp: 17 });
  z.persistent = true;
  z.gossip = { major_positive: 5 }; z.tradeOffers = [1, 2]; z.tradeUses = [0, 1];
  const inv = Iv.create(); const apple = { i: M.Items.of('golden_apple'), n: 2 }; Iv.setItem(inv, 0, apple);
  const P = { x: 0, y: 0, z: 3, uuid: 'p' + salt, inventory: inv, slot: 0, instabuild: false, targetEntity: z };
  EL.random = () => a2(); M.fbRand = () => a();
  Use.entityUse(P, z, apple);
  if (z.converting || apple.n !== 2) note(`apple without Weakness: converting=${z.converting} left=${apple.n}`);
  Ef.addStatusEffect(z, 'weakness', 200, 0);
  Use.entityUse(P, z, apple);
  const r = ref(() => b(), () => b2(), bars);
  const wantStart = 3600 + r.start;
  if (!z.converting) note('not converting after apple with Weakness');
  if (z.conversionTimer !== wantStart) note(`conversionTime ${z.conversionTimer} vs ${wantStart}`);
  if (apple.n !== 1) note(`apple left ${apple.n} vs 1`);
  if (Ef.hasStatusEffect(z, 'weakness')) note('Weakness not removed');
  if (!Ef.hasStatusEffect(z, 'strength')) note('Strength not added');
  else if (z.effects.strength.amplifier !== 0) note('Strength amplifier ' + z.effects.strength.amplifier);
  let t = 0, v = null;
  for (; t < 20000 && !v; t++) { Zv.tickOne(z); if (z.removed || z.dead || EL.list.indexOf(z) < 0) v = EL.list.find((e) => e.type === 'villager'); }
  if (t !== r.n) note(`converted at tick ${t} vs ${r.n}`);
  if (!v) { note('no villager'); return { bad }; }
  if (v.profession !== 'librarian' || v.villagerType !== 'snow' || v.villagerLevel !== 3 || v.tradeXp !== 17) note(`villager data ${v.profession}/${v.villagerType}/${v.villagerLevel}/${v.tradeXp}`);
  if (JSON.stringify(v.tradeOffers) !== '[1,2]' || JSON.stringify(v.tradeUses) !== '[0,1]') note('offers lost');
  if (!v.gossip || v.gossip.major_positive !== 25 || v.gossip.minor_positive !== 25) note('gossip lost ' + JSON.stringify(v.gossip));
  if (Math.abs(v.x - 0.5) > 1e-9 || Math.abs(v.z - 0.5) > 1e-9) note('villager position');
  if (v.health !== v.maxHealth) note('villager health');
  if (!Ef.hasStatusEffect(v, 'nausea') || v.effects.nausea.duration !== 200) note('nausea 200 missing');
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'cure salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = (re) => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return !!h && re.test(h) ? h : null; };
{ const sv = Zv.CURE_TIMER_MIN; Zv.CURE_TIMER_MIN = 3000; const h = first(/conversionTime/); brk(!!h, `start roll 3600 -> 3000: ${h}`); Zv.CURE_TIMER_MIN = sv; }
{ const sv = Zv.CURE_TIMER_RANGE; Zv.CURE_TIMER_RANGE = 2400; const h = first(/conversionTime/); brk(!!h, `start roll range 2401 -> 2400: ${h}`); Zv.CURE_TIMER_RANGE = sv; }
{ const sv = Zv.RATE_SCAN_CAP; Zv.RATE_SCAN_CAP = 99; const h = first(/converted at tick/); brk(!!h, `no 14-block cap: ${h}`); Zv.RATE_SCAN_CAP = sv; }
{ const sv = Zv.dataToVillager; Zv.dataToVillager = (z) => Object.assign(sv(z), { gossip: undefined }); const h = first(/gossip/); brk(!!h, `gossip dropped: ${h}`); Zv.dataToVillager = sv; }
{ const sv = Zv.applyGoldenApple; Zv.applyGoldenApple = (e, c, r, io) => sv(e, c, r, Object.assign({}, io, { hasWeakness: () => true })); const h = first(/without Weakness/); brk(!!h, `Weakness not required: ${h}`); Zv.applyGoldenApple = sv; }
console.log(`lockstep-cure: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
