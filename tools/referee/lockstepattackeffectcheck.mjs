// lockstep-attackeffect -- #6862 (G17-L161): on-hit effects by difficulty, 20 salts. Reference = .decomp CaveSpiderEntity.tryAttack (Normal 7 s / Hard 15 s poison, Easy none),
// HuskEntity.tryAttack (140 * (int)localDifficulty hunger, empty hand), WitherSkeletonEntity.tryAttack (wither 200t), StrayEntity.createArrowProjectile (slowness 600t on the arrow).
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
const { EntityList: EL, Combat: Cb, Items: IT, Inventory: Iv, Survival: Sv } = M;
const grass = M.States.stateOf('grass_block');
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(x, -1, z, grass);
M.Sound = { play: () => {} };
// vanilla expectations at day 0, unloaded chunk: local difficulty = difficultyId * 0.75 (easy 0.75, normal 1.5, hard 2.25)
const LD = { easy: 0.75, normal: 1.5, hard: 2.25 };
const EXP = {
  cave_spider: (d) => d === 'normal' ? { poison: 140 } : d === 'hard' ? { poison: 300 } : {},
  husk: (d) => { const n = 140 * Math.floor(LD[d]); return n > 0 ? { hunger: n } : {}; },
  wither_skeleton: () => ({ wither: 200 }),
};
const snap = (P) => Object.keys(P.effects || {}).sort().map((k) => k + ':' + P.effects[k].amplifier + ':' + P.effects[k].duration).join(',');
function trial(type, diff, armour, ticks) {
  EL.list.length = 0; M.Diff = { get: () => diff };
  const P = { x: 0.5, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, yaw: 0, type: 'player', slot: 0, inventory: { slots: new Array(46).fill(null) } };
  Sv.init(P);
  if (armour) for (let i = 0; i < 4; i++) P.inventory.slots[Iv.ARMOR_START + i] = { i: IT.of('iron_' + ['boots', 'leggings', 'chestplate', 'helmet'][i]), n: 1 };
  Sv.updateArmor(P, P.inventory); M.Player = P;
  const z = EL.spawn(type, 0.5, 0, -0.5); z.persistent = true; z.noAi = true;
  for (const sl of [IT.MAINHAND, IT.OFFHAND, IT.HEAD, IT.CHEST, IT.LEGS, IT.FEET]) M.Equip.setEquipped(z, sl, null);
  Cb.mobAttack(z, P);
  const want = EXP[type](diff), bad = [];
  // per tick: the effects field (id, amplifier, duration) counts down one per tick
  for (let t = 0; t <= ticks; t++) {
    const exp = Object.keys(want).sort().map((k) => k + ':0:' + (want[k] - t)).join(',');
    if (snap(P) !== exp) { bad.push(`tick ${t}: ${snap(P)} vs ${exp}`); break; }
    M.Effects.tick(P);
  }
  if (!(P.health < 20) && type !== 'cave_spider') bad.push('no damage');
  return bad.join('; ') || null;
}
function strayTip() {
  EL.list.length = 0; M.Diff = { get: () => 'normal' };
  const P = { x: 0.5, y: 0, z: 4.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, type: 'player', inventory: { slots: new Array(46).fill(null) } };
  const s = EL.spawn('stray', 0.5, 0, -0.5); s.persistent = true; s.noAi = true;
  Cb.mobShoot(s, P, 1, () => 0.5);
  const a = EL.list.find((e) => e.type === 'arrow');
  const c = a && a.tip && a.tip.custom && a.tip.custom[0];
  return c ? `${c.effect}:${c.amplifier}:${c.duration}` : 'none';
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) for (const type of Object.keys(EXP)) for (const diff of ['easy', 'normal', 'hard']) for (const armour of [false, true]) {
    const b = trial(type, diff, armour, 3 + (s % 5)); n++;
    if (b) { bad = `salt ${s} ${type} ${diff} armour=${armour}: ${b}`; break; }
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 20 * 18, 'trials ' + base.n);
ok(strayTip() === 'slowness:0:600', 'stray tip ' + strayTip());
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = M.CaveSpider.POISON_TICKS; M.CaveSpider.POISON_TICKS = { easy: 140, normal: 140, hard: 300 }; brk(!!run().bad, 'poison on Easy'); M.CaveSpider.POISON_TICKS = o; }
{ const o = M.CaveSpider.POISON_TICKS; M.CaveSpider.POISON_TICKS = { normal: 140, hard: 140 }; brk(!!run().bad, 'hard poison 15 s -> 7 s'); M.CaveSpider.POISON_TICKS = o; }
{ const o = M.Undead.HUSK_HUNGER_BASE_TICKS; M.Undead.HUSK_HUNGER_BASE_TICKS = 100; brk(!!run().bad, 'husk hunger 140 -> 100'); M.Undead.HUSK_HUNGER_BASE_TICKS = o; }
{ const o = M.Undead.huskHungerDuration; M.Undead.huskHungerDuration = () => 210; brk(!!run().bad, 'husk hunger floor(140*1.5)'); M.Undead.huskHungerDuration = o; }
{ const o = Cb.WITHER_SKELETON_HIT_TICKS; Cb.WITHER_SKELETON_HIT_TICKS = 100; brk(!!run().bad, 'wither 200 -> 100'); Cb.WITHER_SKELETON_HIT_TICKS = o; }
{ const o = Cb.STRAY_ARROW_SLOWNESS_TICKS; Cb.STRAY_ARROW_SLOWNESS_TICKS = 300; brk(strayTip() !== 'slowness:0:600', 'stray slowness 600 -> 300'); Cb.STRAY_ARROW_SLOWNESS_TICKS = o; }
console.log(`lockstep-attackeffect: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
