// #8671 proof feed: when the worker queue drains, file one bug per RED proof-matrix cell (mob x dimension), deterministic, no model.
// plan() is pure (all inputs passed in); run() does the reads/writes. Triggers only when EVERY precondition holds; MISSING is never work.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadMatrix } from './matrixlive.mjs';
import { probeSlices } from './thinfill.mjs';
const DIMS = ['model', 'texture', 'animation', 'drops', 'spawn', 'lockstep', 'goals'];
const DAY = 24 * 3600e3, GUARD = 30 * 60e3;
export const MARK = 'proof-feed: batch filed';
const rd = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

/** i: { free, thin, matrix:{sha,builtAt,full,rows}, depLanded, now, lastBatchAt, usageOk, openMarkers:Set, proven:[], order:[mob], known:Set('mob|dim'),
 *       failedRow(mob,dim)->string, changedAfter(mob,sha)->bool, stillRed(mob,dim)->bool, max } */
export function plan(i) {
  const no = (why) => ({ fire: false, why, file: [], pipeline: [] });
  if (!(i.free < i.thin)) return no(`queue deep (${i.free} >= ${i.thin})`);
  const M = i.matrix;
  if (!i.depLanded) return no('dependency #8670 not landed');
  if (!M || !M.rows || !M.full) return no('matrix is not from a full run');
  if (!(i.now - Date.parse(M.builtAt) <= DAY)) return no('matrix older than 24 h');
  const cells = Object.entries(M.rows).flatMap(([m, r]) => DIMS.map((d) => [m, d, r[d]]));
  if (!cells.some((c) => c[2] && c[2] !== 'missing')) return no('matrix is all MISSING');
  if (i.lastBatchAt && i.now - i.lastBatchAt < GUARD) return no('batch filed in the last 30 min');
  if (!i.usageOk) return no('usage caps allow no workers');
  const order = (i.order || []).filter((m) => M.rows[m]);
  const ix = (m) => order.indexOf(m);
  const reds = cells.filter(([m, d, s]) => s === 'red' && !(i.proven || []).includes(m)).sort((a, b) => (a[1] === 'lockstep') - (b[1] === 'lockstep') || ix(a[0]) - ix(b[0]));
  const file = [];
  for (const [m, d] of reds) {
    if (file.length >= (i.max ?? 20)) break;
    const key = `proof-${m}-${d}`;
    if (i.openMarkers.has(key) || i.known.has(`${m}|${d}`)) continue;
    if (i.changedAfter(m, M.sha) && !i.stillRed(m, d)) continue;   // a fix already landed: re-read said green
    const row = String(i.failedRow(m, d) || 'see tools/mobproof/matrix.md').replace(/\s+/g, ' ').slice(0, 120);
    file.push({ key, title: `PROOF ${m} ${d}: ${row}`, labels: ['bug', 'dan', 'mobs'], body: `Red cell in the mob proof matrix (sha ${M.sha}): ${m} x ${d}.\nFirst failed row: ${row}\nFix the engine or the data; do not weaken the check.\n\n<!-- dedupe:${key} -->` });
  }
  const pipeline = DIMS.filter((d) => cells.filter((c) => c[1] === d).every((c) => c[2] === 'missing') && !i.openMarkers.has(`proof-pipeline-${d}`))
    .map((d) => ({ key: `proof-pipeline-${d}`, title: `proof pipeline: ${d} missing`, labels: ['bug', 'dan'], body: `Every ${d} cell of the mob proof matrix is MISSING (sha ${M.sha}): the pipeline did not deliver its output. That is a pipeline fault, not a mob fault.\n\n<!-- dedupe:proof-pipeline-${d} -->` }));
  return { fire: file.length + pipeline.length > 0, why: file.length ? 'ok' : 'nothing red to file', file, pipeline };
}

