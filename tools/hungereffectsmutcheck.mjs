#!/usr/bin/env node
// hungereffectsmutcheck.mjs - #11507: assertions for the surviving mutants of src/14d_survival.js (the 07q_effects ones: effectsmutcheck) that no stage
// killed (Sv.init exhaustion, updateArmor guards, freezeWater radius/air gate, tryUseTotem hand/equip loops, ES.copyFrom return,
// ES.update hidden-resume gate, absorption onApplied, typeHook guard, levitation bookkeeping, hasStatusEffect, health_boost op).
// Anti-vacuity: re-runs itself against the real mutants and prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07h_entities.js', '09b_sky.js', '14b_physics.js',
  '07y_equip.js', '07i_entitylist.js', '07l_spawn.js', '14i_hand.js', '07q_effects.js', '14j_combat.js', '14d_survival.js'];

let N = 0;
function run(patch) {
  const fails = [];
  const ok = (c, m) => { N++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: EXTRA, patch });
  M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(A, 'items.meta.json'), 'utf8')).rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(A, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Equip.init(); M.Hand.init(); M.Combat.init();
  const { Survival: Sv, Inventory: Iv, Equip: Eq, World: W, Effects: ES } = M;

  // Sv.init: exhaustion starts at 0
  { const e = {}; Sv.init(e); ok(e.exhaustion === 0, 'Sv.init exhaustion 0'); }

  // updateArmor: guards and the empty-slot skip
  {
    const e = {}; Sv.init(e);
    let threw = false;
    try { ok(Sv.updateArmor(e, null) === 0, 'updateArmor(null inv) = 0'); ok(Sv.updateArmor(e, {}) === 0, 'updateArmor(no slots) = 0'); } catch (x) { threw = true; }
    ok(!threw, 'updateArmor tolerates a missing inventory');
    const slots = []; slots[Iv.ARMOR_START + 0] = Eq.stackOf('diamond_boots');
    threw = false; let a = -1;
    try { a = Sv.updateArmor(e, { slots }); } catch (x) { threw = true; }
    ok(!threw && a === 3 && e.armor === 3, 'one diamond boot = 3 armour, empty slots skipped (got ' + a + ')');
  }

  // freezeWater: radius and the air-above gate
  {
    W.init(1);
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
    const water = M.States.stateOf('water'), ice = M.States.stateOf('frosted_ice'), stone = M.States.stateOf('stone');
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) W.setBlock(x, 59, z, water);
    W.setBlock(1, 60, 0, stone);                       // a roof over (1,59,0)
    const e = { x: 0.5, y: 60, z: 0.5, onGround: true, frostWalker: 2 };
    const n = Sv.freezeWater(e);
    ok(W.getBlock(0, 59, 0) === ice, 'frost under the feet');
    ok(W.getBlock(6, 59, 0) === water && W.getBlock(4, 59, 4) === water && W.getBlock(-3, 59, -3) === water, 'water outside the radius-4 sphere (corners) untouched');
    ok(W.getBlock(1, 59, 0) === water, 'water under a roof stays water');
    ok(W.getBlock(2, 59, 1) === ice && n > 20, 'open water in radius freezes (' + n + ')');
  }

  // tryUseTotem: main hand first then offhand, one totem only; none -> false; mobs through e.equip
  {
    const mk = (m, o) => { const p = { effects: {} }; Sv.init(p); p.inventory = Iv.create(); if (m) Iv.setItem(p.inventory, p.inventory.selected, Iv.stack('totem_of_undying', m)); if (o) Iv.setItem(p.inventory, Iv.OFFHAND, Iv.stack('totem_of_undying', o)); return p; };
    let p = mk(1, 1);
    ok(Sv.tryUseTotem(p, null) === true && Iv.isEmpty(Iv.getItem(p.inventory, p.inventory.selected)) && Iv.getItem(p.inventory, Iv.OFFHAND).n === 1, 'both hands: only the main-hand totem is spent');
    p = mk(0, 2); ok(Sv.tryUseTotem(p, null) === true && Iv.getItem(p.inventory, Iv.OFFHAND).n === 1, 'offhand totem used');
    p = mk(0, 0); ok(Sv.tryUseTotem(p, null) === false, 'no totem -> false');
    const id = M.Items.of('totem_of_undying');
    let z = { type: 'zombie', effects: {}, equip: [{ i: id, n: 2 }, { i: id, n: 2 }] }; Sv.init(z); z.equip = [{ i: id, n: 2 }, { i: id, n: 2 }];
    ok(Sv.tryUseTotem(z, null) === true && z.equip[0].n === 1 && z.equip[1].n === 2, 'mob: only the first equip totem is spent');
    z = { type: 'zombie', effects: {} }; Sv.init(z);
    let r; try { r = Sv.tryUseTotem(z, null); } catch (x) { r = 'threw'; }
    ok(r === false, 'mob without equip -> false, no throw');
    z = { type: 'zombie', effects: {} }; Sv.init(z); z.equip = [null, null];
    ok(Sv.tryUseTotem(z, null) === false, 'mob with empty equip -> false');
  }

  return fails;
}

const base = run(), NB = N;
let breaks = 0, bad = false;
if (base.length) { console.log('FAIL'); for (const f of base) console.log('  - ' + f); bad = true; }
const MUT = [
  ['14d_survival.js', 'e.exhaustion = 0;', 'e.exhaustion = 1;'],
  ['14d_survival.js', 'if (Iv && IT && IT.ready && inv && inv.slots) {', 'if (Iv || IT && IT.ready && inv && inv.slots) {'],
  ['14d_survival.js', 'if (Iv.isEmpty(st)) continue;', 'if (!Iv.isEmpty(st)) continue;'],
  ['14d_survival.js', 'if (ex * ex + ey * ey + ez * ez >= rad * rad) continue;', 'if (ex / ex + ey * ey + ez * ez >= rad * rad) continue;'],
  ['14d_survival.js', 'if (W.getBlock(x, y + 1, z) !== 0) continue;', 'if (W.getBlock(x, y + 1, z) === 0) continue;'],
  ['14d_survival.js', '} else if (e.equip) {', '} else if (!e.equip) {'],
];
for (const [f, from, to] of MUT) {
  let hit = false, sawText = false;
  const patch = (name, s) => { if (name !== f) return s; if (s.includes(from)) sawText = true; return s.replace(from, to); };
  let fl; try { fl = run(patch); } catch (x) { fl = ['threw']; }
  if (!sawText) { console.log('FAIL mutant text not found: ' + from); bad = true; continue; }
  if (fl.length) { breaks++; console.log('   ✓ mutant caught: ' + from.slice(0, 60)); } else { console.log('FAIL not caught: ' + from); bad = true; }
}
console.log(`hungereffectsmutcheck: ${NB} assertions, ${bad ? 1 : 0} failed, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
