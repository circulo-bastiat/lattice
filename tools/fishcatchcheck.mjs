#!/usr/bin/env node
// fishcatchcheck.mjs — G17-F4: FishingBobberEntity.use reel-in (07zzq_fishing.js Fi.reel). 5000 catches at luck 0 and 3
// through the real packed gameplay/fishing table; the junk/treasure/fish split must sit inside the chi-square bound
// for the .decomp weights (10/5/85, quality -2/+2/-1), the item velocity is asserted exactly, orbs are 1..6,
// durability is 1, and three injected faults must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
console.log('fishcatchcheck — G17-F4: fishing reel-in');
const A = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07e_loot.js', '07q_effects.js', '07zzq_fishing.js'], dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8')), b64 = (f) => readFileSync(join(A, f)).toString('base64');
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Loot.init({ loot: readFileSync(join(A, 'loot.bin')).toString('base64'), lootBytes: JSON.parse(readFileSync(join(A, 'loot.meta.json'), 'utf8')).jsonBytes });
const Fi = MCL.Fishing, JR = MCL.JRandom, IT = MCL.Items;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let drops = [], orbs = [];
MCL.EntityList = { ready: true,
  dropStack: (x, y, z, id, n, o) => { drops.push({ name: IT.nameOf(id), n, o }); return {}; },
  spawn: (t, x, y, z) => { const o = { t, x, y, z }; orbs.push(o); return o; }, remove() {} };
const P = { x: 3, y: 65, z: 4, luck: 0 };
const stack = { i: IT.of('fishing_rod'), d: 0 };
const FISH = new Set(['cod', 'salmon', 'tropical_fish', 'pufferfish']);
const TREAS = new Set(['name_tag', 'saddle', 'bow', 'enchanted_book', 'book', 'nautilus_shell']);
function roll(luck, seed) {
  const e = { x: 0, y: 64, z: 0, hookCountdown: 30, luckOfTheSeaLevel: luck, openWater: true, random: new JR(seed) };
  drops = []; orbs = [];
  const dmg = Fi.reel(e, P, stack);
  return { dmg, drops: drops.slice(), orbs: orbs.slice() };
}
function split(luck) {
  const c = { fish: 0, treas: 0, junk: 0, rod: 0 }, orbSeen = new Set(); let bad = 0;
  for (let s = 1; s <= 5000; s++) {
    const r = roll(luck, s * 7919 + luck);
    if (r.dmg !== 1) bad++;
    for (const o of r.orbs) orbSeen.add(o.value);
    const n = r.drops[0] && r.drops[0].name;
    if (FISH.has(n)) c.fish++; else if (TREAS.has(n)) c.treas++; else if (n === 'fishing_rod') c.rod++; else c.junk++;
  }
  return { c, bad, orbSeen };
}
function chi(luck) {
  const w = luck ? [4, 11, 82] : [10, 5, 85], t = w[0] + w[1] + w[2];
  const pj = w[0] / t, pt = w[1] / t, pf = w[2] / t;
  const exp = { fish: pf, treas: pt * 5 / 6, junk: pj * 0.98, rod: pj * 0.02 + pt / 6 };
  const { c, bad, orbSeen } = split(luck);
  let x = 0; for (const k in exp) x += (c[k] - 5000 * exp[k]) ** 2 / (5000 * exp[k]);
  return { x, c, bad, orbSeen };
}
function suite(tag) {
  const out = [];
  for (const luck of [0, 3]) {
    const r = chi(luck);
    if (!(r.x < 16.27)) out.push(`${tag} luck ${luck}: chi2 ${r.x.toFixed(1)} ${JSON.stringify(r.c)}`);
    if (r.bad) out.push(`${tag} luck ${luck}: ${r.bad} catches with damage != 1`);
    const lo = Math.min(...r.orbSeen), hi = Math.max(...r.orbSeen);
    if (lo !== 1 || hi !== 6) out.push(`${tag} luck ${luck}: orb range ${lo}..${hi}`);
  }
  const r = roll(0, 5), d = r.drops[0], dist = Math.sqrt(26);
  const v = d && d.o;
  if (!v || Math.abs(v.vx - 0.3) > 1e-12 || Math.abs(v.vy - (0.1 + Math.sqrt(dist) * 0.08)) > 1e-12 || Math.abs(v.vz - 0.4) > 1e-12) out.push(tag + ' velocity ' + JSON.stringify(v));
  const o = r.orbs[0];
  if (!o || o.x !== 3 || o.y !== 65.5 || o.z !== 4.5) out.push(tag + ' orb position');
  return out;
}
const base = suite('baseline');
ok(base.length === 0, 'baseline: ' + base.join(' | '));
// luck must move the split: treasure share at luck 3 is 11/97, at luck 0 is 5/100
{ const a = split(0).c.treas / 5000, b = split(3).c.treas / 5000; ok(b > a * 1.5, 'luck raises treasure ' + a + ' ' + b); }
let caught = 0;
const faults = {
  'no luck in quality': () => { const o = MCL.Loot.rollTable; MCL.Loot.rollTable = (n, c) => o(n, Object.assign({}, c, { luck: 0 })); return () => { MCL.Loot.rollTable = o; }; },
  'orb count 0-6': () => { const o = Fi.reel; Fi.reel = (e, ...a) => { const q = e.random; e.random = { nextInt: (n) => q.nextInt(n === 6 ? 7 : n) - 0, nextFloat: () => q.nextFloat() }; const r = o(e, ...a); e.random = q; for (const x of orbs) x.value -= 0; return r; }; const oe = MCL.EntityList.spawn; MCL.EntityList.spawn = (...a) => { const x = oe(...a); Object.defineProperty(x, 'value', { set(v) { this._v = v - 1; }, get() { return this._v; } }); return x; }; return () => { Fi.reel = o; MCL.EntityList.spawn = oe; }; },
  'durability 2': () => { const o = Fi.reel; Fi.reel = (...a) => { const r = o(...a); return r === 1 ? 2 : r; }; return () => { Fi.reel = o; }; },
};
for (const [nm, inject] of Object.entries(faults)) {
  const undo = inject(); const b = suite('fault'); undo();
  if (b.length) { caught++; console.log('  ✓ fault caught: ' + nm); } else fails.push('fault not caught: ' + nm);
}
ok(caught === 3, 'faults');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `OK  ${pass} checks passed, 0 failures; 5000 catches x luck 0/3 inside chi-square; ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
