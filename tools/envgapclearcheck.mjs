#!/usr/bin/env node
// envgapclearcheck.mjs - #10681: a closed ENV GAP issue releases the issue it held. needs-java stayed on #9446 for 8 days after its gap closed. planClear on fixtures + wiring + breaks.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { eg: rd('./infra/envgap.mjs'), brain: rd('./brain/brain.mjs') };
const load = async (s) => { const d = mkdtempSync(join(tmpdir(), 'egcl-')); const f = join(d, 'envgap.mjs'); writeFileSync(f, s); return import('file://' + f.replace(/\\/g, '/') + '?' + Math.random()); };
const L = (...n) => n.map((name) => ({ name }));
const held = (st = 'open', labels = L('env-gap', 'blocked', 'needs-java')) => ({ number: 9446, title: 'soak', state: st, labels });
const gap = (st, kind = 'server') => ({ number: 9508, title: `ENV GAP (${kind}): workers cannot do #9446 until this is provisioned`, state: st, labels: L('infra', 'env-gap') });
async function verdict(S) {
  const bad = []; const t = async (n, f) => { let r = false; try { r = !!(await f()); } catch { r = false; } if (!r) bad.push(n); };
  let M; try { M = await load(S.eg); } catch (e) { return ['does not load: ' + e.message]; }
  await t('closed gap -> env-gap and needs-java removed, blocked kept', () => { const p = M.planClear({ all: [held(), gap('closed')] }); return p.length === 1 && p[0].issue === 9446 && p[0].remove.sort().join() === 'env-gap,needs-java'; });
  await t('open gap -> labels kept', () => M.planClear({ all: [held(), gap('open')] }).length === 0);
  await t('data gap removes needs-data only', () => { const p = M.planClear({ all: [held('open', L('env-gap', 'needs-data', 'needs-java')), gap('closed', 'data')] }); return p[0].remove.sort().join() === 'env-gap,needs-data'; });
  await t('no gap issue found -> kept (hand-labelled)', () => M.planClear({ all: [held()] }).length === 0);
  await t('a closed held issue or a gap issue itself is never touched', () => M.planClear({ all: [held('closed'), gap('closed')] }).length === 0);
  await t('one gap still open among several -> kept', () => M.planClear({ all: [held(), gap('closed'), { ...gap('open'), number: 9600 }] }).length === 0);
  await t('brain health pass calls it and removes labels', () => /planClear\(\{ all \}\)/.test(S.brain) && /await clearGapHolds\(\)\.catch/.test(S.brain) && /labels\/\$\{encodeURIComponent\(l\)\}/.test(S.brain));
  return bad;
}
const real = await verdict(SRC); let caught = 0;
const m = (k, a, b) => ({ ...SRC, [k]: SRC[k].replace(a, b) });
const BREAKS = [
  ['clearing disabled', m('eg', 'if (!gaps.length ||', 'if (true || !gaps.length ||')],
  ['open gap still clears', m('eg', 'gaps.some((g) => g.state === \'open\')', 'false')],
  ['needs-java kept', m('eg', "gone.add(k.label)", "void k.label")],
  ['no-gap issue cleared', m('eg', '!gaps.length ||', '')],
  ['brain never calls it', m('brain', 'await clearGapHolds().catch', 'await 0 && clearGapHolds().catch')],
];
for (const [n, S] of BREAKS) { const r = await verdict(S); if (r.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`envgapclearcheck: ${real.length ? 'FAILED' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
