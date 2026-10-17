// corestagecheck: every id in core.json / quarantine.json has exactly one stage, and every tools/*check.mjs
// that prints "breaks caught" has a stage. Proves itself with a deleted stage and a bogus core id.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const T = fileURLToPath(new URL('.', import.meta.url));
const readJ = (f) => JSON.parse(readFileSync(join(T, f), 'utf8'));
function load() {
  const stages = [];
  for (const f of readdirSync(join(T, 'stages.d')).filter((x) => x.endsWith('.json')))
    for (const s of [].concat(readJ('stages.d/' + f))) stages.push(s);
  const files = readdirSync(T).filter((f) => /check\.mjs$/.test(f) && /breaks caught/.test(readFileSync(join(T, f), 'utf8')));
  return { stages, core: readJ('core.json').checks, quar: Object.keys(readJ('quarantine.json')), files };
}
function audit({ stages, core, quar, files }) {
  const bad = [], n = {};
  for (const s of stages) n[s.id] = (n[s.id] || 0) + 1;
  for (const id of core) if (n[id] !== 1) bad.push(`core id ${id} has ${n[id] || 0} stages`);
  for (const id of quar) if (n[id] !== 1) bad.push(`quarantine id ${id} has ${n[id] || 0} stages`);
  const used = new Set(stages.map((s) => (s.file || 'tools/' + s.id + '.mjs').replace(/^tools\//, '')));
  for (const f of files) if (!used.has(f)) bad.push(`${f} prints "breaks caught" but no stage runs it`);
  return bad;
}
const base = load();
const bad = audit(base);
for (const b of bad) console.log('  ✗ ' + b);
let caught = 0, fails = bad.length;
const victim = base.core[0];
const m1 = audit({ ...base, stages: base.stages.filter((s) => s.id !== victim) });
if (m1.length) { caught++; console.log('  ✓ break caught: deleted stage'); } else { fails++; console.log('  ✗ deleted stage not caught'); }
const m2 = audit({ ...base, core: [...base.core, 'bogus_nonexistent_check'] });
if (m2.length) { caught++; console.log('  ✓ break caught: bogus core id'); } else { fails++; console.log('  ✗ bogus id not caught'); }
console.log(`corestagecheck: ${base.core.length + base.quar.length} ids audited, ${caught} breaks caught (of 2)`);
console.log(`${base.core.length + base.quar.length + base.files.length + 2} assertions, ${fails} failures`);
process.exit(fails ? 1 : 0);
