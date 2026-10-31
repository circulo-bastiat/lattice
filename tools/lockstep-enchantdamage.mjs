#!/usr/bin/env node
// lockstep-enchantdamage -- #6932 (G17-L192): lockstep scenario 'enchantdamage', 20 salts. A scripted player swings an enchanted sword at a zombie,
// a spider, a cow and a creeper at full cooldown through the REAL Combat.attack; per swing the engine's damage, health, fire ticks, knockback
// velocity and the held Looting level are compared exact (doubles) with the vanilla formulas (.decomp EnchantmentHelper.getAttackDamage /
// getKnockback / getFireAspect / getLooting, DamageEnchantment.getAttackDamage: SHARPNESS 1+max(0,l-1)*0.5 ALL, SMITE 2.5l UNDEAD, BANE 2.5l ARTHROPOD).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALTS = 20, FLOOR_Y = 64;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const GROUP = { zombie: 'undead', spider: 'arthropod', cow: 'none', creeper: 'none' };
const TARGETS = ['zombie', 'spider', 'cow', 'creeper'];
const SWORDS = { wooden_sword: 4, stone_sword: 5, iron_sword: 6, golden_sword: 4, diamond_sword: 7 };
const ENCH = ['sharpness', 'smite', 'bane_of_arthropods', 'fire_aspect', 'knockback', 'looting'];

function load(patch) {
  const M = loadEngine({
    extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14e_gamemode.js',
            '07q_effects.js', '07y_equip.js', '14j_combat.js', '14d_survival.js', '07zx_particle.js'],
    initReg: false, patch
  });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init();
  M.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'),
                 itemsBytes: JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8')).rawBytes });
  const table = {};
  for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
  M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
  M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
  M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
  M.EntityList.init(); M.Combat.init();
  return M;
}

// the script: per salt, 12 swings; each picks a sword, a target, and a level for each of the six enchantments (0 = absent)
function script(salt) {
  const r = stream(salt), out = [], names = Object.keys(SWORDS);
  for (let i = 0; i < 12; i++) {
    const sword = names[Math.floor(r() * names.length)], target = TARGETS[Math.floor(r() * 4)], lv = {};
    for (const k of ENCH) lv[k] = r() < 0.5 ? 0 : 1 + Math.floor(r() * (k === 'fire_aspect' || k === 'knockback' ? 2 : k === 'looting' ? 3 : 5));
    out.push({ sword, target, lv });
  }
  return out;
}
let swing = 0;
const row = (d) => ({ tick: swing++, lastDamage: d.damage, health: Math.round(d.health * 1e4) / 1e4, fireTicks: d.fire, vel: [d.vx, d.vy, d.vz], looting: d.looting });

function engine(salt, patch) {
  const M = load(patch), EL = M.EntityList, Cb = M.Combat, H = M.Hand, Inv = M.Inventory, rows = [];
  swing = 0;
  for (const s of script(salt)) {
    EL.clear();
    const P = { x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: Inv.create(), sprinting: false, onGround: true,
                fallDistance: 0, onClimbable: false, inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 };
    const E = Object.keys(s.lv).filter((k) => s.lv[k] > 0).map((k) => ({ id: 'minecraft:' + k, lvl: s.lv[k] }));
    Inv.setItem(P.inventory, P.slot, Inv.stack(s.sword, 1, 0, E.length ? { Enchantments: E } : null));
    H.reset(); for (let i = 0; i < 40; i++) H.tickAttackStrength();
    const e = EL.spawn(s.target, 0, FLOOR_Y, -2); e.maxHealth = e.health = 1000; e.vx = e.vy = e.vz = 0; e.onGround = true;
    M.Player = P;
    const res = Cb.attack(P, e);
    rows.push(row({ damage: res.damage, health: e.health, fire: e.remainingFireTicks | 0, vx: e.vx, vy: e.vy, vz: e.vz, looting: Cb.lootingOf(P) }));
  }
  return rows;
}

// vanilla: the ground-truth formulas, written from the decompiled sources, not from the engine
const ARMOR = { zombie: 2 };
// CombatRules.getDamageAfterAbsorb (the engine's Survival.afterArmor keeps doubles where vanilla uses floats - armour is not this check's subject): dmg * (1 - clamp(max(a/5, a - dmg/(2 + toughness/4)), 0, 20) / 25)
const absorb = (d, a) => a === 0 ? d : d * (1 - Math.min(20, Math.max(a / 5, a - d / 2)) / 25);
function reference(salt) {
  swing = 0;
  const rows = [];
  for (const s of script(salt)) {
    const g = GROUP[s.target], L = s.lv;
    let bonus = 0;
    if (L.sharpness > 0) bonus += 1 + Math.max(0, L.sharpness - 1) * 0.5;
    if (L.smite > 0 && g === 'undead') bonus += L.smite * 2.5;
    if (L.bane_of_arthropods > 0 && g === 'arthropod') bonus += L.bane_of_arthropods * 2.5;
    const dmg = SWORDS[s.sword] + bonus;
    // knockback: LivingEntity.knockback twice (damage's 0.4, then the enchant's level*0.5), each halves the old motion and subtracts the impulse
    let vx = 0, vy = 0, vz = 0;
    const kb = (st, dz) => { vx = vx / 2; vz = vz / 2 + dz * st; vy = Math.min(0.4, vy / 2 + st); };
    kb(0.4, -1);   // damage()'s own 0.4 pushes the mob (2 blocks north) away; the enchant impulse uses the referee-verified (kbrefcheck) attack heading, +z at yaw 0
    if (L.knockback > 0) kb(L.knockback * 0.5, 1);
    rows.push(row({ damage: dmg, health: 1000 - absorb(dmg, ARMOR[s.target] || 0), fire: L.fire_aspect > 0 ? L.fire_aspect * 80 : 0, vx, vy, vz, looting: L.looting }));
  }
  return rows;
}

function divergences(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    let d = compareTraces(a, b);
    if (!d) { const i = a.findIndex((r, k) => r.looting !== b[k].looting); if (i >= 0) d = { tick: i, field: 'looting', a: a[i].looting, b: b[i].looting }; }
    if (d) { bad++; if (!first) first = `salt ${s} ${JSON.stringify(d)}`; }
  }
  return { bad, first };
}

const base = divergences();
let ok = base.bad === 0, caught = 0;
const P = (a, b) => (n, s) => { if (n !== '14j_combat.js') return s; const o = s.replace(a, b); if (o === s) throw new Error('break did not match: ' + a); return o; };
const breaks = [
  ['Smite applied to arthropods', P("'minecraft:smite' && mobType === 'undead'", "'minecraft:smite' && (mobType === 'undead' || mobType === 'arthropod')")],
  ['Sharpness per-level 0.5 -> 0.6', P('Cb.SHARPNESS_PER_LEVEL = 0.5', 'Cb.SHARPNESS_PER_LEVEL = 0.6')],
  ['Bane applied to undead', P("'minecraft:bane_of_arthropods' && mobType === 'arthropod'", "'minecraft:bane_of_arthropods' && mobType !== 'none'")],
  ['Fire Aspect 4 -> 3 s per level', P('Cb.FIRE_ASPECT_SECONDS_PER_LEVEL = 4', 'Cb.FIRE_ASPECT_SECONDS_PER_LEVEL = 3')],
  ['Knockback 0.5 -> 0.6 per level', P('Cb.KNOCKBACK_PER_LEVEL = 0.5', 'Cb.KNOCKBACK_PER_LEVEL = 0.6')],
];
for (const [name, p] of breaks) {
  const x = divergences(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`enchantdamage: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
