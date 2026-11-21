// tools/fullsuitecost.mjs - #7727 step 4: where the full suite's time goes. `node tools/fullsuitecost.mjs [--write]` prints (and with
// --write saves to _status/FULLSUITE-COST.md) the top stages by recorded seconds (tools/stage-times.json, fed by #9251), the
// quarantined stages, duplicate stages (same kind+file+args+env), lockstep name families that overlap, browser stages the mirror
// cannot run or always skips, and stages whose own `why` says they only re-prove another one. Pure function `analyse` is what the check breaks.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
export const loadStages = (r = root) => readdirSync(join(r, 'tools', 'stages.d')).filter((f) => f.endsWith('.json')).flatMap((f) => [].concat(JSON.parse(readFileSync(join(r, 'tools', 'stages.d', f), 'utf8'))));
const mean = (a) => (Array.isArray(a) ? a : [a]).reduce((x, y) => x + y, 0) / (Array.isArray(a) ? a.length || 1 : 1);
export function analyse(stages, times = {}, quarantine = {}, unfit = {}) {
  const key = (s) => JSON.stringify([s.kind, s.file || null, s.args || [], s.env || null, s.chrome || null, s.flags || null]);
  const groups = new Map(); for (const s of stages) { if (!s.file) continue; const k = key(s); (groups.get(k) || groups.set(k, []).get(k)).push(s.id); }
  const duplicates = [...groups.values()].filter((g) => g.length > 1);
  const sec = (id) => (times[id] ? mean(times[id]) : null);
  const top = stages.filter((s) => sec(s.id) != null).map((s) => [s.id, sec(s.id)]).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const qIds = Object.keys(quarantine); const qSec = qIds.reduce((a, id) => a + (sec(id) || 0), 0);
  const fam = new Map(); for (const s of stages) { const m = /^lockstep[-_](.+?)(?:-lane|-server)?$/.exec(s.id); if (!m) continue; const b = m[1].replace(/[-_]/g, ''); (fam.get(b) || fam.set(b, []).get(b)).push(s.id); }
  const families = [...fam.values()].filter((g) => g.length > 1);
  const browserNotUnfit = stages.filter((s) => s.kind === 'browser' && !(s.id in unfit)).map((s) => s.id);
  const reprove = stages.filter((s) => /\b(re-?prov|only re-?checks?|same (check|stage) as|duplicate of|alias (of|for))/i.test(s.why || '')).map((s) => s.id);
  const fileOf = Object.fromEntries(stages.map((s) => [s.id, s.file || null]));
  const familyEvidence = families.map((g) => ({ ids: g, files: g.map((i) => fileOf[i]), sameFile: new Set(g.map((i) => fileOf[i])).size < g.length }));
  return { familyEvidence, total: stages.length, duplicates, top, qIds, qSec, families, browserNotUnfit, reprove, timed: Object.keys(times).length };
}
// #9529: what each file of an overlapping family actually runs. `sig` = the engine trace calls (minus the salt variable) + the salt count +
// the compared fields; members with the same non-empty sig drive the same engine lane, so they are the only candidates for "one is a subset
// of the other" (a human still reads the mutation lists before deleting: `muts` counts caught()/at() assertions per file).
export function compareFamilies(stages, families, read = (f) => readFileSync(join(root, f), 'utf8')) {
  const by = Object.fromEntries(stages.map((s) => [s.id, s]));
  return families.map((g) => {
    const rows = g.map((id) => {
      let t = ''; try { t = read(by[id].file); } catch {}
      const calls = [...new Set([...t.matchAll(/engine\w+\(([^)]*)\)/g)].map((m) => m[0].replace(/\s+/g, '').replace(/"/g, "'").replace(/\((?:s|salt|SALTS\[0\]|\d+)/, '(S')))].sort().join('|');
      const salts = (/length: *(\d+)/.exec(t) || [])[1] || '?';
      const F = (/const F = (\[[^\]]*\])/.exec(t) || [])[1] || '?';
      return { id, file: by[id].file, lines: t ? t.split('\n').length : 0, sig: calls ? `${calls} x${salts} ${F}` : '', muts: (t.match(/\b(caught|at)\(/g) || []).length };
    });
    const same = rows.filter((r) => r.sig && rows.some((o) => o !== r && o.sig === r.sig)).map((r) => r.id);
    return { rows, same };
  });
}
export function render(a) {
  const L = ['# Full-suite cost (#7727)', '', `${a.total} stages, ${a.timed} with recorded seconds (tools/stage-times.json).`, ''];
  L.push('## Top 40 by seconds', a.top.length ? a.top.map(([id, s], i) => `${i + 1}. ${id} ${s.toFixed(1)} s`).join('\n') : '_no timings recorded yet: the planner falls back to the family median until a full run feeds stage-times.json_', '');
  L.push(`## Quarantined (${a.qIds.length}; they run every time, a red one is retried once)`, a.qIds.join(', '), `recorded seconds of the quarantined: ${a.qSec.toFixed(0)} (a retry doubles it)`, '');
  L.push('## Duplicate stages (same kind+file+args+env)', a.duplicates.length ? a.duplicates.map((g) => '- ' + g.join(' = ')).join('\n') : 'none', '');
  if (a.compare) L.push('## Family comparison (same sig = same engine lane = candidate subset; server-only files have no sig)', ...a.compare.map((c) => c.rows.map((r) => `- ${r.id} ${r.file} ${r.lines}L muts=${r.muts} ${r.sig || '(no engine call)'}`).join('\n') + (c.same.length ? `\n  => same lane: ${c.same.join(', ')}` : '')), '');
  L.push('## Overlapping lockstep name families (verify before deleting)', a.families.length ? a.familyEvidence.map((e) => '- ' + e.ids.map((i, k) => i + ' [' + e.files[k] + ']').join(' / ') + (e.sameFile ? '  <- SAME FILE' : '')).join('\n') : 'none', '');
  L.push('## Stages whose `why` says they re-prove another', a.reprove.join(', ') || 'none', '');
  L.push(`## Browser stages not in hosted-unfit (${a.browserNotUnfit.length})`, a.browserNotUnfit.join(', ') || 'none', '');
  return L.join('\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = analyse(loadStages(), readJson(join(root, 'tools', 'stage-times.json'), {}), readJson(join(root, 'tools', 'quarantine.json'), {}), readJson(join(root, 'tools', 'hosted-unfit.json'), {}));
  a.compare = compareFamilies(loadStages(), a.families); const md = render(a); console.log(md);
  if (process.argv.includes('--write')) { mkdirSync(join(root, '_status'), { recursive: true }); writeFileSync(join(root, '_status', 'FULLSUITE-COST.md'), md + '\n'); }
}
