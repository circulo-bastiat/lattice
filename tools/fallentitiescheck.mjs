#!/usr/bin/env node
// fallentitiescheck.mjs — #5792: Ph.noFallDamage (what the engine does) against
// tools/golden/fall-entities-1.18.2.tsv (what the 1.18.2 handleFallDamage class chain says), for every
// one of the 113 types, BOTH directions. A hand-typed list in 14b_physics.js fails it (D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '14b_physics.js']) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const Ph = NS.Physics;
const tsv = readFileSync(join(ROOT, 'tools/golden/fall-entities-1.18.2.tsv'), 'utf8').split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
const packed = JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8'));
const fails = [];
const compare = (data) => {
  NS.DATA = { entities: data };
  const bad = [];
  for (const r of tsv) {
    const want = r[2] === 'false';
    if (Ph.noFallDamage(r[0]) !== want) bad.push(r[0] + ' engine=' + !want + ' vanilla=' + want);
  }
  return bad;
};
if (tsv.length !== 113) fails.push('expected 113 types, got ' + tsv.length);
fails.push(...compare(packed));
// known vanilla facts, read from the TSV's own owners rather than typed lists
const own = Object.fromEntries(tsv.map((r) => [r[0], r]));
for (const t of ['iron_golem', 'snow_golem', 'ghast', 'phantom']) if (own[t][2] !== 'false') fails.push(t + ' should be no-damage');
if (own.fox[4] !== 'override' || own.goat[4] !== 'override' || own.zombie[2] !== 'living') fails.push('fox/goat/zombie chain wrong');
if (/NO_FALL_DAMAGE\s*=\s*\{/.test(readFileSync(join(ROOT, 'src/14b_physics.js'), 'utf8'))) fails.push('a typed NO_FALL_DAMAGE list is back in 14b_physics.js');
// anti-vacuity: break the data each way and the comparison must notice
let caught = 0;
const add = JSON.parse(JSON.stringify(packed)); add.fallNone.zombie = 1;
if (compare(add).length) caught++; else fails.push('adding zombie was not caught');
const del = JSON.parse(JSON.stringify(packed)); delete del.fallNone.chicken;
if (compare(del).length) caught++; else fails.push('removing chicken was not caught');
const empty = JSON.parse(JSON.stringify(packed)); empty.fallNone = {};
if (compare(empty).length) caught++; else fails.push('empty table was not caught');
if (fails.length) { console.log('fallentitiescheck: FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`fallentitiescheck: OK — ${tsv.length} types, ${caught} breaks caught`);
