#!/usr/bin/env node
// use14lproofcheck.mjs — #11566: the 14l_use.js classes the classmap could not map to a name:
// ModelPredicateProviderRegistry (Use.compassAngle/compassFrame), RangedWeaponItem (Use.getArrowSlot/getArrowType),
// Stat (Use.openStat -> Stats.inc), ActionResult (blockUse true=CONSUME/SUCCESS vs false=PASS), ScreenHandlerFactory
// (anvil opens through Hud.openAnvil + stat), VoxelShapes + BlockCollisionSpliterator (Use.eggOriginY).
// Feature is proven by bonemealfeatcheck (GrassBlock.grow -> Features.bonemealFlower). Each scenario is broken by source patch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const AS = join(MCLITE_ROOT, 'assets');
function trial(patch) {
  const E = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14j_combat.js', '14f_inventory.js', '07zzo_stats.js', '14l_use.js'], dom: false, ...(patch ? { patch } : {}) });
  E.Items.init({ items: readFileSync(join(AS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(AS, 'items.meta.json'), 'utf8')).rawBytes });
  const S = E.States, U = E.Use, IT = E.Items, Iv = E.Inventory;
  const cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
  const W = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; } };
  E.World = W; E.Behave.init(W); U.init(W);
  const o = {};
  // ModelPredicateProviderRegistry: lodestone compass in this dimension points at the target; frame table
  const dim = 'overworld';
  const stack = { i: IT.of('compass'), n: 1, t: { LodestoneDimension: 'minecraft:overworld', LodestonePos: { X: 100, Y: 64, Z: 0 } } };
  const a = U.compassAngle(stack, { x: 0, z: 0, yaw: 0, dim, time: 1, seed: 0, mainPlayer: false });
  o.angleEast = Math.abs(a - 0.75) < 2e-3;   // yaw 0 faces +Z; target +X -> 0.5-(0-.25-0)=0.75
  const other = { ...stack, t: { LodestoneDimension: 'minecraft:the_nether', LodestonePos: { X: 100, Y: 64, Z: 0 } } };
  o.angleOtherDim = U.lodestonePos(other, dim) === null && U.lodestonePos(stack, dim).x === 100;
  o.frames = U.compassFrame(0) === 16 && U.compassFrame(0.5) === 0 && U.compassFrame(0.999) === 16;
  // RangedWeaponItem: off hand first, then inventory order; creative gets a virtual arrow, survival none
  const P = { inventory: Iv.create(), slot: 0, instabuild: false, heldItem() { return Iv.getItem(this.inventory, this.slot); } };
  o.noAmmo = U.getArrowSlot(P) === -1 && U.getArrowType(P) === null;
  Iv.setItem(P.inventory, 5, Iv.stack('spectral_arrow', 1));
  o.invSlot = U.getArrowSlot(P) === 5;
  Iv.setItem(P.inventory, Iv.OFFHAND, Iv.stack('arrow', 1));
  o.offFirst = U.getArrowSlot(P) === Iv.OFFHAND;
  o.creativeVirtual = !!U.getArrowType({ inventory: Iv.create(), slot: 0, instabuild: true, heldItem() { return Iv.EMPTY; } });
  o.notArrow = !U.isArrowItem(Iv.stack('stick', 1)) && U.isArrowItem(Iv.stack('tipped_arrow', 1));
  // Stat
  E.Stats.reset(); U.openStat('eat_cake_slice'); U.openStat('eat_cake_slice');
  o.stat = E.Stats.getCustom('eat_cake_slice') === 2;
  o.statIf = (E.Stats.reset(), U.openStatIf(false, 'interact_with_anvil') === false && E.Stats.getCustom('interact_with_anvil') === 0 && U.openStatIf(true, 'interact_with_anvil') === true && E.Stats.getCustom('interact_with_anvil') === 1);
  // ScreenHandlerFactory (anvil) + ActionResult CONSUME vs PASS
  const anvil = S.stateOf('anvil'); cells.set(k(0, 10, 0), anvil);
  const mk = () => ({ inventory: Iv.create(), slot: 0, x: 0, y: 11, z: 0, instabuild: false });
  let opened = 0; E.Hud = { openAnvil: () => { opened++; return true; } };
  E.Stats.reset();
  const r1 = U.blockUse(mk(), 0, 10, 0, anvil, Iv.EMPTY);
  o.anvilOpens = r1 === true && opened === 1 && E.Stats.getCustom('interact_with_anvil') === 1;
  E.Hud = { openAnvil: () => false }; E.Stats.reset();
  const r2 = U.blockUse(mk(), 0, 10, 0, anvil, Iv.EMPTY);
  o.anvilPass = r2 === false && E.Stats.getCustom('interact_with_anvil') === 0;
  // VoxelShapes.calculateMaxOffset + BlockCollisionSpliterator: where a spawned mob rests
  cells.clear();
  o.originAir = U.eggOriginY(0, 10, 0, 0.6, false) === 0;
  cells.set(k(0, 10, 0), S.stateOf('stone'));
  o.originStone = U.eggOriginY(0, 10, 0, 0.6, false) === 1;
  cells.set(k(0, 10, 0), S.stateOf('white_carpet'));
  o.originCarpet = Math.abs(U.eggOriginY(0, 10, 0, 0.6, false) - 0.0625) < 1e-9;
  return o;
}
const A = trial(null);
for (const key of Object.keys(A)) ok(A[key], 'scenario ' + key);
const BR = [
  ['angleEast', /var a = Math\.atan2\(dz, dx\)/, 'var a = Math.atan2(dx, dz)'],
  ['angleOtherDim', /if \(t\.LodestoneDimension !== cmpDimKey\(dim\)\) return null;|t\.LodestoneDimension !== cmpDimKey\(dim\)\) return null;/, 'false) return null;'],
  ['frames', /\(16 \+ Math\.floor\(\(angle \* 64 \+ 1\) \/ 2\)\) % 32/, '(16 + Math.floor(angle * 32)) % 32'],
  ['offFirst', /if \(Use\.isArrowItem\(off\)\) return Iv\.OFFHAND;/, ''],
  ['invSlot', /if \(Use\.isArrowItem\(Iv\.getItem\(P\.inventory, i\)\)\) return i;/, ''],
  ['creativeVirtual', /\(P\.instabuild && Iv\) \? Iv\.stack\('arrow', 1\) : null/, 'null'],
  ['notArrow', /n === 'arrow' \|\| n === 'tipped_arrow' \|\| n === 'spectral_arrow'/, "n === 'arrow' || n === 'stick'"],
  ['stat', /if \(NS\.Stats && NS\.Stats\.inc\) NS\.Stats\.inc\(id\); \};\n  Use\.openStatIf/, '};\n  Use.openStatIf'],
  ['statIf', /if \(r\) Use\.openStat\(id\); return !!r;/, 'Use.openStat(id); return !!r;'],
  ['anvilOpens', /'interact_with_anvil'\);\n    \}/, "'x');\n    }"],
  ['anvilPass', /return Use\.openStatIf\(HdA && HdA\.openAnvil && HdA\.openAnvil\(x, y, z\), 'interact_with_anvil'\);/, 'HdA.openAnvil(x, y, z); return true;'],
  ['originStone', /if \(by1 > feet \+ EPS\) continue;\n        var d = by1 - feet;\n        if \(d > off\) off = d;/, 'var d = by1 - feet - 1; if (d > off) off = d; continue;'],
  ['originCarpet', /var d = by1 - feet;\n        if \(d > off\) off = d;/, 'var d = 0;\n        if (d > off) off = d;'],
  ['originAir', /return 1 \+ off;\n  \};\n  \/\*\*\n   \* `EntityType\.spawnFromItemStack`/, 'return 1 + off + 1;\n  };\n  /**\n   * `EntityType.spawnFromItemStack`'],
];
for (const [key, re, rep] of BR) {
  breaks++;
  const src = readFileSync(join(MCLITE_ROOT, 'src/14l_use.js'), 'utf8');
  if (!re.test(src)) { fails.push('no-op break: ' + key); continue; }
  let B; try { B = trial((f, s) => f === '14l_use.js' ? s.replace(re, rep) : s); } catch { B = {}; }
  ok(!B[key], 'anti-vacuity: break ' + key + ' must fail it');
  if (!B[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `use14lproofcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
