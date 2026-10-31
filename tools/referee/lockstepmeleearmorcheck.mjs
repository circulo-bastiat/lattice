// lockstep-melee-armor -- #6304 (G17-L56): a zombie hits an armoured scripted dummy (the player object), 20 salts.
// Reference = .decomp LivingEntity.applyArmorToDamage (DamageUtil.getDamageLeft: f=2+toughness/4, clamp(armor-dmg/f, armor/5, 20), dmg*(1-g/25)),
// applyEnchantmentsToDamage (protection EPF summed over the 4 pieces, cap 20, dmg*(1-EPF/25)), PlayerInventory.damageArmor (max(1, floor(dmg/4)) per piece),
// blockedByShield (attacker in front) -> damageShield (dmg>=3 costs 1+floor(dmg)) + takeShieldHit (axe: disableShield, 100-tick cooldown), and the
// MeleeAttackGoal cooldown (20 ticks). Trials: leather / iron / diamond+Protection IV, with and without a raised shield, sword and axe zombie.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '14i_hand.js', '14l_use.js', '07w_passive.js', '07d_mining.js', '07e_loot.js'];
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
{ const table = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table); }


let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log("  FAIL " + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const { EntityList: EL, Combat: Cb, Items: IT, Inventory: Iv, Survival: Sv } = M;
const grass = M.States.stateOf('grass_block');
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(x, -1, z, grass);
M.Sound = { play: () => {} };
const f32 = Math.fround;
// armour points per piece (feet, legs, chest, head) and toughness per piece, 1.18.2 ArmorMaterials
const TIER = { leather: { d: [1, 2, 3, 1], t: 0 }, iron: { d: [2, 5, 6, 2], t: 0 }, diamond: { d: [3, 6, 8, 3], t: 2 } };
const PIECE = ['boots', 'leggings', 'chestplate', 'helmet'];
const AXE_BONUS = 8;   // iron axe 9 attack damage = 1 + 8
function refLeft(dmg, armor, tough) { const f = 2 + tough / 4, g = Math.min(Math.max(armor - dmg / f, armor / 5), 20); return dmg * (1 - g / 25); }
function trial(c) {
  EL.list.length = 0;
  const P = { x: 0.5, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, yaw: c.yaw, type: 'player', slot: 0, inventory: { slots: new Array(46).fill(null) } };
  Sv.init(P);
  const tier = TIER[c.tier];
  for (let i = 0; i < 4; i++) {
    const st = { i: IT.of(c.tier + '_' + PIECE[i]), n: 1 };
    if (c.prot[i]) st.t = { Enchantments: [{ id: 'minecraft:protection', lvl: c.prot[i] }] };
    P.inventory.slots[Iv.ARMOR_START + i] = st;
  }
  if (c.shield) { P.inventory.slots[0] = { i: IT.of('shield'), n: 1 }; P.usingItem = true; P.useKind = 'shield'; P.useTicks = 5; }
  Sv.updateArmor(P, P.inventory); M.Player = P;
  // the zombie stands 1 block away, `off` radians from the player's look direction (front) or behind it
  const a = c.yaw + (c.front ? 0 : Math.PI) + c.off;
  const z = EL.spawn('zombie', P.x + Math.sin(a), 0, P.z - Math.cos(a)); z.persistent = true; z.noAi = true;
  for (const sl of [IT.MAINHAND, IT.OFFHAND, IT.HEAD, IT.CHEST, IT.LEGS, IT.FEET]) M.Equip.setEquipped(z, sl, null);
  if (c.axe) M.Equip.setEquipped(z, IT.MAINHAND, { i: IT.of('iron_axe'), n: 1 });
  const raw = 3 + (c.axe ? AXE_BONUS : 0), armorPts = tier.d.reduce((s, v) => s + v, 0), tough = tier.t * 4;
  const res = Cb.mobAttack(z, P), bad = [];
  const blocked = c.shield && c.front;
  let exp = blocked ? 0 : refLeft(raw, armorPts, tough);
  if (!blocked) { const epf = Math.min(20, c.prot.reduce((s, v) => s + v, 0)); if (epf > 0) exp *= 1 - epf / 25; }
  const lost = 20 - P.health;
  if (Math.abs(lost - exp) > 1e-4) bad.push(`damage ${lost} vs ${exp} (raw ${raw}, armor ${armorPts}/${tough})`);
  if (P.armor !== armorPts || P.armorToughness !== tough) bad.push(`armor stats ${P.armor}/${P.armorToughness} vs ${armorPts}/${tough}`);
  for (let i = 0; i < 4; i++) {   // PlayerInventory.damageArmor runs on the pre-armour amount; a blocked hit is 0 and wears nothing
    const st = P.inventory.slots[Iv.ARMOR_START + i], want = blocked ? 0 : Math.max(1, Math.floor(raw / 4));
    if (((st && st.d) | 0) !== want) bad.push(`wear piece ${i} ${st && st.d} vs ${want}`);
  }
  if (c.shield) {
    const sh = P.inventory.slots[0], want = blocked && raw >= 3 ? 1 + Math.floor(raw) : 0;
    if (((sh && sh.d) | 0) !== want) bad.push(`shield durability ${sh && sh.d} vs ${want}`);
    const cd = blocked && c.axe ? 100 : 0;
    if ((P.shieldCooldown | 0) !== cd) bad.push(`shield cooldown ${P.shieldCooldown} vs ${cd}`);
    if (blocked && c.axe && P.usingItem) bad.push('shield still raised after axe disable');
    if (blocked && !c.axe && !P.usingItem) bad.push('shield dropped without an axe');
  }
  return bad.join('; ') || null;
}
// the zombie's attack cooldown: hits land every 20 ticks (MeleeAttackGoal getTickCount(20)) on a defenceless-to-invulnerability-window dummy
function cooldownRun() {
  EL.list.length = 0;
  const P = { x: 0.5, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, yaw: 0, type: 'player', slot: 0, inventory: { slots: new Array(46).fill(null) } };
  Sv.init(P); M.Player = P; P.health = 1000;
  const z = EL.spawn('zombie', 0.5, 0, -0.5); z.persistent = true; z.target = P;
  const ticks = []; let last = P.health;
  for (let t = 0; t < 120; t++) { EL.tick(); if (P.invulnerable > 0 && P.invulnerable > 0) P.invulnerable = 0; if (P.health < last) { ticks.push(t); last = P.health; } }
  return ticks;
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) {
    const r = stream(s);
    for (const tier of ['leather', 'iron', 'diamond']) for (const shield of [false, true]) for (const axe of [false, true]) for (const front of [true, false]) {
      const prot = [0, 0, 0, 0];
      if (tier === 'diamond') for (let i = 0; i < 4; i++) prot[i] = s % 2 ? 4 : (r() < 0.5 ? 0 : 1 + Math.floor(r() * 4));   // IV on every piece = EPF 16; mixed otherwise
      if (tier === 'diamond' && s % 5 === 0) prot.fill(4);
      const c = { tier, shield, axe, front, prot, yaw: r() * 6.28, off: (r() - 0.5) * 1.6 };
      const b = trial(c); n++;
      if (b) { bad = `salt ${s} ${tier} shield=${shield} axe=${axe} front=${front} prot=${prot}: ${b}`; break; }
    }
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 20 * 24, 'trials ' + base.n);
const cd = cooldownRun();
ok(cd.length >= 3 && cd.every((t, i) => i === 0 || t - cd[i - 1] === 20), 'zombie hit ticks ' + cd.join(','));
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Sv.afterArmor; Sv.afterArmor = (d, a, t) => { if (!a) return d; const f = 2 + (t || 0) / 5; return d * (1 - Math.max(a * 0.2, Math.min(a - d / f, 20)) / 25); }; brk(!!run().bad, 'toughness divisor 4 -> 5'); Sv.afterArmor = o; }
{ const o = M.Equip.protectionReduce; M.Equip.protectionReduce = (d, p) => o(d, Math.min(p, 15)); brk(!!run().bad, 'EPF cap 20 -> 15'); M.Equip.protectionReduce = o; }
{ const o = M.Use.damageShield; M.Use.damageShield = (P, a) => o(P, a - 1); brk(!!run().bad, 'shield durability 1+dmg -> dmg'); M.Use.damageShield = o; }
{ const o = M.Use.disableShield; M.Use.disableShield = () => false; brk(!!run().bad, 'axe no longer disables shield'); M.Use.disableShield = o; }
{ const o = M.Effects.damageArmorPiece; M.Effects.damageArmorPiece = (i, s, a) => o(i, s, a + 1); brk(!!run().bad, 'armour wear +1'); M.Effects.damageArmorPiece = o; }
{ const o = M.Use.blockedByShield; M.Use.blockedByShield = () => false; brk(!!run().bad, 'shield never blocks'); M.Use.blockedByShield = o; }
{ const o = M.Ai.MOB_ATTACK_INTERVAL; M.Ai.MOB_ATTACK_INTERVAL = 25; const c2 = cooldownRun(); brk(c2.join() !== cd.join(), 'attack cooldown 20 -> 25'); M.Ai.MOB_ATTACK_INTERVAL = o; }
console.log(`lockstep-melee-armor: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
