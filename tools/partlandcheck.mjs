// tools/partlandcheck.mjs - #4646: `go.mjs done --part --owed` must open the PR with the part marker and no "Closes #N";
// the lander must read that marker, keep the issue open, post the owed list and unblock. Anti-vacuity: each break is caught.
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const verdicts = (go, land) => {
  const bad = [];
  if (!/PART_MARK = '<!-- mclite:part -->'/.test(go)) bad.push('go.mjs has no part marker');
  if (!/--part needs --owed/.test(go)) bad.push('--part without --owed is accepted');
  if (!/owed && !flag\('--finished'\)\) argv\.push\('--finished'\)/.test(go)) bad.push('--part does not imply --finished (no PR)');
  if ((go.match(/body: `\$\{closes\}/g) || []).length !== 2) bad.push('a PR body still hard-codes "Closes #N"');
  if (!/includes\('<!-- mclite:part -->'\)/.test(land)) bad.push('the lander never reads the part marker');
  if (!/if \(issue && part\)[\s\S]{0,500}?labels\/blocked[\s\S]{0,300}?else if \(issue\)[^\n]*state: 'closed'/.test(land)) bad.push('the lander closes a --part issue or leaves it blocked');
  return bad;
};
const go = read('./go.mjs'), land = read('./infra/land.mjs');
const base = verdicts(go, land);
if (base.length) { console.log('✗ ' + base.join('\n✗ ')); process.exit(1); }
const BREAKS = [
  ['no marker', (g, l) => [g.replace("'<!-- mclite:part -->'", "'x'"), l]],
  ['owed optional', (g, l) => [g.replace('--part needs --owed', 'x'), l]],
  ['no implied finished', (g, l) => [g.replace("argv.push('--finished')", 'void 0'), l]],
  ['closes hard-coded', (g, l) => [g.replaceAll('body: `${closes}', 'body: `Closes #${num}'), l]],
  ['lander ignores marker', (g, l) => [g, l.replace("includes('<!-- mclite:part -->')", 'includes("zzz")')]],
  ['lander closes anyway', (g, l) => [g, l.replace('if (issue && part)', 'if (false)')]],
];
let caught = 0;
for (const [name, f] of BREAKS) { const [g, l] = f(go, land); if (verdicts(g, l).length) caught++; else console.log('✗ break not caught: ' + name); }
if (caught !== BREAKS.length) process.exit(1);
console.log(`partlandcheck: ok, ${caught} breaks caught`);
