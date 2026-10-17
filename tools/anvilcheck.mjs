#!/usr/bin/env node
// anvilcheck.mjs — G22d: the anvil (src/07zzp_anvil.js) against AnvilScreenHandler.updateResult /
// onTakeOutput (.decomp/net/minecraft/screen/AnvilScreenHandler.java). The oracle below is a
// transcription of the jar's arithmetic for the cases it covers, not a call into the module.
// Anti-vacuity: three mutants of the module's own source (penalty ignored, doubling removed,
// 40-cap removed) must each fail the same assertions ("<n> breaks caught").

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const SRCFILE = join(MCLITE_ROOT, 'src', '07zzp_anvil.js');

const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14g_menu.js', '07ox_enchhelper.js', '07zzp_anvil.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const Iv = MCL.Inventory, IT = MCL.Items;
const st = (name, n, d, t) => Iv.stack(name, n, d, t);
const book = (id, lvl, rc) => st('enchanted_book', 1, 0, Object.assign({ StoredEnchantments: [{ id: 'minecraft:' + id, lvl }] }, rc ? { RepairCost: rc } : {}));
const sword = (rc, d, ench) => st('iron_sword', 1, d || 0, Object.assign({}, rc ? { RepairCost: rc } : {}, ench ? { Enchantments: ench } : {}));

