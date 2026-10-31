// tools/smokeymlcheck.mjs - #10214: smoke.yml failed on runner DADS (MCLITE_PROJECTS unset -> `\_status\...` bare path) so env-fault #10136 never closed.
// Fails when smoke.yml uses %MCLITE_PROJECTS% before a `if not defined MCLITE_PROJECTS set ... %RUNNER_TEMP%` fallback. Anti-vacuity: breaks its own data.
import { readFileSync } from 'node:fs';
const FALL = /^\s*if not defined MCLITE_PROJECTS set "?MCLITE_PROJECTS=%RUNNER_TEMP%/i;
const scan = text => {
  const bad = []; let ok = false;
  text.split('\n').forEach((l, i) => {
    if (FALL.test(l)) ok = true;
    else if (!ok && /%MCLITE_PROJECTS%|\$env:MCLITE_PROJECTS/i.test(l)) bad.push(`smoke.yml:${i + 1}: uses MCLITE_PROJECTS before a %RUNNER_TEMP% fallback`);
  });
  if (!ok) bad.push('smoke.yml: no MCLITE_PROJECTS fallback to %RUNNER_TEMP%');
  return bad;
};
const text = readFileSync(new URL('../.github/workflows/smoke.yml', import.meta.url), 'utf8');
const bad = scan(text);
let caught = 0;
const breaks = [
  text.split('\n').filter(l => !FALL.test(l)).join('\n'),
  text.split('\n').map(l => FALL.test(l) ? l.replace('RUNNER_TEMP', 'NOPE') : l).join('\n'),
  text.replace(/^.*if not defined.*\n/m, '') ,
];
for (const b of breaks) if (scan(b).length) caught++;
if (bad.length) { console.log(bad.join('\n')); process.exit(1); }
if (caught < breaks.length) { console.log('anti-vacuity: only ' + caught + ' breaks caught'); process.exit(1); }
console.log(`smokeymlcheck ok - ${caught} breaks caught`);