/** #10799: the mechanical step-lane gap -> units of 3-9 mobs, evidence in the body. Deduplicated against open AND closed issues (title/body mention of the mob with a step/lane/course word, or the dedupe marker). */
export function planStepLanes(gap, existing, max = 3) {
  const text = (x) => `${x.title}\n${x.body || ''}`;
  const seen = existing.filter((x) => /step.?lane|steplane|course/i.test(text(x)));
  const mentioned = (m) => seen.some((x) => new RegExp(`(^|[^a-z_])${m}([^a-z_]|$)`, 'i').test(x.title) || (x.body || '').includes(`<!-- dedupe:steplane-${m} -->`));
  const todo = gap.filter((m) => !mentioned(m)), units = [];
  if (todo.length < 3) return units;
  const n = Math.max(1, Math.ceil(todo.length / 9)), per = Math.ceil(todo.length / n);
  for (let i = 0; i < todo.length && units.length < max; i += per) {
    const g = todo.slice(i, i + per); if (g.length < 3 && units.length) { units[units.length - 1].mobs.push(...g); continue; }
    units.push({ mobs: g });
  }
  return units.map((u) => ({ key: `steplane-${u.mobs[0]}`, title: `step lanes: ${u.mobs.join(', ')} (lane in tools/referee/steplanes.d or N/A row with reason)`, labels: ['bug', 'dan', 'mobs'],
    body: `Evidence (#10799): each mob below is in tools/mobl3-mobs.json but has NO lane in tools/referee/steplanes.d and NO row in tools/referee/steplanes.na.json:\n${u.mobs.map((m) => '- ' + m).join('\n')}\n\nFor each: add a step lane (one file in steplanes.d, shape of cat_edge.json) or an N/A row with a reason in steplanes.na.json. The lane check must be able to fail (breaks caught).\n\n${u.mobs.map((m) => `<!-- dedupe:steplane-${m} -->`).join('\n')}` }));
}

/** TESTER GATE: a mob is ready for the visual sign-off only when model, texture, animation, drops, spawn are green. */
export const testerReady = (M, mob) => ['model', 'texture', 'animation', 'drops', 'spawn'].every((d) => M && M.rows && M.rows[mob] && M.rows[mob][d] === 'green');
export const testersReady = (M) => Object.keys((M && M.rows) || {}).filter((m) => testerReady(M, m)).length;

export async function run({ root, gh, ghAll, free, usageOk, post, file = true, max = 20, now = Date.now(), recent = [] }) {
  const T = join(root, 'tools'), R = rd(join(T, 'brain', 'roles.json'), { fill: {} }), thin = Number(R.fill.queueThin);
  if (!Number.isFinite(thin)) return { fire: false, why: 'roles.json fill.queueThin missing', file: [], pipeline: [] };
  const matrix = loadMatrix(root);   // the newest of the live `proof`-branch copy and the committed file, as GATE-AUTO reads it (the committed copy is never a full run)
  const open = await ghAll('/repos/{repo}/issues?state=open&labels=01%20BUGS').catch(() => []);
  const openMarkers = new Set(); for (const x of open) for (const m of String(x.body || '').matchAll(/<!-- dedupe:([^ ]+) -->/g)) openMarkers.add(m[1]);
  const last = recent.filter((c) => c.body && c.body.includes(MARK)).map((c) => Date.parse(c.created_at)).sort().pop() || 0;
  const known = new Set(((rd(join(T, 'goalaudit-known.json'), {}).filed) || []).map((k) => String(k).split('|')[0] + '|goals'));
  const out = (d) => rd(join(T, 'mobproof', 'out', d + '.json'), {});
  const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; } };
  const p = plan({ free, thin, matrix, depLanded: existsSync(join(T, 'mobproof-merge.mjs')), now, lastBatchAt: last, usageOk, openMarkers,
    proven: (rd(join(T, 'mobproof-proven.json'), {}).mobs) || [], order: Object.keys((rd(join(T, 'mobl3-mobs.json'), {}).mobs) || {}), known, max,
    failedRow: (m, d) => { const e = out(d)[m]; const f = e && e.failed && e.failed[0]; return f && (typeof f === 'string' ? f : f.name || f.row || JSON.stringify(f)); },
    changedAfter: (m, sha) => !!sha && !!git('log', '-1', '--format=%h', `${sha}..HEAD`, '--', 'src', '-i', `--grep=${m}`),
    stillRed: (m, d) => { const e = out(d)[m]; return !e || e.pass === false; } });
  if (free < thin && usageOk) {   // #10799: deterministic step-lane units (no model)
    try {
      const gap = (probeSlices(root).find((x) => x.slice.startsWith('roster mobs with no step lane')) || { evidence: [] }).evidence.map((e) => e.split(':')[0]);
      const ex = gap.length ? await ghAll('/repos/{repo}/issues?state=all&per_page=100').catch(() => []) : [];
      const u = planStepLanes(gap, ex.filter((x) => !x.pull_request));
      p.file.push(...u); if (u.length) p.fire = true;
    } catch { /* the red-cell plan stands */ }
  }
  if (file && p.fire) {
    for (const x of [...p.file, ...p.pipeline]) await gh('POST', '/repos/{repo}/issues', { title: x.title, body: x.body, labels: [...x.labels, '01 BUGS'] });
    if (post) await post(`to: log\n\n${MARK}: ${p.file.length} PROOF + ${p.pipeline.length} pipeline`);
  }
  return p;
}
