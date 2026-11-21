// tools/acctexpirycheck.mjs - #11108 (Dan, 2 Nov: "pause the fill until tomorrow ... use the conditional feature"): FILL_WORKERS_<ACCOUNT> takes `N@<ISO time>`:
// N until the time, then unset (null: the account follows its roles.json default). Plain N is unchanged. go.mjs `loop pro 0@<ISO>` must let it through. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { acctSwitch } from './brain/route.mjs';
const GO = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-02T20:00:00Z');
const verdict = (fn, go) => {
  const bad = [];
  if (fn('0@2026-11-03T13:00:00Z', NOW) !== 0) bad.push('before the time the count must hold (0)');
  if (fn('3@2026-11-03T13:00:00Z', NOW) !== 3) bad.push('before the time the count must hold (3)');
  if (fn('0@2026-11-02T19:00:00Z', NOW) !== null) bad.push('after the time the switch must be unset (null)');
  if (fn('0@2026-11-02T20:00:00Z', NOW) !== null) bad.push('at the time the switch must already be unset');
  if (fn('2', NOW) !== 2 || fn(' 7 ', NOW) !== 7 || fn('12', NOW) !== 10) bad.push('a plain N must be unchanged (and capped at 10)');
  if (fn('', NOW) !== null || fn(undefined, NOW) !== null || fn('x@2026-11-03T13:00:00Z', NOW) !== null) bad.push('garbage must stay unset');
  if (!/AC && \/\^\\d\+@/.test(go)) bad.push('go.mjs loop does not let `N@<ISO>` through for an account');
  return bad;
};
const BREAKS = [
  ['expiry ignored', () => (v, n) => acctSwitch(String(v).split('@')[0], n), GO],
  ['never expires', () => (v, n) => acctSwitch(v, 0), GO],
  ['expires early', () => (v, n) => acctSwitch(v, n + 365 * 864e5), GO],
  ['go.mjs blocks it', () => acctSwitch, GO.replace('AC && /^\\d+@', 'AC && /^x@')],
];
const real = verdict(acctSwitch, GO); let caught = 0;
for (const [name, mk, go] of BREAKS) { if (verdict(mk(), go).length) caught++; else real.push('break not caught: ' + name); }
console.log(real.length ? 'FAIL\n' + real.join('\n') : `acctexpirycheck: ok, ${caught} breaks caught`);
process.exit(real.length ? 1 : 0);
