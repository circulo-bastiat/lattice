// tools/heartbeatcheck.mjs - #4448: the heartbeat workflow keeps its schedule, its restart and its fixer-mail error path.
import { readFileSync } from 'node:fs';
const yml = readFileSync(new URL('../.github/workflows/heartbeat.yml', import.meta.url), 'utf8');
const bad = (y) => [
  !/schedule:\s*\n\s*- cron: '\d+ \*/.test(y) && 'no hourly schedule',
  !/restarting the fill/.test(y) && 'no restart step',
  !/if: failure\(\)[\s\S]*who in fixer commander/.test(y) && 'no fixer/commander mail on failure',
  !/-l severe -l fill-idle/.test(y) && 'no severe fill-idle fallback',
].filter(Boolean);
let fail = bad(yml).length ? 1 : 0; bad(yml).forEach((b) => console.log('FAIL', b));
const breaks = [['schedule:', 'sched:'], ['restarting the fill', 'x'], ['who in fixer commander', 'who in x'], ['-l severe -l fill-idle', '']];
let caught = 0;
for (const [a, b] of breaks) if (bad(yml.replace(a, b)).length) caught++; else { fail = 1; console.log('FAIL break not caught:', a); }
console.log(`${caught} breaks caught`); process.exit(fail);
