#!/usr/bin/env node
// enchtoolscheck.mjs — G22f (#198): tool-side enchantments read off the HELD stack.
//   1. P.miningContext carries silk_touch / fortune / efficiency levels of the held stack (0 when none).
//   2. Efficiency: Mining.playerSpeed adds level^2 + 1 once speed > 1 (EnchantmentHelper / PlayerEntity.getBlockBreakingSpeed).
//   3. Unbreaking: Use.damage negates each point with chance level/(level+1) (UnbreakingEnchantment.shouldPreventDamage).
// Anti-vacuity (D-30): each term is zeroed and the section must go red. Prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT as ROOT } from './loadsrc.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
function run(patch) {
const M = loadEngine({ patch,
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07d_mining.js',
    '07e_loot.js', '07i_entitylist.js', '07y_equip.js', '14d_survival.js', '14j_combat.js', '07ox_enchhelper.js', '14l_use.js', '14_player.js'],
  initReg: true, dom: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const { Items: IT, Inventory: Iv, Combat: Cb, Mining: Mi, States: S, Use } = M;

const P = M.Player;
P.slot = 0; P.inventory = { slots: new Array(Iv.SIZE || 46).fill(null), selected: 0 };
P.instabuild = false; P.x = P.y = P.z = 0;
const hold = (item, list, d) => {
  const st = { i: IT.of(item), n: 1, d: d | 0 };
  if (list) st.t = { Enchantments: list.map(([id, lvl]) => ({ id: 'minecraft:' + id, lvl })) };
  P.inventory.slots.fill(null); P.inventory.slots[0] = st; return st;
};
let asserts = 0;
const eq = (f, got, want, m) => { asserts++; if (got !== want) f.push(`${m}: got ${got}, want ${want}`); };

function sectionContext(Pc) {
  const f = [];
  hold('diamond_pickaxe', [['silk_touch', 1], ['fortune', 3], ['efficiency', 4]]);
  const c = Pc.miningContext();
  eq(f, c.silkTouch, 1, 'silkTouch'); eq(f, c.fortune, 3, 'fortune'); eq(f, c.efficiency, 4, 'efficiency');
  hold('diamond_pickaxe', null);
  const z = Pc.miningContext();
  eq(f, z.silkTouch + z.fortune + z.efficiency, 0, 'bare tool levels');
  return f;
}
function sectionEfficiency(speedFn) {
  const f = [];
  const st = S.block[S.stateOf('stone')], base = { item: 'diamond_pickaxe', onGround: true };
  const s0 = speedFn(st, Object.assign({ efficiency: 0 }, base));
  for (let l = 1; l <= 5; l++) eq(f, speedFn(st, Object.assign({ efficiency: l }, base)), Math.fround(s0 + (l * l + 1)), 'efficiency ' + l);
  eq(f, speedFn(st, { item: 'stick', efficiency: 5, onGround: true }), 1, 'no tool, speed 1 gets no bonus');
  return f;
}
function sectionUnbreaking(dmg) {
  const f = [];
  let seed = 12345;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const oldR = Math.random; Math.random = rng;
  const N = 6000;
  for (const lvl of [0, 1, 3]) {
    let used = 0;
    for (let k = 0; k < N; k++) { const st = hold('diamond_pickaxe', lvl ? [['unbreaking', lvl]] : null); dmg(P, st, 1); used += st.d; }
    const want = 1 / (lvl + 1);
    asserts++;
    if (Math.abs(used / N - want) > 0.03) f.push(`unbreaking ${lvl}: wear rate ${(used / N).toFixed(3)}, want ${want.toFixed(3)}`);
  }
  Math.random = oldR;
  return f;
}


const f = [];
for (const [n, r] of [['context', sectionContext(P)], ['efficiency', sectionEfficiency(Mi.playerSpeed)], ['unbreaking', sectionUnbreaking(Use.damage)]])
  for (const m of r) f.push(n + ': ' + m);
return { f, asserts };
}
const base = run(null);
for (const m of base.f) console.log('   ✗ ' + m);
let caught = 0, missed = 0;
const breaks = [
  ['14_player.js', "efficiency: lv('efficiency')", "efficiency: 0"],
  ['14_player.js', "silkTouch: lv('silk_touch')", "silkTouch: 0"],
  ['14_player.js', "fortune: lv('fortune')", "fortune: 0"],
  ['07d_mining.js', 'c.efficiency * c.efficiency + 1', '0'],
  ['14l_use.js', "enchantLevel(stack, 'unbreaking') : 0", "enchantLevel(stack, 'unbreaking') * 0 : 0"],
];
for (const [file, a, b] of breaks) {
  let hit = false;
  const r = run((fn, src) => { if (fn !== file) return src; hit = src.includes(a); return src.replace(a, b); });
  if (!hit) { console.log('   ✗ break did not match: ' + a); missed++; } else if (r.f.length) { caught++; console.log('   ✓ caught: ' + a); } else { console.log('   ✗ break survived: ' + a); missed++; }
}
console.log(`enchtoolscheck: ${base.asserts} assertions, ${base.f.length} failures, ${caught} breaks caught`);
process.exit(base.f.length || missed ? 1 : 0);
