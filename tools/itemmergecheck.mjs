#!/usr/bin/env node
// itemmergecheck.mjs — #5649: ItemEntity.tick's merge cadence (2 if the block cell changed, else 40) and isMergable.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js'], initReg: false });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init();
const EL = M.EntityList;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// first tick age (1..80) at which a freshly set-up pair merges; null if never
function firstMerge(moving, setup) {
  for (let age = 1; age <= 80; age++) {
    EL.clear();
    const a = EL.dropStack(10.1, 70, 10.1, 7, 5), b = EL.dropStack(10.3, 70, 10.3, 7, 5);
    a.pickupDelay = b.pickupDelay = 0; a.age = age; b.age = age;
    a.px = a.x; a.py = a.y; a.pz = a.z;
    if (moving) a.px = a.x - 1;                       // crossed a block boundary this tick
    if (setup) setup(a, b);
    EL.tickItem(a);
    if (a.removed || b.removed) return age;
  }
  return null;
}
const rest = firstMerge(false), mov = firstMerge(true);
ok(rest === 40, `stationary pair first merges at tick ${rest}, expected 40`);
ok(mov === 2, `block-crossing pair first merges at tick ${mov}, expected 2`);
ok(firstMerge(true, (a) => { a.pickupDelay = 32767; }) === null, 'PickupDelay 32767 stack merged');
{ EL.clear();
  const a = EL.dropStack(10.1, 70, 10.1, 7, 5), b = EL.dropStack(10.3, 70, 10.3, 7, 5);
  a.pickupDelay = b.pickupDelay = 0; a.px = a.x - 1; a.py = a.y; a.pz = a.z;
  a.age = -32768; EL.tickItem(a);
  ok(!b.removed && !a.removed, 'Age -32768 stack merged');
  a.age = 6000; EL.tickItem(a);
  ok(!b.removed, 'Age>=6000 stack merged'); }

// #5650: tryToMerge exact
{ const pair = (ca, cb, f) => { EL.clear(); const a = EL.dropStack(10.1, 70, 10.1, 7, ca), b = EL.dropStack(10.3, 70, 10.3, 7, cb);
    a.pickupDelay = b.pickupDelay = 0; a.age = b.age = 40; if (f) f(a, b); EL.tickItem(a); return [a, b]; };
  let [a, b] = pair(5, 5, (a, b) => { a.tag = { ench: 1 }; b.tag = { ench: 2 }; });
  ok(!a.removed && !b.removed, 'different tags merged');
  [a, b] = pair(5, 5, (a, b) => { a.owner = 'x'; b.owner = 'y'; });
  ok(!a.removed && !b.removed, 'different owners merged');
  [a, b] = pair(5, 40);
  ok(a.removed && !b.removed && b.count === 45, 'ticking 5-stack did not yield to the 40-stack');
  [a, b] = pair(5, 40, (a, b) => { a.pickupDelay = 3; b.pickupDelay = 9; a.age = 40; b.age = 80; });
  // a's itemAge is 39 mid-tick (age++ done, itemAge++ not): min(39, 80) lands on b before b's own ++
  ok(b.pickupDelay === 9 && b.age === 39, `pickupDelay/age not max/min: ${b.pickupDelay}/${b.age}`);
  [a, b] = pair(5, 5, (a, b) => { b.x = a.x + 0.7; });
  ok(b.removed || a.removed, 'boxes intersecting at 0.7 centre distance did not merge'); }
breaks++;
{ const keep = EL.canMerge; EL.canMerge = (a, b) => keep(a, b) || (a && b && a.item === b.item && a.count + b.count <= 64 && a !== b);
  EL.clear(); const a = EL.dropStack(10.1, 70, 10.1, 7, 5), b = EL.dropStack(10.3, 70, 10.3, 7, 5);
  a.pickupDelay = b.pickupDelay = 0; a.age = b.age = 40; a.tag = { e: 1 }; EL.tickItem(a);
  if (a.removed || b.removed) console.log('   ✓ ignoring tags is detected'); else fails.push('anti-vacuity: tag rule not detected');
  EL.canMerge = keep; }

// anti-vacuity: old cadence (every 2nd tick, no guard) must fail the same asserts
breaks++;
const oldRest = EL.ITEM_MERGE_RESTING, oldMergable = EL.isMergable;
EL.ITEM_MERGE_RESTING = 2; EL.isMergable = () => true;
if (firstMerge(false) !== 40) console.log('   ✓ old 2-tick resting cadence is detected'); else fails.push('anti-vacuity: old cadence not detected');
EL.ITEM_MERGE_RESTING = oldRest; EL.isMergable = oldMergable;
breaks++;
EL.isMergable = () => true;
{ EL.clear();
  const a = EL.dropStack(10.1, 70, 10.1, 7, 5), b = EL.dropStack(10.3, 70, 10.3, 7, 5);
  a.pickupDelay = 32767; a.px = a.x - 1; a.py = a.y; a.pz = a.z; a.age = 2; EL.tickItem(a);
  if (b.removed || a.removed) console.log('   ✓ removing the isMergable guard is detected'); else fails.push('anti-vacuity: removed guard not detected'); }
EL.isMergable = oldMergable;

if (fails.length) { console.log('itemmergecheck FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(` assertions passed .. ${pass}\n breaks caught ...... ${breaks}`);
