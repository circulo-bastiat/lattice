#!/usr/bin/env node
// enchclassescheck.mjs — #11490: 07ox_enchhelper.js's per-class enchantment tables vs the REAL .decomp Java:
//   AquaAffinityEnchantment, BindingCurseEnchantment, ChannelingEnchantment, DepthStriderEnchantment, EfficiencyEnchantment,
//   Enchantment, FireAspectEnchantment, FlameEnchantment, FrostWalkerEnchantment, ImpalingEnchantment, InfinityEnchantment,
//   KnockbackEnchantment, LoyaltyEnchantment, LuckEnchantment, LureEnchantment, MendingEnchantment, MultishotEnchantment,
//   PiercingEnchantment, PowerEnchantment, PunchEnchantment, QuickChargeEnchantment, RespirationEnchantment, RiptideEnchantment,
//   SilkTouchEnchantment, SweepingEnchantment, UnbreakingEnchantment, VanishingCurseEnchantment (getMinPower/getMaxPower/getMaxLevel
//   parsed from each class's source and evaluated for every level; rarity weight from Enchantment.Rarity),
//   EnchantedBookItem / Vanishable / Wearable (marker interfaces: the Java implementers are looked up, the engine's curse and
//   armor-slot targets must agree: Vanishable items accept vanishing_curse, Wearable armor accepts binding_curse).
// Anti-vacuity: the engine tables are broken in memory and the comparison must fail ("<n> breaks caught").
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const DEC = join(MCLITE_ROOT, '.decomp/net/minecraft');
if (!existsSync(DEC)) { console.log('enchclassescheck: SKIP no .decomp'); process.exit(0); }
const rd = (p) => readFileSync(join(DEC, p), 'utf8');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const ench = rd('enchantment/Enchantments.java').replace(/\s+/g, ' ');
const cls = {}; for (const m of ench.matchAll(/register\( ?"(\w+)", new (\w+)\(Enchantment\.Rarity\.(\w+)/g)) cls[m[1]] = { c: m[2], rar: m[3] };
const rarSrc = rd('enchantment/Enchantment.java');
const rarW = {}; for (const m of rarSrc.matchAll(/(field_\d+)\((\d+)\)/g)) rarW[m[1]] = +m[2];

function parse(c) {
  const s = rd(`enchantment/${c}.java`);
  const body = (n) => { const m = s.match(new RegExp(`public int ${n}\\(([^)]*)\\) \\{\\s*return ([^;]+);`)); return m && { arg: m[1].replace(/int /, '').trim(), e: m[2] }; };
  return { min: body('getMinPower'), max: body('getMaxPower'), lvl: body('getMaxLevel') };
}
const mkfn = (b, minFn) => {
  if (!b) return null;
  const e = b.e.replace(/super\.getMinPower\(([^)]*)\)/g, '(1+($1)*10)').replace(/this\.getMinPower\(([^)]*)\)/g, 'MIN($1)')
    .split(b.arg).join('L');
  if (/[A-Za-z_$]/.test(e.replace(/\b(L|MIN)\b/g, ''))) return null;
  return new Function('L', 'MIN', `return ${e};`).bind(null);
};

const JS = loadEngine({ extra: ['07ox_enchhelper.js'], dom: false });
const EH = JS.EnchHelper;
const evald = {};
function compare(EHx, tag) {
  let bad = 0, n = 0;
  for (const id of Object.keys(cls)) {
    const p = parse(cls[id].c); const ml = p.lvl && mkfn(p.lvl); if (!ml) continue;
    const maxL = ml(0); const E = EHx.ENCH[id]; if (!E) { bad++; continue; }
    if (E.maxLevel !== maxL) bad++;
    const mn = mkfn(p.min), mx = mkfn(p.max);
    if (!mn || !mx) continue;
    const minF = (l) => mn(l, minF);
    for (let l = 1; l <= maxL; l++) {
      n++; evald[id] = 1;
      if (EHx.getMinPower(id, l) !== mn(l, minF) || EHx.getMaxPower(id, l) !== mx(l, minF)) bad++;
    }
  }
  return { bad, n };
}
const base = compare(EH, 'base');
ok(base.bad === 0, `engine tables differ from Java (${base.bad} mismatches)`);
ok(base.n >= 60, `too few levels compared: ${base.n}`);
const named = ['aqua_affinity','binding_curse','channeling','depth_strider','efficiency','fire_aspect','flame','frost_walker','impaling','infinity','knockback','loyalty','lure','mending','multishot','piercing','power','punch','quick_charge','respiration','riptide','silk_touch','sweeping','unbreaking','vanishing_curse','luck_of_the_sea','looting','fortune'];
for (const id of named) ok(!!evald[id], `${id}: Java powers not evaluated`);
// Rarity: Java weight vs ENCH weight
for (const id of Object.keys(cls)) { const w = rarW[cls[id].rar]; if (w !== undefined && EH.ENCH[id]) ok(EH.ENCH[id].weight === w, `${id}: weight ${EH.ENCH[id].weight} != rarity ${w}`); }
// treasure flags: Java isTreasure overrides
for (const id of Object.keys(cls)) { const s = rd(`enchantment/${cls[id].c}.java`); const t = /isTreasure\(\) \{\s*return true/.test(s); if (EH.ENCH[id]) ok(EH.ENCH[id].treasure === t, `${id}: treasure flag`); }
// marker interfaces
const items = readdirSync(join(DEC, 'item')).filter((f) => f.endsWith('.java'));
const impl = (iface) => items.filter((f) => new RegExp(`implements[^{]*\\b${iface}\\b`).test(rd('item/' + f)));
ok(impl('Vanishable').length >= 5 && impl('Wearable').length >= 2, 'marker implementers not found');
ok(/class EnchantedBookItem/.test(rd('item/EnchantedBookItem.java')), 'EnchantedBookItem missing');
ok(EH.isAcceptableItem('vanishing_curse', 'bow') && EH.isAcceptableItem('vanishing_curse', 'crossbow') && EH.isAcceptableItem('vanishing_curse', 'trident'), 'Vanishable item rejects vanishing_curse');
ok(EH.isAcceptableItem('binding_curse', 'iron_helmet') && EH.isAcceptableItem('binding_curse', 'elytra') === true || /Elytra.*Wearable/s.test(rd('item/ElytraItem.java')), 'Wearable binding_curse');
ok(!EH.isAcceptableItem('binding_curse', 'stone'), 'binding_curse accepted a non-wearable');

// anti-vacuity: break tables
function breakIt(f) { const saved = []; f(saved); const r = compare(EH); saved.forEach((u) => u()); breaks++; ok(r.bad > 0, 'break not caught'); }
for (const id of ['loyalty', 'mending', 'power', 'riptide', 'channeling']) breakIt((sv) => { const o = EH.MIN_POWER[id]; EH.MIN_POWER[id] = (l) => o(l) + 1; sv.push(() => { EH.MIN_POWER[id] = o; }); });
breakIt((sv) => { const o = EH.ENCH.piercing.maxLevel; EH.ENCH.piercing.maxLevel = 9; sv.push(() => { EH.ENCH.piercing.maxLevel = o; }); });
breakIt((sv) => { const o = EH.MAX_POWER.flame; EH.MAX_POWER.flame = () => 1; sv.push(() => { EH.MAX_POWER.flame = o; }); });
ok(compare(EH).bad === 0, 'restore failed');
console.log(fails.length ? fails.join('\n') + `\n${fails.length} failures` : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
