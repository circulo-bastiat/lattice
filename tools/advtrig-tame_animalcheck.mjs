#!/usr/bin/env node
// advtrig-tame_animalcheck.mjs — G17-AT12. minecraft:tame_animal through the real Tame.feed call site; breaks its own matcher/call site.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(ROOT, 'src', f + '.js'), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function engine(adv, tame) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', rd(f))(NS);
  new Function('MCL', adv)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  new Function('MCL', tame)(NS);
  NS.Tame.ready = true;
  return NS;
}
let asserted = 0;
function verify(NS) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const id = 'minecraft:husbandry/tame_an_animal';
  const adv = NS.Adv.manager.get(id);
  no(adv && Object.values(adv.criteria).some((c) => c.trigger === 'minecraft:tame_animal'), 'advancement/criterion missing');
  const mk = () => ({ x: 0, y: 64, z: 0, advancements: new NS.Adv.Tracker({}) });
  const wolf = (type) => ({ type, x: 1, y: 64, z: 1, tamed: false });
  const P1 = mk();
  NS.Tame.feed(wolf('wolf'), 'bone', { player: P1, random: () => 0.99 });
  no(!P1.advancements.getProgress(adv).isDone(), 'failed roll completed the advancement');
  NS.Tame.feed(wolf('wolf'), 'bone', { player: P1, random: () => 0 });
  no(P1.advancements.getProgress(adv).isDone(), 'tame did not complete husbandry/tame_an_animal');
  // matcher: a non-matching entity condition must not complete
  const m = NS.Adv.matchers['minecraft:tame_animal'];
  no(typeof m === 'function', 'no matcher');
  const cond = { entity: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:cat' } }] };
  no(m && m(cond, { entity: wolf('wolf') }) === false, 'non-matching condition passed');
  no(m && m(cond, { entity: wolf('cat') }) === true, 'matching condition failed');
  const P2 = mk();
  NS.Tame.feed(wolf('wolf'), 'bone', { random: () => 0 });
  no(!P2.advancements.getProgress(adv).isDone(), 'no player still completed');
  return f;
}
const ADV = rd('02l_advancements'), TAME = rd('07n_tame');
const mut = (s, a, b) => { if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const fails = verify(engine(ADV, TAME));
const mutants = [
  ['matcher always true', engine(mut(ADV, "return P.extended(cond.entity,", "return true || P.extended(cond.entity,"), TAME)],
  ['matcher always false', engine(mut(ADV, "return P.extended(cond.entity,", "return false && P.extended(cond.entity,"), TAME)],
  ['no call site', engine(ADV, mut(TAME, "NS.Adv.trigger(tp, 'minecraft:tame_animal'", "(0) && NS.Adv.trigger(tp, 'minecraft:tame_animal'"))],
];
let caught = 0;
for (const [name, ns] of mutants) {
  let bad; try { bad = verify(ns); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-tame_animalcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-tame_animalcheck: OK — ${caught} breaks caught`);
