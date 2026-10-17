#!/usr/bin/env node
// advtrig-fishing_rod_hookedcheck.mjs — G17-AT14 (#7761). Drives the REAL call site (Fishing.reel = FishingBobberEntity.use)
// into Adv.matchers['minecraft:fishing_rod_hooked'] (FishingRodHookedCriterion); breaks its own matcher and call site.
// husbandry/tactical_fishing uses minecraft:filled_bucket in this data, so it is not this trigger's (not asserted).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07zzq_fishing.js'];
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const Adv = MCL.Adv, Fi = MCL.Fishing;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  let loot = [];
  MCL.Loot = { rollTable: () => loot };
  MCL.EntityList = { ready: true, dropStack() { return {}; }, spawn: () => ({}), remove() {} };
  const done = [];
  const P = { x: 3, y: 65, z: 4, luck: 0, type: 'player' };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const rod = { i: MCL.Items.of('fishing_rod'), d: 0 };
  const crit = (adv, k) => P.advancements.getProgress(Adv.manager.get('minecraft:' + adv)).criteria.get(k).date !== null;
  const bob = () => ({ x: 0, y: 64, z: 0, hookCountdown: 30, random: { nextInt: () => 0, nextFloat: () => 0 } });
  // junk catch: nothing
  loot = [{ item: 'minecraft:stick', count: 1 }]; Fi.reel(bob(), P, rod);
  no(!crit('husbandry/fishy_business', 'cod') && !done.includes('minecraft:husbandry/fishy_business'), 'stick granted a fish criterion');
  // hooked entity (no caught items) does not match an `item` condition
  const h = bob(); h.hookCountdown = 0; h.hookedEntity = { type: 'cow', x: 1, y: 64, z: 1 }; Fi.reel(h, P, rod);
  no(!crit('husbandry/fishy_business', 'cod'), 'hooked cow granted cod');
  loot = [{ item: 'minecraft:cod', count: 1 }]; Fi.reel(bob(), P, rod);
  no(crit('husbandry/fishy_business', 'cod'), 'cod catch not recorded');
  no(done.includes('minecraft:husbandry/fishy_business'), 'fishy_business (any one fish) not completed');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('07zzq_fishing.js', "'minecraft:fishing_rod_hooked', {", "'minecraft:fishing_rod_hooked_x', {")],
  ['item condition ignored', brk('02l_advancements.js', "if (!has(c.item)) return true;", "return true;")],
  ['caught list ignored', brk('02l_advancements.js', "return (ctx.caught || []).some(", "return [].some(")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:fishing_rod_hooked'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-fishing_rod_hookedcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-fishing_rod_hookedcheck: OK — ${caught} breaks caught`);
