#!/usr/bin/env node
// advtrig-nether_travelcheck.mjs — G17-AT27. minecraft:nether_travel (nether/fast_travel, 7000 horizontal) through Portal.moveToWorld; breaks its own matcher/call site.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(ROOT, 'src', f + '.js'), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function engine(adv, portal) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', rd(f))(NS);
  new Function('MCL', adv)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  NS.World = { dimension: 'overworld', setDimension(d) { this.dimension = d; } };
  NS.Dim = { norm: (d) => d, scaleFactor: (a, b) => a === b ? 1 : a === 'overworld' ? 0.125 : 8 };
  new Function('MCL', portal.replace(/\}\)\(typeof MCL[^\n]*$/, '})(MCL);'))(NS);
  return NS;
}
let asserted = 0;
function verify(NS) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const adv = NS.Adv.manager.get('minecraft:nether/fast_travel');
  no(adv && Object.values(adv.criteria).some((c) => c.trigger === 'minecraft:nether_travel'), 'advancement/criterion missing');
  const trip = (netherX) => {
    NS.World.dimension = 'overworld';
    const p = { isPlayer: true, x: 0, y: 70, z: 0, advancements: new NS.Adv.Tracker({}) };
    NS.Portal.moveToWorld(p, 'the_nether');
    p.x = netherX;                                   // walked in the nether, returns at x*8
    NS.Portal.moveToWorld(p, 'overworld');
    return p.advancements.getProgress(adv).isDone();
  };
  no(trip(1000), '8000 blocks away did not complete nether/fast_travel');
  no(!trip(100), '800 blocks away completed it');
  no(typeof NS.Adv.matchers['minecraft:nether_travel'] === 'function', 'no matcher');
  return f;
}
const ADV = rd('02l_advancements'), PORTAL = rd('07zzs_portal');
const mut = (s, a, b) => { if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const fails = verify(engine(ADV, PORTAL));
const mutants = [
  ['matcher always false', engine(mut(ADV, "P.distance(c.distance, e[0], e[1], e[2], pl.x, pl.y, pl.z);", "false;"), PORTAL)],
  ['matcher ignores distance', engine(mut(ADV, "P.distance(c.distance, e[0], e[1], e[2], pl.x, pl.y, pl.z);", "true;"), PORTAL)],
  ['no call site', engine(ADV, mut(PORTAL, "A.trigger(p, 'minecraft:nether_travel'", "(0) && A.trigger(p, 'minecraft:nether_travel'"))],
];
let caught = 0;
for (const [name, ns] of mutants) {
  let bad; try { bad = verify(ns); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-nether_travelcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-nether_travelcheck: OK — ${caught} breaks caught`);
