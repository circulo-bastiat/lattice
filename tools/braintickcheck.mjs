// braintickcheck (#8915): the VM brain.yml and the mirror brain-tick.yml cannot both act on a tick. Gates are read from the
// workflow text and evaluated for each BRAIN_RUNNER value; then the checker is proven by breaking the gates.
import fs from 'node:fs';
const vm = fs.readFileSync('.github/workflows/brain.yml', 'utf8'), mi = fs.readFileSync('tools/infra/mirror/brain-tick.yml', 'utf8');
const vmActs = (t, v) => { const m = /route:\n(?:\s*#.*\n)*\s*if: "(.*)"/.exec(t); return !!m && new Function('vars', 'github', `return ${m[1].replace(/contains\([^()]*(?:\([^()]*\)[^()]*)*\)/g, 'true').replace(/github\.event_name/g, 'github.n')}`)({ BRAIN_RUNNER: v }, { n: 'schedule' }); };
const miActs = (t, v) => { const m = /\n    if: vars\.BRAIN_RUNNER == '(\w+)'/.exec(t); return !!m && m[1] === v; };
function verdict(a, b) { const bad = [];
  for (const v of ['mirror', 'vm', '', undefined]) { const x = vmActs(a, v), y = miActs(b, v);
    if (x && y) bad.push(`both act at ${v}`); if (!x && !y && v !== 'mirror' && v !== 'vm') bad.push(`neither acts at ${v}`);
    if (v === 'mirror' && (x || !y)) bad.push('mirror must own'); if (v === 'vm' && (!x || y)) bad.push('vm must own'); }
  if (!/cron: '\*\/5 \* \* \* \*'/.test(b)) bad.push('mirror tick not every 5 min');
  if (!/usage-data/.test(b) || !/silent\.sh/.test(b)) bad.push('usage-data or silent missing');
  return bad; }
let bad = verdict(vm, mi); bad.forEach(b => console.log('FAIL', b));
const breaks = [[vm.replace("vars.BRAIN_RUNNER != 'mirror'", 'true'), mi], [vm, mi.replace("== 'mirror'", "!= 'vm'")], [vm, mi.replace("== 'mirror'", "== 'vm'")], [vm, mi.replaceAll('usage-data', 'x')]];
let caught = 0; for (const [a, b] of breaks) if (verdict(a, b).length) caught++;
console.log(`${caught}/${breaks.length}; ${caught} breaks caught`); if (caught < breaks.length) bad = bad.concat('vacuous');
console.log(bad.length ? "braintickcheck FAIL" : "braintickcheck ok");
// #10418: the hosted tick's log is PUBLIC, so its only output may be `[silent] name exit=N elapsed=Ns` lines. Two halves:
// (1) the workflow text: every command line of our own steps is silent-wrapped or on a short list of printing-nothing builtins;
// (2) logLeaks(): a real run's log (`node tools/braintickcheck.mjs --log run.txt`) - between a step's ##[endgroup] and the next ##[group] only [silent] lines.
export const SILENT_LINE = /^\[silent\] [\w-]+ exit=\d+(?: elapsed=\d+s)?$/;
export function logLeaks(log) {
  const bad = []; let inOut = false;
  for (const raw of log.split(/\r?\n/)) {
    const l = raw.replace(/^\S+Z /, '').trim();
    if (l.startsWith('##[group]')) { inOut = /^##\[group\]Run (?!actions\/)/.test(l); continue; }
    if (l.startsWith('##[endgroup]')) continue;
    if (inOut && l && !l.startsWith('##[') && !SILENT_LINE.test(l)) bad.push(l.slice(0, 60));
  }
  return bad;
}
export function ymlLeaks(t) {
  const bad = [];
  if (/upload-artifact|set -x|bash -x|cat [^\n]*out\.log/.test(t)) bad.push('uploads, traces or prints out.log');
  const lines = t.split('\n'); let run = false, ind = 0;
  for (const raw of lines) {
    const l = raw.trim(), m = /^(\s*)(?:- )?run: \|/.exec(raw);
    if (m) { run = true; ind = m[1].length; continue; }
    if (!run) continue;
    if (l && raw.search(/\S/) <= ind) { run = false; continue; }
    if (!l || l.startsWith('#')) continue;
    if (!/^(silent\S* |\. work\/tools\/infra\/mirror\/silent\.sh$|silent\(\) \{|cd (?:work|\.\.)$|mkdir -p |export |cp [^|;>]*2>\/dev\/null(?: \|\| true)?$|T0=\$\(date \+%s\); N=0$|while :; do$|done$|N=\$\(\(N\+1\)\); S=\$\(date \+%s\)$|\[ -s "\$RUNNER_TEMP\/vars\.env" \] && \. "\$RUNNER_TEMP\/vars\.env"$|\( cd work$|\[ \$\(\( \$\(date \+%s\) - T0 \)\) -ge 3000 \] && break$|W=\$\(\( 240 - \(\$\(date \+%s\) - S\) \)\); \[ "\$W" -gt 20 \] && sleep "\$W"$|echo "\[silent\] ticks=\$N"$)/.test(l)) bad.push('unwrapped command: ' + l.slice(0, 60));
  }
  return bad;
}
const lk = ymlLeaks(mi); lk.forEach(b => console.log('FAIL', b));
const lkBreaks = [mi.replace('silent usage node', 'node'), mi.replace('steps:', 'steps:\n      - uses: actions/upload-artifact@v4'), mi.replace('cd work\n', 'cd work\n          echo "$GH_TOKEN"\n'), mi.replace('silent fill node tools/brain/brain.mjs fill', 'node tools/brain/brain.mjs fill')];
let lc = lkBreaks.filter(b => ymlLeaks(b).length).length;
const okLog = '2026Z ##[group]Run . work/x\n2026Z ##[endgroup]\n2026Z [silent] usage exit=0 elapsed=3s\n2026Z ##[group]Run actions/setup-node@v4\n2026Z Found in cache @ /opt/x\n2026Z ##[endgroup]';
const logBreaks = [okLog + '\n2026Z ##[group]Run x\n2026Z ##[endgroup]\nissue #9 text', '2026Z ##[group]Run x\n2026Z ##[endgroup]\n[silent] usage exit=0 account=bob'];
if (logLeaks(okLog).length) { console.log('FAIL logLeaks rejects a clean log'); lk.push('x'); }
lc += logBreaks.filter(b => logLeaks(b).length).length;
console.log(`silent-log: ${lc}/${lkBreaks.length + logBreaks.length} breaks caught`); if (lc < lkBreaks.length + logBreaks.length) lk.push('vacuous');
const li = process.argv.indexOf('--log');
if (li > 0) { const x = logLeaks(fs.readFileSync(process.argv[li + 1], 'utf8')); x.forEach(b => console.log('LEAK', b)); if (x.length) lk.push('log leaks'); else console.log('hosted log silent'); }
process.exit(bad.length || lk.length ? 1 : 0);
