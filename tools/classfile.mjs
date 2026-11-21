// classfile.mjs - turns tools/classmap.json into the filing plan (#11465): every ported-unwired class its own
// unit, ported-unchecked grouped by module, missing grouped by package (small packages merged up).
// node tools/classfile.mjs            -> writes docs/audits/classmap-issues.json, prints counts
// node tools/classfile.mjs --file     -> files each unit with go.mjs newissue --parent 11465 (once; records ids)
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
export function plan(rows) {
  const units = [];
  const unw = rows.filter(r => r[5] === 'ported-unwired');
  for (const r of unw) units.push({ kind: 'unwired', key: r[0], module: r[1], classes: [r[0]] });
  const byMod = {};
  for (const r of rows.filter(r => r[5] === 'ported-unchecked')) (byMod[r[1]] ||= []).push(r[0]);
  for (const [m, c] of Object.entries(byMod)) units.push({ kind: 'unchecked', key: m, module: m, classes: c });
  let pk = {};
  for (const r of rows.filter(r => r[5] === 'missing')) (pk[r[0].split('/').slice(0, 4).join('/')] ||= []).push(r[0]);
  const merged = {};
  for (const [p, c] of Object.entries(pk)) {
    const k = c.length >= 8 ? p : p.split('/').slice(0, 3).join('/');
    (merged[k] ||= []).push(...c);
  }
  for (const [p, c] of Object.entries(merged)) units.push({ kind: 'missing', key: p, classes: c });
  return units;
}
const rows = JSON.parse(fs.readFileSync(root + 'tools/classmap.json', 'utf8')).rows;
const units = plan(rows);
const out = root + 'docs/audits/classmap-issues.json';
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
const ids = Object.fromEntries(prev.filter(u => u.issue).map(u => [u.kind + ':' + u.key, u.issue]));
for (const u of units) if (ids[u.kind + ':' + u.key]) u.issue = ids[u.kind + ':' + u.key];
if (process.argv.includes('--file')) {
  for (const u of units) {
    if (u.issue) continue;
    const title = u.kind === 'unwired' ? `AUDIT-MAP wire ${u.key.split('/').pop()}` : u.kind === 'unchecked' ? `AUDIT-MAP prove ${u.key} (${u.classes.length} classes)` : `AUDIT-MAP port ${u.key} (${u.classes.length} classes)`;
    const body = `From docs/audits/classmap.md (#11465). Verdict ${u.kind}${u.module ? ', module ' + u.module : ''}. Classes:\n` + u.classes.slice(0, 60).join('\n') + (u.classes.length > 60 ? `\n... +${u.classes.length - 60} more (see tools/classmap.json)` : '') + `\nProof wanted: reachable from a real entry point and a stage that fails when it is cut.`;
    const o = execFileSync('node', ['tools/go.mjs', 'newissue', '--parent', '11465', '--title', title, '--body', body], { cwd: root, encoding: 'utf8' });
    const m = o.match(/#(\d+)/); if (m) u.issue = +m[1];
    fs.writeFileSync(out, JSON.stringify(units, null, 1) + '\n');
  }
}
fs.writeFileSync(out, JSON.stringify(units, null, 1) + '\n');
const c = k => units.filter(u => u.kind === k).length;
console.log(`classfile: ${units.length} units (${c('unwired')} unwired, ${c('unchecked')} unchecked modules, ${c('missing')} missing packages); filed ${units.filter(u => u.issue).length}`);
