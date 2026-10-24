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
console.log(bad.length ? 'braintickcheck FAIL' : 'braintickcheck ok'); process.exit(bad.length ? 1 : 0);
