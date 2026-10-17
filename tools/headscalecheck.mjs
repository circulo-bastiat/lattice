#!/usr/bin/env node
// headscalecheck.mjs — LivingEntity.getAttackDistanceScalingFactor mob-head clause (#5240):
// skeleton+skeleton_skull, zombie+zombie_head, creeper+creeper_head halve the observer's range.
import { readFileSync } from 'node:fs';
import { loadEngine, ASSETS } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '07q_effects.js', '07zf_bat.js'] });
const Iv = M.Inventory, IT = M.Items;
IT.init({ items: readFileSync(ASSETS + '/items.bin').toString('base64'), itemsBytes: JSON.parse(readFileSync(ASSETS + '/items.meta.json', 'utf8')).rawBytes });
let pass = 0, breaks = 0; const fails = [];
const eq = (a, b, m) => { if (a === b) pass++; else fails.push(m + ' got ' + a + ' want ' + b); };
const P = (head) => { const slots = []; if (head) slots[Iv.ARMOR_START + 3] = { i: IT.of(head), n: 1 }; return { type: 'player', inventory: { slots } }; };
const fr = 35, d = 20;
const sees = (scale, obs, head, scaleFn) => d <= Math.max(fr * scaleFn(P(head), { type: obs }), 2);
const real = (p, o) => M.Bat.attackScale(p, o);
const cases = [['zombie', null, true], ['zombie', 'zombie_head', false], ['zombie', 'creeper_head', true],
  ['skeleton', null, true], ['skeleton', 'skeleton_skull', false], ['skeleton', 'zombie_head', true],
  ['creeper', null, true], ['creeper', 'creeper_head', false], ['creeper', 'skeleton_skull', true],
  ['husk', 'zombie_head', true]];
const run = (fn) => { let bad = 0; for (const [o, h, want] of cases) if (sees(0, o, h, fn) !== want) bad++; return bad; };
eq(run(real), 0, 'real clause');
// breaks: each broken variant must be caught
const mutants = [
  (p, o) => M.Bat.attackScale(p),                                              // clause dropped
  (p, o) => { const s = M.Bat.attackScale(p); return p.inventory.slots[Iv.ARMOR_START + 3] ? s * 0.5 : s; }, // every type, every head
  (p, o) => { const s = M.Bat.attackScale(p, { type: 'zombie' }); return s; }, // mismatched pairing
];
for (const m of mutants) { breaks++; if (run(m) > 0) pass++; else fails.push('mutant survived'); }
console.log(`headscalecheck: ${pass} ok, ${fails.length} fail, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
