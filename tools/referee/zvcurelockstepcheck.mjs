// lockstep-zvcure -- #7908 (G18f-L7): lockstep scenario 'zvcure', 20 salts, plain AND baby zombie villager; builds on lockstep-cure (#6679): zombie_villager + golden apple needs Weakness; conversion 3600+nextInt(2401), per-tick rate (iron bars/beds), villager data kept.
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
const SND = [];
function lane(salt) {
  floor(); let bad = null; const note = (m) => { if (!bad) bad = m; };
  const baby = salt % 2 === 1;
  const seed = salt + 4100, a = stream(seed), b = stream(seed), a2 = stream(seed + 77), b2 = stream(seed + 77);
  const bars = new Set(), ib = M.States.stateOf('iron_bars');
  const nb = salt % 4 === 0 ? 0 : (salt % 20) + 1;
  for (let i = 0; i < nb; i++) { const dx = (i % 5) - 2, dy = Math.floor(i / 5) % 4, dz = 2; bars.add(dx + ',' + dy + ',' + dz); w.set(dx, dy, dz, ib); }
  const z = EL.spawn('zombie_villager', 0.5, 0, 0.5, { profession: 'cleric', villagerType: 'desert', villagerLevel: 2 + salt % 4, tradeXp: 11 + salt, villager_note: 1 });
  z.persistent = true;
  if (baby) M.Breed.setAge(z, M.Breed.C.babyStartAge);
  const IT = M.Items, Eq = M.Equip;
  const helm = Eq.stackOf('iron_helmet'); Eq.applyEnchants(helm, [{ id: 'binding_curse', lvl: 1 }]);
  const sword = Eq.stackOf('iron_sword');
  Eq.setEquipped(z, IT.HEAD, helm); Eq.setEquipped(z, IT.MAINHAND, sword); Eq.setDropChance(z, IT.MAINHAND, 2.0);
  const hadCurse = M.Combat.enchantLevel(helm, 'binding_curse') > 0;
  z.gossip = { major_positive: 5 }; z.tradeOffers = [1, 2, salt]; z.tradeUses = [0, 1, 2];
  const inv = Iv.create(); const apple = { i: IT.of('golden_apple'), n: 2 }; Iv.setItem(inv, 0, apple);
  const P = { x: 0, y: 0, z: 3, uuid: 'p' + salt, inventory: inv, slot: 0, instabuild: false, targetEntity: z };
  EL.random = () => a2(); M.fbRand = () => a();
  SND.length = 0; M.Sound = { play: (n, o) => SND.push({ n, o }) };
  Use.entityUse(P, z, apple);
  if (z.converting || apple.n !== 2) note(`apple without Weakness: converting=${z.converting} left=${apple.n}`);
  Ef.addStatusEffect(z, 'weakness', 200, 0);
  Use.entityUse(P, z, apple);
  const r = ref(() => b(), () => b2(), bars);
  const want = 3600 + r.start;
  if (z.conversionTimer !== want) note(`conversionTime ${z.conversionTimer} vs ${want}`);
  if (!hadCurse) note('fixture: curse stack not recognised');
  const v1 = b(), v2 = b();
  const s0 = SND[0];
  if (!s0 || s0.n !== 'entity.zombie_villager.cure') note('status-16 cure sound missing');
  else {
    if (Math.abs(s0.o.volume - (1 + v1)) > 1e-9 || Math.abs(s0.o.pitch - (v2 * 0.7 + 0.3)) > 1e-9) note(`cure sound vol/pitch ${s0.o.volume}/${s0.o.pitch}`);
    const wy = baby ? 0.93 : 1.74;
    if (Math.abs(s0.o.y - wy) > 1e-9) note(`cure sound y ${s0.o.y} vs ${wy}`);
  }
  if (!Ef.hasStatusEffect(z, 'strength') || z.effects.strength.amplifier !== 0 || z.effects.strength.duration !== want) note('Strength buff');
  if (Ef.hasStatusEffect(z, 'weakness')) note('Weakness not removed');
  let t = 0, v = null;
  for (; t < 20000 && !v; t++) { Zv.tickOne(z); if (z.removed || z.dead || EL.list.indexOf(z) < 0) v = EL.list.find((e) => e.type === 'villager'); }
  if (t !== r.n) note(`converted at tick ${t} vs ${r.n}`);
  if (!v) { note('no villager'); return { bad }; }
  if (v.profession !== 'cleric' || v.villagerType !== 'desert' || v.villagerLevel !== 2 + salt % 4 || v.tradeXp !== 11 + salt) note(`villager data ${v.profession}/${v.villagerType}/${v.villagerLevel}/${v.tradeXp}`);
  if (JSON.stringify(v.tradeOffers) !== JSON.stringify([1, 2, salt]) || JSON.stringify(v.tradeUses) !== '[0,1,2]') note('offers lost');
  if (!v.gossip || v.gossip.major_positive !== 25 || v.gossip.minor_positive !== 25) note('gossip ' + JSON.stringify(v.gossip));
  const isBaby = (v.growAge | 0) < 0;
  if (isBaby !== baby) note(`baby ${isBaby} vs ${baby}`);
  if (baby && v.growAge !== z.growAge) note(`baby age ${v.growAge} vs ${z.growAge}`);
  if (!v.villagerInventory || v.villagerInventory[3] !== helm) note('cursed helmet not re-homed to slot 3');
  if (v.villagerInventory && v.villagerInventory.some((s, i) => s && i !== 3)) note('extra stack kept');
  if (Eq.getEquipped(z, IT.HEAD) || Eq.getEquipped(z, IT.MAINHAND)) note('zombie equipment not cleared');
  const drops = EL.list.filter((e) => e.type === 'item' || e.type === 'item_entity');
  if (drops.length !== 1) note('guaranteed-drop sword: ' + drops.length + ' drops');
  if (!Ef.hasStatusEffect(v, 'nausea') || v.effects.nausea.duration !== 200) note('nausea 200 missing');
  const s1 = SND[SND.length - 1];
  if (!s1 || s1.n !== 'entity.zombie_villager.converted') note('converted sound missing');
  else {
    const j1 = b(), j2 = b();
    if (s1.o.volume !== 2 || Math.abs(s1.o.pitch - ((j1 - j2) * 0.2 + 1)) > 1e-9) note(`converted sound ${s1.o.volume}/${s1.o.pitch}`);
  }
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'zvcure salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = (re) => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return !!h && re.test(h) ? h : null; };
{ const sv = Zv.CURE_TIMER_MIN; Zv.CURE_TIMER_MIN = 3000; const h = first(/conversionTime/); brk(!!h, `start roll 3600 -> 3000: ${h}`); Zv.CURE_TIMER_MIN = sv; }
{ const sv = Zv.CURE_GOSSIP_MAJOR; Zv.CURE_GOSSIP_MAJOR = 10; const h = first(/gossip/); brk(!!h, `major gossip 20 -> 10: ${h}`); Zv.CURE_GOSSIP_MAJOR = sv; }
{ const sv = Zv.CURE_GOSSIP_MINOR; Zv.CURE_GOSSIP_MINOR = 20; const h = first(/gossip/); brk(!!h, `minor gossip 25 -> 20: ${h}`); Zv.CURE_GOSSIP_MINOR = sv; }
{ const sv = Zv.rehomeEquipment; Zv.rehomeEquipment = () => ({ kept: [], dropped: [] }); const h = first(/re-homed|drop/); brk(!!h, `equipment not re-homed: ${h}`); Zv.rehomeEquipment = sv; }
{ const sv = Zv.dataToVillager; Zv.dataToVillager = (z) => Object.assign(sv(z), { tradeOffers: undefined }); const h = first(/offers/); brk(!!h, `offers dropped: ${h}`); Zv.dataToVillager = sv; }
{ const sv = Zv.NAUSEA_EFFECT; Zv.NAUSEA_EFFECT = 'slowness'; const h = first(/nausea/); brk(!!h, `wrong nausea effect: ${h}`); Zv.NAUSEA_EFFECT = sv; }
{ const sv = M.Breed.setBaby; M.Breed.setBaby = (e, b2) => { if (!b2) sv(e, b2); }; const h = first(/baby/); brk(!!h, `baby age dropped: ${h}`); M.Breed.setBaby = sv; }
console.log(`lockstep-zvcure: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
