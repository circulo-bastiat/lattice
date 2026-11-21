#!/usr/bin/env node
// enchroster.mjs — #193 G22a: every registered enchantment in NS.EnchHelper (07ox_enchhelper.js)
// diffed field-by-field against the decompiled jar (.decomp/net/minecraft/enchantment/*.java):
// rarity weight, maxLevel, min/max power (levels 1..max), treasure, curse, book offer, random
// selection, EnchantmentTarget, incompatibility set, plus per-item applicability and the stack
// Enchantments API. Then it corrupts its own data and shows each corruption is caught.
//   node tools/enchroster.mjs
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';

const DIR = '.decomp/net/minecraft/enchantment/';
const rd = f => fs.readFileSync(DIR + f + '.java', 'utf8');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;

// ---- the jar side ----
const ench = rd('Enchantments');
const RARITY = { field_9087: 10, field_9090: 5, field_9088: 2, field_9091: 1 };
const jar = {}, byField = {};
const re = /public static final Enchantment (field_\d+) = register\(\s*"(\w+)", new (\w+)\(Enchantment\.Rarity\.(field_\d+)([^;]*)\)\s*\);/g;
let m;
while ((m = re.exec(ench))) {
  jar[m[2]] = { field: m[1], cls: m[3], weight: RARITY[m[4]], args: m[5] };
  byField[m[1]] = m[2];
}
const ids = Object.keys(jar);
ok(ids.length === 38, 'jar registers ' + ids.length + ' enchantments (expected 38 in 1.18.2)');

const TARGETS = { field_9068: 'armor', field_9079: 'armor_feet', field_9076: 'armor_legs', field_9071: 'armor_chest', field_9080: 'armor_head',
  field_9074: 'weapon', field_9069: 'digger', field_9072: 'fishing_rod', field_9073: 'trident', field_9082: 'breakable', field_9070: 'bow',
  field_9078: 'wearable', field_9081: 'crossbow', field_23747: 'vanishable' };
const PROT = { field_9138: [1, 11], field_9139: [10, 8], field_9140: [5, 6], field_9141: [5, 8], field_9142: [3, 6] };
const DMG = [[1, 11, 20], [5, 8, 20], [5, 8, 20]];
const clsSrc = {};
for (const id of ids) { const c = jar[id].cls; if (!clsSrc[c]) clsSrc[c] = rd(c); }
const base = rd('Enchantment');
const baseMin = l => 1 + l * 10;

