// #6259: lockstep 'rng' field -- 48-bit Random seed per tick; one extra nextInt on the engine side is reported at exactly that tick.
import { serverRow, engineRow, compareTraces, parseRngLog, rngSeed } from './lockstep/trace.mjs';
import { readFileSync } from 'node:fs';
let bad = 0, n = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const NSO = { U: { polarGaussian() { return 0; } } };
new Function('MCL', readFileSync(new URL('../../src/02m_jrandom.js', import.meta.url), 'utf8'))(NSO);
const JR = NSO.JRandom;
const T = 12;
// server side: the seeds the JDK would log; JRandom is bit-identical, so a twin generator stands in for the JVM
const jvm = new JR(42), log = [];
for (let t = 0; t < T; t++) { if (t % 3 === 0) jvm.nextInt(10); log.push(`RNG ${t} ${rngSeed(jvm)}`); }
const sv = parseRngLog(log.join('\n'));
const S = []; for (let t = 0; t < T; t++) S.push(serverRow(t, {}, { rng: sv[t] }));
const run = (extraAt) => { const r = new JR(42), rows = [];
  for (let t = 0; t < T; t++) { if (t % 3 === 0) r.nextInt(10); if (t === extraAt) r.nextInt(10); rows.push(engineRow(t, { random: r })); } return rows; };
ok(compareTraces(S, run(-1), { fields: ['rng'] }) === null, 'identical draws match');
let caught = 0;
for (const t of [0, 4, 7, 11]) { const d = compareTraces(S, run(t), { fields: ['rng'] }); if (d && d.tick === t && d.field === 'rng') caught++; else ok(false, 'extra draw at ' + t + ' not caught'); }
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
if (bad) process.exit(1);
