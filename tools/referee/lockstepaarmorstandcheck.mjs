// lockstep-armorstand -- #6718: armor stand hit/break rules, drops, slotFromPosition thresholds, equipment swap by use, creative break, explosion kill; vs independent reference over 20 salts.
// and TurtleEggBlock.randomTick (progress on nextInt(500)==0 or skyAngle in (0.65,0.69); hatch 0->1->2, then break + one baby per egg, baby age -24000) and TurtleEntity.onGrowUp (one scute).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'), monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8'))[1]) });
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

const { EntityList: EL, ArmorStand: AS, Combat: Cb, Inventory: Iv } = M;
const it = (n) => M.Items.of(n);
// independent reference of ArmorStandEntity.slotFromPosition (.decomp :346-364); slots 0 main,1 off,2 feet,3 legs,4 chest,5 head
function refSlot(small, y0, has) {
  const y = small ? y0 * 2 : y0;
  if (y >= 0.1 && y < 0.1 + (small ? 0.8 : 0.45) && has[2]) return 2;
  if (y >= 0.9 + (small ? 0.3 : 0) && y < 0.9 + (small ? 1 : 0.7) && has[4]) return 4;
  if (y >= 0.4 && y < 0.4 + (small ? 1 : 0.8) && has[3]) return 3;
  if (y >= 1.6 && has[5]) return 5;
  if (!has[0] && has[1]) return 1;
  return 0;
}
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const names = [null, null, 'iron_boots', 'iron_leggings', 'iron_chestplate', 'iron_helmet'];
function mk(small, mask) {
  EL.list.length = 0;
  const e = EL.spawn('armor_stand', 0.5, 0, 0.5); e.small = small; e.showArms = true; e.health = 20; e.lastHitTime = -100;
  e.equip = e.equip || [null, null, null, null, null, null];
  for (let s = 0; s < 6; s++) e.equip[s] = (mask >> s) & 1 ? { i: it(s < 2 ? 'diamond_sword' : names[s]), n: 1 } : null;
  return e;
}
function slotCheck(small, mask, y) {
  const e = mk(small, mask), has = []; for (let s = 0; s < 6; s++) has[s] = !!((mask >> s) & 1);
  return AS.slotFromPosition(e, y) === refSlot(small, y, has) ? null : `slot small=${small} mask=${mask} y=${y}`;
}
let fails = 0, breaks = 0, n = 0;
function runAll() {
  const bad = [];
  for (let salt = 0; salt < 20; salt++) {
    const r = stream(salt);
    for (let k = 0; k < 40; k++) {
      const small = r() < 0.5, mask = Math.floor(r() * 64), y = [0.1, 0.55, 0.9, 1.6, 0.0999, 0.8999, 1.5999][k % 7] * (k < 14 ? 1 : 0.5) + (k >= 28 ? r() * 2 : 0);
      n++; const b = slotCheck(small, mask, y); if (b) bad.push(`salt ${salt}: ${b}`);
    }
    // damage: first punch sets hit time only, second within 5 ticks breaks and drops stand + equipment
    M.Player.mode = 0; M.Behave.gameTime = 100 + salt;
    let e = mk(false, 1 | 4 | 32), t0 = M.Behave.gameTime;
    Cb.armorStandDamage(e, 1, true); n++;
    if (e.removed || e.health !== 20 || e.lastHitTime !== t0) bad.push(`salt ${salt}: first punch`);
    M.Behave.gameTime = t0 + 1 + Math.floor(r() * 5);
    Cb.armorStandDamage(e, 1, true);
    if (!e.removed) bad.push(`salt ${salt}: double punch did not break`);
    const drops = EL.list.filter((d) => d.type === 'item' || d.item !== undefined);
    if (drops.length !== 4) bad.push(`salt ${salt}: drops ${drops.length} != 4 (stand+3 equipped)`);
    // slow punch (>5 ticks) only re-arms
    e = mk(false, 0); M.Behave.gameTime = 500; Cb.armorStandDamage(e, 1, true); M.Behave.gameTime = 506; Cb.armorStandDamage(e, 1, true);
    if (e.removed) bad.push(`salt ${salt}: slow second punch broke`);
    // explosion kill: equipment drops, no stand item
    e = mk(false, 4 | 8); Cb.armorStandDamage(e, 9, false, { explosive: true });
    if (!e.removed || EL.list.filter((d) => d.item !== undefined || d.type === 'item').length !== 2) bad.push(`salt ${salt}: explosion`);
    // creative break: gone, no drops
    e = mk(false, 4); M.Player.mode = 1; Cb.armorStandDamage(e, 1, true);
    if (!e.removed || EL.list.some((d) => d.item !== undefined || d.type === 'item')) bad.push(`salt ${salt}: creative break`);
    M.Player.mode = 0;
    // use: helmet / chestplate / sword / empty hand
    const P = Object.assign(M.Player, { inventory: Iv.create ? Iv.create() : M.Player.inventory, slot: 0, instabuild: false });
    for (const [item, slot] of [['iron_helmet', 5], ['iron_chestplate', 4], ['diamond_sword', 0]]) {
      e = mk(false, 0); Iv.setItem(P.inventory, 0, { i: it(item), n: 1 });
      AS.interact(e, P, Iv.getItem(P.inventory, 0), 1);
      n++; if (!e.equip[slot] || e.equip[slot].i !== it(item) || !Iv.isEmpty(Iv.getItem(P.inventory, 0))) bad.push(`salt ${salt}: equip ${item}`);
    }
    e = mk(false, 32); Iv.setItem(P.inventory, 0, Iv.EMPTY); AS.interact(e, P, Iv.EMPTY, 1.7);
    n++; if (e.equip[5] || Iv.isEmpty(Iv.getItem(P.inventory, 0))) bad.push(`salt ${salt}: empty hand takes helmet`);
  }
  return bad;
}
M.Player.inventory = M.Player.inventory || (Iv.create ? Iv.create() : null);
const bad0 = runAll();
bad0.slice(0, 20).forEach((b) => console.log('  FAIL ' + b)); fails += bad0.length;
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = AS.slotFromPosition; AS.slotFromPosition = function (e, hy) { const s = !!e.small, y = s ? hy * 2 : hy; if (y >= 0.85 + (s ? 0.3 : 0) && y < 0.9 + (s ? 1 : 0.7) && e.equip[4]) return 4; return o.call(this, e, hy); };
  const f = fails, b = runAll(); AS.slotFromPosition = o; fails = f; brk(b.length > 0, 'chest threshold 0.9 -> 0.85'); }
{ const o = Cb.armorStandDamage; Cb.armorStandDamage = function (e, a, p, s) { const t = M.Behave.gameTime; M.Behave.gameTime = t - 2; try { return o.call(this, e, a, p, s); } finally { M.Behave.gameTime = t; } };
  const f = fails, b = runAll(); Cb.armorStandDamage = o; fails = f; brk(b.length > 0, 'hit window skewed'); }
console.log(`lockstep-armorstand: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
