#!/usr/bin/env node
// phoneoutcomecheck.mjs - #8091: finished runs on the phone read as an outcome in words, and the filter keeps only that outcome.
// ANTI-VACUITY: each break changes runs.js and must make an assert fail ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const T = fileURLToPath(new URL('.', import.meta.url)), SRC = readFileSync(join(T, 'phone-web/runs.js'), 'utf8'), APP = readFileSync(join(T, 'phone-web/app.js'), 'utf8');
const run = (src) => {
  const f = [], d = mkdtempSync(join(tmpdir(), 'oc-')); writeFileSync(join(d, 'r.cjs'), src); const R = createRequire(import.meta.url)(join(d, 'r.cjs'));
  const ok = (c, m) => { if (!c) f.push(m); };
  const e = (o) => ({ ok: true, text: '', cost: 0, turns: 0, ...o });
  ok(R.outcome(e({ text: 'landed' })) === 'landed', 'landed');
  ok(R.outcome(e({ text: 'already fixed on master' })) === 'fixed', 'already fixed');
  ok(R.outcome(e({ text: 'partial' })) === 'partial', 'partial');
  ok(R.outcome(e({ text: 'no issue claimable', cost: 0.5, turns: 20 })) === 'nothing', 'found nothing');
  ok(R.outcome(e({ ok: false, text: 'landed' })) === 'gaveup', 'failed run is gave up');
  ok(R.outcomeLabel(e({ text: 'already fixed' })) === 'Already fixed', 'label in words');
  const l = [e({ text: 'landed' }), e({ text: 'landed' }), e({ ok: false })];
  ok(R.byOutcome(l, 'landed').length === 2 && R.byOutcome(l, 'gaveup').length === 1 && R.byOutcome(l, 'all').length === 3, 'filter keeps only that outcome');
  const c = R.outcomeCounts(l); ok(c.all === 3 && c.landed === 2 && c.gaveup === 1 && c.partial === 0, 'counts');
  ok(/data-flt/.test(APP) && /outcomeLabel/.test(APP), 'app shows filter chips and the outcome word');
  return f;
};
const base = run(SRC); if (base.length) { console.log('FAIL: ' + base.join('; ')); process.exit(1); }
const breaks = [['gave up first', (s) => s.replace("if (!e || !e.ok) return 'gaveup';", '')], ['fixed regex', (s) => s.replace('already (fixed', 'zzz (fixed')], ['partial regex', (s) => s.replace('partial|part of', 'zzz|part of')],
  ['nothing regex', (s) => s.replace('no (open )?issue', 'zzz')], ['filter ignores id', (s) => s.replace('filter((e) => outcome(e) === id)', 'filter(() => true)')], ['counts', (s) => s.replace('c[outcome(e)]++', '')], ['label', (s) => s.replace("label: 'Already fixed'", "label: 'x'")]];
let caught = 0; for (const [n, fn] of breaks) { const m = fn(SRC); if (m === SRC) { console.log('NO-OP break: ' + n); process.exit(1); } if (run(m).length) caught++; else console.log('NOT CAUGHT: ' + n); }
console.log(`phoneoutcomecheck: ${caught} breaks caught`); process.exit(caught === breaks.length ? 0 : 1);
