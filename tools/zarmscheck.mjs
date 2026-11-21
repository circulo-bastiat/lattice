#!/usr/bin/env node
// zarmscheck.mjs — #914: husk and giant get AnimationUtils.animateZombieArms (arms raised).
//   node tools/zarmscheck.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rows = (t) => t.split('\n').filter((l) => l && l[0] !== '#' && l[0] !== '!').map((l) => l.split('\t')[0]);
const tsv = readFileSync(join(ROOT, 'tools', 'golden', 'zombiearms-1.18.2.tsv'), 'utf8');
const NEED = ['zombie', 'zombie_villager', 'drowned', 'husk', 'giant', 'vindicator', 'illusioner'];
const missing = (list) => NEED.filter((n) => !list.includes(n));
let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('  x ' + m); } };
const A = join(ROOT, 'assets', 'entities.json');
const sources = [['tsv', rows(tsv)]];
if (existsSync(A)) sources.push(['assets/entities.json', JSON.parse(readFileSync(A, 'utf8')).zarms.on]);
for (const [n, l] of sources) ok(!missing(l).length, `${n}: zarms missing ${missing(l).join(' ')}`);
// #2654: zombified_piglin must be armed by ER.zombieArms (meleeAttack is animateZombieArms' twin)
const src = readFileSync(join(ROOT, 'src', '07j_entityrender.js'), 'utf8');
const hasPig = (t) => /zarmCache\.zombified_piglin\s*=\s*1/.test(t);
ok(hasPig(src), 'ER.zombieArms lacks zombified_piglin');
// anti-vacuity: break each source and confirm the detector notices
let breaks = 0;
for (const drop of ['husk', 'giant']) for (const [, l] of sources) if (missing(l.filter((x) => x !== drop)).includes(drop)) breaks++;
if (!hasPig(src.replace('zarmCache.zombified_piglin', 'x'))) breaks++;
ok(breaks === 2 * sources.length + 1, 'the detector missed a broken list');
console.log(`zarmscheck: ${bad ? 'FAIL' : 'ok'} — ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
