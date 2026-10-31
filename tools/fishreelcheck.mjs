#!/usr/bin/env node
// fishreelcheck.mjs — G24b: live reel-in through Fi.use. Open-water catches draw treasure, enclosed/shallow
// (inOpenWater=false) never do (FishingHookPredicate in the gameplay/fishing table); Luck of the Sea shifts treasure
// odds; loot flies to the player, an orb of 1..6 spawns, rod is damaged. Faults must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
console.log('fishreelcheck — G24b: fishing reel-in live');
const A = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07e_loot.js', '07q_effects.js', '07zzq_fishing.js'], dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8')), b64 = (f) => readFileSync(join(A, f)).toString('base64');
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const Fi = MCL.Fishing, JR = MCL.JRandom, IT = MCL.Items;
let drops = [], orbs = [], dmgs = [], removed = 0;
MCL.EntityList = { ready: true, canSpawn: () => true,
  dropStack: (x, y, z, id, n, o) => { drops.push({ name: IT.nameOf(id), n, o }); return {}; },
  spawn: (t, x, y, z) => { const o = { t, x, y, z }; orbs.push(o); return o; }, remove() { removed++; } };
MCL.Use = { damage: (P, s, d) => dmgs.push(d) };
const TREAS = new Set(['name_tag', 'saddle', 'bow', 'enchanted_book', 'nautilus_shell']);
const stack = { i: IT.of('fishing_rod'), d: 0 };
function catches(open, luck, n) {
  let treas = 0, bad = 0;
  for (let s = 1; s <= n; s++) {
    const P = { x: 3, y: 65, z: 4, luck: 0 };
    P.fishHook = { x: 0, y: 64, z: 0, hookCountdown: 30, luckOfTheSeaLevel: luck, inOpenWater: open, random: new JR(s * 7919 + luck) };
    drops = []; orbs = []; dmgs = [];
    Fi.use(P, stack);
    if (TREAS.has(drops[0] && drops[0].name)) treas++;
    const o = drops[0] && drops[0].o, orb = orbs[0];
    if (!o || Math.abs(o.vx - 0.3) > 1e-9 || Math.abs(o.vz - 0.4) > 1e-9 || !(o.vy > 0.1) || !orb || orb.value < 1 || orb.value > 6 || dmgs[0] !== 1 || P.fishHook) bad++;
  }
  return { treas: treas / n, bad };
}
function suite(tag) {
  const out = [], N = 3000;
  const a = catches(true, 0, N), b = catches(true, 3, N), c = catches(false, 0, N), d = catches(false, 3, N);
  if (a.bad || b.bad || c.bad || d.bad) out.push(tag + ' live catch shape bad ' + [a.bad, b.bad, c.bad, d.bad]);
  if (!(a.treas > 0.02)) out.push(tag + ' open water no treasure ' + a.treas);
  if (c.treas !== 0 || d.treas !== 0) out.push(tag + ' enclosed water gave treasure ' + c.treas + ' ' + d.treas);
  if (!(b.treas > a.treas * 1.5)) out.push(tag + ' luck does not shift treasure ' + a.treas + ' ' + b.treas);
  return out;
}
const fails = [], base = suite('baseline'); if (base.length) fails.push(...base);
let caught = 0;
const faults = {
  'openWater always true': () => { const o = MCL.Loot.rollTable; MCL.Loot.rollTable = (n, c) => o(n, Object.assign({}, c, { openWater: true })); return () => { MCL.Loot.rollTable = o; }; },
  'openWater always false': () => { const o = MCL.Loot.rollTable; MCL.Loot.rollTable = (n, c) => o(n, Object.assign({}, c, { openWater: false })); return () => { MCL.Loot.rollTable = o; }; },
  'luck term dropped': () => { const o = MCL.Loot.rollTable; MCL.Loot.rollTable = (n, c) => o(n, Object.assign({}, c, { luck: 0 })); return () => { MCL.Loot.rollTable = o; }; },
};
for (const [nm, inj] of Object.entries(faults)) {
  const undo = inj(); const r = suite('fault'); undo();
  if (r.length) { caught++; console.log('  ✓ fault caught: ' + nm); } else fails.push('fault not caught: ' + nm);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `OK  4 checks passed, 0 failures; live reel-in via Fi.use; ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