/** Runs every assertion against an `Anvil`; returns the failure messages. */
let count = 0;
function run(An) {
  const fails = [];
  const ok = (c, m) => { count++; if (!c) fails.push(m); };
  // 1. prior-work penalty at three values: sword(RepairCost p) + book(sharpness III).
  //    jar: cost = p + rarityMult(COMMON=1) * 3 (a book halves: max(1, 1/2) = 1); RepairCost' = 2p+1.
  for (const p of [0, 3, 7]) {
    const r = An.compute(sword(p), book('sharpness', 3), '', {});
    ok(r.output && r.cost === p + 3, `p=${p}: cost ${r.cost} != ${p + 3}`);
    ok(r.output && r.output.t.RepairCost === 2 * p + 1, `p=${p}: RepairCost'=${r.output && r.output.t.RepairCost} != ${2 * p + 1}`);
    ok(r.output && r.output.t.Enchantments[0].lvl === 3, `p=${p}: sharpness III missing`);
  }
  // 2. Too Expensive: p=37 -> 40 refuses in survival, allowed in creative.
  ok(An.compute(sword(37), book('sharpness', 3), '', {}).output === null, 'cost 40 must refuse in survival');
  ok(An.compute(sword(36), book('sharpness', 3), '', {}).output !== null, 'cost 39 must pass');
  ok(An.compute(sword(37), book('sharpness', 3), '', { instabuild: true }).output !== null, 'creative ignores the cap');
  // 3. material repair loops per ingot: d=100 of 250, step min(d, 62): 100 -> 38 -> 0, 2 ingots, 2 levels.
  let r = An.compute(sword(0, 100), st('iron_ingot', 4), '', {});
  ok(r.output && r.output.d === 0 && r.cost === 2 && r.repairUsage === 2, 'ingot repair 100 -> 0 for 2 levels');
  r = An.compute(sword(0, 200), st('iron_ingot', 4), '', {});
  ok(r.output && r.output.d === 0 && r.cost === 4 && r.repairUsage === 4, '200 damage: 200/138/76/14/0, four ingots');
  r = An.compute(sword(0, 200), st('iron_ingot', 2), '', {});
  ok(r.output && r.output.d === 76 && r.cost === 2 && r.repairUsage === 2, 'stack-limited repair: 200 -> 76');
  ok(An.compute(sword(0, 0), st('iron_ingot', 1), '', {}).output === null, 'undamaged + ingot: nothing');
  ok(An.compute(sword(0, 100), st('diamond', 1), '', {}).output === null, 'wrong material: nothing');
  // 4. combine two damaged swords: left 150 + 100 + 250*12/100(30) = 280 -> cap: 250-280<0 -> 0; cost 2, penalty 2*0+1.
  r = An.compute(sword(0, 100), sword(0, 150), '', {});
  ok(r.output && r.output.d === 0 && r.cost === 2, 'sword+sword combine: repaired fully for 2');
  // 5. rename: cost 1, RepairCost unchanged (rename === cost); at total >= 40 clamps to 39.
  r = An.compute(sword(0), Iv.EMPTY, 'Excalibur', {});
  ok(r.output && r.cost === 1 && r.output.t.display.Name === 'Excalibur' && !r.output.t.RepairCost, 'rename costs 1, no penalty');
  r = An.compute(sword(45), Iv.EMPTY, 'Excalibur', {});
  ok(r.output && r.cost === 39, 'rename-only clamps to 39');
  r = An.compute(st('iron_sword', 1, 0, { display: { Name: 'Old' } }), Iv.EMPTY, '', {});
  ok(r.output && r.cost === 1 && !r.output.t.display, 'blank name strips the custom name');
  ok(An.compute(sword(0), Iv.EMPTY, 'iron_sword', { defaultName: () => 'iron_sword' }).output === null, 'unchanged name: nothing');
  // 6. enchant rules: incompatible (sharpness vs smite) -> nothing; same level +1; cap at max; stack>1 -> 40.
  ok(An.compute(sword(0, 0, [{ id: 'minecraft:sharpness', lvl: 1 }]), book('smite', 1), '', {}).output === null, 'sharpness+smite conflict');
  r = An.compute(sword(0, 0, [{ id: 'minecraft:sharpness', lvl: 2 }]), book('sharpness', 2), '', {});
  ok(r.output && r.output.t.Enchantments[0].lvl === 3 && r.cost === 3, 'II+II -> III');
  r = An.compute(sword(0, 0, [{ id: 'minecraft:sharpness', lvl: 5 }]), book('sharpness', 5), '', {});
  ok(r.output && r.output.t.Enchantments[0].lvl === 5, 'capped at V');
  ok(An.compute(sword(0), book('protection', 1), '', {}).output === null, 'protection does not fit a sword');
  ok(An.compute(sword(0), book('protection', 1), '', { instabuild: true }).output !== null, 'creative fits anything');
  r = An.compute(sword(0), book('mending', 1), '', {});          // RARE 2 -> x4, book halves to 2
  ok(r.output && r.cost === 2, 'mending book on a sword costs 2');
  // 7. take: levels, inputs, block damage at 12%.
  const m = { a: sword(0, 100), b: st('iron_ingot', 4) };
  r = An.compute(m.a, m.b, '', {});
  const t = An.take(m, r, 'anvil', false, () => 0.05);
  ok(t.levels === 2 && Iv.isEmpty(m.a) && m.b.n === 2, 'take spends 2 levels, 2 ingots');
  ok(t.block.to === 'chipped_anvil' && t.block.sound === 1030, '12% roll chips the anvil');
  ok(An.take({ a: sword(0), b: Iv.EMPTY }, { cost: 3, repairUsage: 0 }, 'damaged_anvil', false, () => 0).block.sound === 1029, 'damaged anvil breaks');
  ok(An.take({ a: sword(0), b: Iv.EMPTY }, { cost: 3, repairUsage: 0 }, 'anvil', false, () => 0.5).block.to === undefined, 'no damage above 12%');
  ok(An.canTake(3, 3, false) && !An.canTake(3, 2, false) && !An.canTake(0, 9, false) && An.canTake(3, 0, true), 'canTake');
  // 8. the menu (Menu.anvilMenu): output pickup gated on levels, inputs consumed, block callback.
  const M = MCL.Menu;
  const mk = (lvl, creative) => {
    const p = { instabuild: !!creative, xpLevel: lvl, inventory: Iv.create() };
    const seen = [];
    const mm = M.anvilMenu(p.inventory, p, { blockName: () => 'anvil', onBlock: (b) => seen.push(b) });
    return { p, mm, seen };
  };
  {
    const { p, mm } = mk(1, false);
    M.slotSet(mm.slots[0], sword(0, 100)); M.slotSet(mm.slots[1], st('iron_ingot', 4));
    ok(M.slotHas(mm.slots[2]) && mm.r.cost === 2, 'menu: repair output appears at cost 2');
    M.doClick(mm, 2, 0, M.PICKUP, p);
    ok(M.getCarried(mm) === null && M.slotHas(mm.slots[0]), 'menu: 1 level cannot take a cost-2 output');
    p.xpLevel = 2;
    M.doClick(mm, 2, 0, M.PICKUP, p);
    ok(M.getCarried(mm) && M.getCarried(mm).d < 100 && !M.slotHas(mm.slots[0]) && mm.slots[1].container.get(1).n === 2, 'menu: 2 levels take the output, spend input 0 and 2 ingots');
  }
  {
    const { p, mm, seen } = mk(0, true);
    M.slotSet(mm.slots[0], sword(0, 100)); M.slotSet(mm.slots[1], st('iron_ingot', 1));
    M.doClick(mm, 2, 0, M.PICKUP, p);
    ok(M.getCarried(mm) && seen.length === 1, 'menu: creative takes it free and reports the block roll');
  }
  return fails;
}

const fails = run(MCL.Anvil);
const total = count;
console.log('anvilcheck — G22d anvil rules (07zzp_anvil.js)');
const src = readFileSync(SRCFILE, 'utf8');
const mutants = [
  ['penalty fixed (RepairCost read as 0)', 'extra += repairCostOf(a) +', 'extra += 0 * repairCostOf(a) +'],
  ['doubling removed', 'rc = An.getNextCost(rc);', 'rc = rc;'],
  ['Too Expensive cap removed', 'if (total >= 40 && !opts.instabuild) out = null;', ''],
];
let breaks = 0;
const saved = MCL.Anvil;
for (const [name, from, to] of mutants) {
  if (!src.includes(from)) { fails.push('mutant anchor missing: ' + name); continue; }
  new Function('MCL', src.replace(from, to))(MCL);
  const f = run(MCL.Anvil);
  MCL.Anvil = saved;
  if (f.length) { breaks++; console.log('  ✓ mutant caught: ' + name); } else fails.push('anti-vacuity: mutant survived — ' + name);
}
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL ' + fails.length); process.exit(1); }
console.log(`OK  ${total} checks passed, 0 failures; anvil rules match the jar formula; ${breaks} breaks caught`);