function body(src, name) {
  const i = src.indexOf('public ' + (name === 'canAccept' ? 'boolean' : 'int') + ' ' + name + '(');
  if (i < 0) return null;
  const j = src.indexOf('\n    }', i);
  return src.slice(i, j);
}
function ret(src, name) { const b = body(src, name); if (!b) return null; const r = /return ([^;]+);/.exec(b); return r ? r[1] : null; }
function jarInfo(id) {
  const j = jar[id], s = clsSrc[j.cls];
  const args = j.args;
  const info = { weight: j.weight, maxLevel: Number(ret(s, 'getMaxLevel')) };
  let typeIdx = null, prot = null;
  if (j.cls === 'ProtectionEnchantment') prot = PROT[/Type\.(field_\d+)/.exec(args)[1]];
  if (j.cls === 'DamageEnchantment') typeIdx = Number(/,\s*(\d),/.exec(args)[1]);
  const mk = (expr, self) => l => {
    if (expr === null) return null;
    let e = expr.replace(/\$\$0/g, '(' + l + ')');
    if (prot) e = e.replace(/this\.protectionType\.getBasePower\(\)/, prot[0]).replace(/this\.protectionType\.getPowerPerLevel\(\)/g, prot[1]);
    if (typeIdx !== null) {
      e = e.replace(/BASE_POWERS\[this\.typeIndex\]/, [1, 5, 5][typeIdx]).replace(/POWERS_PER_LEVEL\[this\.typeIndex\]/, [11, 8, 8][typeIdx])
        .replace(/MIN_MAX_POWER_DIFFERENCES\[this\.typeIndex\]/, 20);
    }
    if (/super\.getMinPower/.test(e)) e = e.replace(/super\.getMinPower\(\((\d+)\)\)/, (_, n) => baseMin(Number(n)));
    if (/this\.getMinPower/.test(e)) e = e.replace(/this\.getMinPower\(\((\d+)\)\)/, (_, n) => minP(Number(n)));
    return Function('return ' + e)();
  };
  const minExpr = ret(s, 'getMinPower'), maxExpr = ret(s, 'getMaxPower');
  const minP = l => (minExpr === null ? baseMin(l) : mk(minExpr)(l));
  const maxP = l => (maxExpr === null ? minP(l) + 5 : mk(maxExpr)(l));
  info.min = minP; info.max = maxP;
  // target: explicit in the subclass, or an Enchantments.java argument (Luck/Lure), or Protection's ternary
  const sup = /super\(\$\$0, ([^,]+), /.exec(s);
  let t = sup && sup[1];
  if (j.cls === 'ProtectionEnchantment') t = prot === PROT.field_9140 ? 'EnchantmentTarget.field_9079' : 'EnchantmentTarget.field_9068';
  if (t === '$$1') t = /EnchantmentTarget\.(field_\d+)/.exec(args)[0];
  info.type = TARGETS[/(field_\d+)/.exec(t)[1]];
  info.treasure = /isTreasure\(\) \{\s*return true/.test(s);
  info.curse = /isCursed\(\) \{\s*return true/.test(s);
  info.book = !/isAvailableForEnchantedBookOffer\(\) \{\s*return false/.test(s);
  info.rand = !/isAvailableForRandomSelection\(\) \{\s*return false/.test(s);
  return info;
}
// incompat: canAccept(a,b) false for these b, from the source text of each class
function jarIncompat() {
  const conflict = {};
  const rejects = id => {
    const s = clsSrc[jar[id].cls], out = new Set();
    const b = body(s, 'canAccept');
    if (!b) return out;
    for (const f of b.matchAll(/\$\$0 != Enchantments\.(field_\d+)/g)) out.add(byField[f[1]]);
    if (jar[id].cls !== 'ProtectionEnchantment') for (const f of b.matchAll(/\$\$0 instanceof (\w+)/g)) for (const o of ids) if (jar[o].cls === f[1]) out.add(o);
    if (jar[id].cls === 'ProtectionEnchantment') {
      // ProtectionEnchantment.canAccept: same Type -> false; different Types -> false unless one is feather_falling
      for (const o of ids) if (jar[o].cls === 'ProtectionEnchantment' && o !== id && o !== 'feather_falling' && id !== 'feather_falling') out.add(o);
    }
    return out;
  };
  const R = {}; for (const id of ids) R[id] = rejects(id);
  for (const a of ids) { conflict[a] = new Set(); for (const b of ids) if (a !== b && (R[a].has(b) || R[b].has(a))) conflict[a].add(b); }
  return conflict;
}
const JC = jarIncompat();
ok(JC.sharpness.has('smite') && JC.protection.has('fire_protection') && !JC.feather_falling.size, 'jar-side incompat parser self-check');

function diff(EH) {
  const errs = [];
  for (const id of ids) {
    const e = EH.ENCH[id], J = jarInfo(id);
    if (!e) { errs.push(id + ': missing'); continue; }
    const cmp = (f, a, b) => { if (a !== b) errs.push(id + '.' + f + ' ' + a + ' != jar ' + b); };
    cmp('weight', e.weight, J.weight); cmp('maxLevel', e.maxLevel, J.maxLevel);
    cmp('treasure', !!e.treasure, J.treasure); cmp('rand', !!e.rand, J.rand);
    cmp('curse', EH.isCurse(id), J.curse); cmp('book', EH.isBookOffer(id), J.book);
    cmp('type', EH.TYPE[id], J.type);
    for (let l = 1; l <= J.maxLevel; l++) {
      cmp('minPower' + l, EH.getMinPower(id, l), J.min(l)); cmp('maxPower' + l, EH.getMaxPower(id, l), J.max(l));
    }
    const mine = new Set(EH.incompatible(id));
    cmp('incompat', [...mine].sort().join(','), [...JC[id]].sort().join(','));
  }
  for (const k of Object.keys(EH.ENCH)) if (!jar[k]) errs.push(k + ': not in jar');
  return errs;
}

const M = loadEngine({ extra: ['07ox_enchhelper.js'] });
const EH = M.EnchHelper;
const errs = diff(EH);
ok(errs.length === 0, 'roster diverges from the jar: ' + errs.slice(0, 8).join('; ') + (errs.length > 8 ? ' (+' + (errs.length - 8) + ')' : ''));
ok(EH.ids().length === ids.length, 'EH.ids() count');

// ---- item applicability (EnchantmentTarget + the four overrides) ----
const A = (id, n) => EH.isAcceptableItem(id, n);
ok(A('sharpness', 'diamond_sword') && A('sharpness', 'iron_axe') && !A('sharpness', 'iron_pickaxe'), 'sharpness: sword+axe only');
ok(A('efficiency', 'iron_pickaxe') && A('efficiency', 'shears') && !A('efficiency', 'diamond_sword'), 'efficiency: digger+shears');
ok(A('thorns', 'iron_helmet') && A('thorns', 'iron_boots') && !A('thorns', 'bow'), 'thorns: any armor');
ok(A('feather_falling', 'iron_boots') && !A('feather_falling', 'iron_helmet'), 'feather_falling: boots only');
ok(A('protection', 'iron_leggings') && !A('protection', 'elytra'), 'protection: armor only');
ok(A('binding_curse', 'elytra') && A('binding_curse', 'carved_pumpkin') && A('binding_curse', 'player_head') && !A('binding_curse', 'shield'), 'binding_curse: wearable');
ok(A('power', 'bow') && !A('power', 'crossbow') && A('piercing', 'crossbow') && A('loyalty', 'trident') && A('lure', 'fishing_rod'), 'ranged/rod/trident targets');
ok(A('vanishing_curse', 'compass') && A('vanishing_curse', 'iron_sword') && !A('vanishing_curse', 'stick'), 'vanishing_curse: vanishable');
const IT = M.Items;
if (IT && IT.ready) {
  ok(A('unbreaking', 'shield') && A('mending', 'elytra') && !A('mending', 'stick'), 'unbreaking/mending: damageable');
}

// ---- the stack API ----
function stackApi(E) {
  const errsA = [];
  const st = { i: 0, n: 1 };
  E.addEnchantment(st, 'sharpness', 3);
  E.addEnchantment(st, 'minecraft:unbreaking', 2);
  E.addEnchantment(st, 'sharpness', 5);
  const g = E.get(st);
  if (g.sharpness !== 5 || g.unbreaking !== 2 || !st.t || st.t.Enchantments.length !== 2) errsA.push('add/replace');
  if (!E.removeEnchantment(st, 'sharpness') || E.get(st).sharpness) errsA.push('remove');
  E.removeEnchantment(st, 'unbreaking');
  if (st.t && st.t.Enchantments) errsA.push('empty list not dropped');
  if (E.addEnchantment({ i: 0 }, 'not_real', 1)) errsA.push('unknown id accepted');
  E.set(st, { mending: 1, thorns: 0 });
  if (!st.t || !st.t.Enchantments || st.t.Enchantments.length !== 1 || st.t.Enchantments[0].id !== 'minecraft:mending') errsA.push('set');
  return errsA;
}
const sa = stackApi(EH);
ok(sa.length === 0, 'stack API: ' + sa.join(', '));
if (IT && IT.ready && IT.index.enchanted_book !== undefined) {
  const bk = { i: IT.index.enchanted_book };
  EH.addEnchantment(bk, 'mending', 1);
  ok(bk.t.StoredEnchantments && !bk.t.Enchantments && EH.get(bk).mending === 1, 'book keeps StoredEnchantments');
}
// Cb.enchantLevel reads what the API wrote
{
  const M2 = loadEngine({ extra: ['07ox_enchhelper.js', '14j_combat.js'] });
  const st = { i: 0 }; M2.EnchHelper.addEnchantment(st, 'looting', 3);
  ok(M2.Combat ? M2.Combat.enchantLevel(st, 'looting') === 3 : true, 'Cb.enchantLevel reads the API output');
}

// ---- anti-vacuity: corrupt our own data, every corruption must be caught ----
function breakIt(label, mutate) {
  const N = loadEngine({ extra: ['07ox_enchhelper.js'] }).EnchHelper;
  mutate(N);
  const e = diff(N);
  breaks++;
  ok(e.length > 0, 'anti-vacuity: corruption "' + label + '" not caught');
}
breakIt('weight', N => { N.ENCH.sharpness.weight = 9; });
breakIt('maxLevel', N => { N.ENCH.fortune.maxLevel = 4; });
breakIt('treasure', N => { N.ENCH.mending.treasure = false; });
breakIt('maxPower', N => { const f = N.MAX_POWER.efficiency; N.MAX_POWER.efficiency = l => f(l) + 1; });
breakIt('minPower', N => { N.MIN_POWER.thorns = l => 11 + 20 * (l - 1); });
breakIt('type', N => { N.TYPE.binding_curse = 'armor'; });
breakIt('incompat', N => { const c = N.canCombine; N.canCombine = (a, b) => (a === 'riptide' && b === 'channeling') ? true : c(a, b); });
breakIt('roster entry', N => { delete N.ENCH.piercing; });
breakIt('curse', N => { N.isCurse = () => false; });
{ // applicability + stack API must also fail when broken
  const N = loadEngine({ extra: ['07ox_enchhelper.js'] }).EnchantmentHelper || EH;
  breaks++; ok(stackApi({ ...EH, addEnchantment: () => false, get: EH.get, removeEnchantment: EH.removeEnchantment, set: EH.set }).length > 0, 'anti-vacuity: broken stack API not caught');
}

console.log(fails.length ? fails.map(f => 'FAIL ' + f).join('\n') : 'ok');
console.log(pass + ' passed, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
