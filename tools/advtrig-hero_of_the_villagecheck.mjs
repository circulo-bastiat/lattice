#!/usr/bin/env node
// advtrig-hero_of_the_villagecheck.mjs — G17-AT44. minecraft:hero_of_the_village through Raid.grantHeroes; breaks its own matcher/call site.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(ROOT, 'src', f + '.js'), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function engine(adv, raid) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', rd(f))(NS);
  new Function('MCL', adv)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  new Function('MCL', raid)(NS);
  return NS;
}
let asserted = 0;
function verify(NS) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const adv = NS.Adv.manager.get('minecraft:adventure/hero_of_the_village');
  no(adv && Object.values(adv.criteria).some((c) => c.trigger === 'minecraft:hero_of_the_village'), 'advancement/criterion missing');
  const ES = { addStatusEffect() {} };
  const mk = () => ({ isPlayer: true, advancements: new NS.Adv.Tracker({}) });
  const P1 = mk(), mob = { type: 'villager' };
  NS.Raid.grantHeroes({ heroes: { a: 1, b: 1 }, badOmenLevel: 1 }, { a: P1, b: mob }, ES);
  no(P1.advancements.getProgress(adv).isDone(), 'raid victory did not complete adventure/hero_of_the_village');
  const P2 = mk();
  NS.Raid.grantHeroes({ heroes: {}, badOmenLevel: 1 }, { a: P2 }, ES);
  no(!P2.advancements.getProgress(adv).isDone(), 'non-hero completed it');
  no(typeof NS.Adv.matchers['minecraft:hero_of_the_village'] === 'function', 'no matcher');
  return f;
}
const ADV = rd('02l_advancements'), RAID = rd('07s_raid');
const mut = (s, a, b) => { if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const fails = verify(engine(ADV, RAID));
const mutants = [
  ['matcher always false', engine(mut(ADV, "'minecraft:hero_of_the_village'] = function () { return true;", "'minecraft:hero_of_the_village'] = function () { return false;"), RAID)],
  ['no call site', engine(ADV, mut(RAID, "NS.Adv.trigger(e, 'minecraft:hero_of_the_village'", "(0) && NS.Adv.trigger(e, 'minecraft:hero_of_the_village'"))],
];
let caught = 0;
for (const [name, ns] of mutants) {
  let bad; try { bad = verify(ns); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-hero_of_the_villagecheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-hero_of_the_villagecheck: OK — ${caught} breaks caught`);
