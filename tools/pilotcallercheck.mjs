// pilotcallercheck - #9324: a lockstep pilot whose caller dies must not leave Minecraft servers running on the brain VM,
// and the pre-launch gate must never run a pilot-bound check. Runs the REAL thing on Linux: a caller starts a pilot-like
// watcher (caller.mjs) that holds a sleeping grandchild; the caller is SIGKILLed; the grandchild must be gone.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { callerLost, descendants } from './referee/lockstep/caller.mjs';
import { pilotBound } from './infra/prelaunch.mjs';
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const lost = [
  [{ p0: 10, g0: 5, ppid: 10, gpid: 5 }, false, 'caller alive'],
  [{ p0: 10, g0: 5, ppid: 1, gpid: null }, true, 'parent died'],
  [{ p0: 10, g0: 5, ppid: 10, gpid: 1 }, true, 'grandparent died (suite.mjs killed, check orphaned)'],
  [{ p0: 10, g0: null, ppid: 10, gpid: null }, false, 'no /proc: never a false kill'],
  [{ p0: 1, g0: 0, ppid: 1, gpid: 0 }, false, 'started under init (a container) is not orphaned'],
];
for (const [x, want, m] of lost) ok(callerLost(x) === want, m);
const bound = [['lockstep-slime', true], ['lockstep-tablecheck', true], ['usagestalecheck', false], ['xprefcheck', false]];
for (const [id, want] of bound) ok(pilotBound(id) === want, 'pilotBound ' + id);
const tree = new Map([[1, [2, 3]], [2, [4]], [4, [5]]]);
const d = descendants(1, () => [2, 3, 4, 5], (p) => [...tree].find(([, c]) => c.includes(p))?.[0] ?? null);
ok(JSON.stringify(d.sort()) === '[2,3,4,5]', 'descendants walks the whole tree');
// the real thing: caller -> watcher(watchCaller, ms 300) -> sleeper. Kill caller; the sleeper must die.
if (existsSync('/proc/self/stat')) {
  const W = `import('./tools/referee/lockstep/caller.mjs').then(({ watchCaller, killTree }) => { const { spawn } = require('child_process'); const s = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' }); console.log(s.pid); watchCaller(() => killTree(s.pid), 300); setInterval(() => {}, 1e3); });`;
  const C = `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(W)}], { stdio: ['ignore', 'inherit', 'inherit'] }); setInterval(() => {}, 1e3);`;
  const r = spawnSync('bash', ['-c', `node -e "$C" & cp=$!; sleep 1.5; kill -9 $cp; sleep 1.5; for p in $(pgrep -f '^sleep 60$'); do echo alive $p; done; true`], { env: { ...process.env, C }, encoding: 'utf8', timeout: 20e3 });
  const sleeper = Number((r.stdout.match(/^(\d+)$/m) || [])[1]);
  ok(sleeper > 0, 'watcher started its grandchild');
  ok(sleeper > 0 && !existsSync(`/proc/${sleeper}`) || (existsSync(`/proc/${sleeper}`) && /\) Z /.test(readFileSync(`/proc/${sleeper}/stat`, 'utf8'))), 'the grandchild died with its caller (got ' + r.stdout.trim().replace(/\n/g, ' ') + ')');
} else console.log('pilotcallercheck: no /proc here, live part skipped (pure parts ran)');
// anti-vacuity (D-30): three broken gates must each be caught
const breaks = [
  () => lost.some(([x, want]) => (() => false)(x) !== want),                       // never reports lost
  () => lost.some(([x, want]) => ((y) => y.ppid !== y.p0)(x) !== want),             // watches the parent only (the 19:00Z orphans)
  () => bound.some(([id, want]) => ((i) => i === 'lockstep-tablecheck')(id) !== want), // knows one lane only
];
const caught = breaks.filter((b) => b()).length;
console.log(`${n} assertions, ${fails} failures, ${caught} breaks caught`);
process.exit(fails || caught < breaks.length ? 1 : 0);
