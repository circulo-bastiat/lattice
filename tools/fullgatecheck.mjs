#!/usr/bin/env node
// fullgatecheck.mjs - the full suite waits for landings to pause (tools/infra/fullgate.mjs), never starves, and the workflow runs it first.
// ANTI-VACUITY: each break below must be caught ("<n> breaks caught").
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { gate: read('./infra/fullgate.mjs'), yml: readFileSync(new URL('../.github/workflows/full-suite.yml', import.meta.url), 'utf8') };
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src.replace(/^import .*$/m, 'const gh = null, ghAll = null;')).toString('base64'));
let N = 0;
async function run(S) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const G = await load(S.gate), now = 1e9, base = { now, headAt: now - 10 * 60e3, landPRs: 0, landRunning: 0, waitedMs: 0 };
  ok(G.decide(base).go === true, 'everything quiet: the full suite starts');
  ok(G.decide({ ...base, landPRs: 2 }).go === false, 'a PR labelled land is queued: wait');
  ok(G.decide({ ...base, landRunning: 1 }).go === false, 'a lander run is queued or running: wait');
  ok(G.decide({ ...base, headAt: now - 30e3 }).go === false, 'master changed 30 s ago: wait for it to settle');
  ok(G.decide({ ...base, headAt: now - G.QUIET_MS - 1 }).go === true, 'master quiet for longer than QUIET_MS: go');
  ok(G.decide({ ...base, landPRs: 5, landRunning: 2, headAt: now, waitedMs: G.MAX_WAIT_MS }).go === true, 'never starves: after MAX_WAIT_MS it runs even while landings continue');
  ok(G.decide({ ...base, landPRs: 5, waitedMs: G.MAX_WAIT_MS - 1 }).go === false, 'one minute before the cap it still waits');
  ok(G.MAX_WAIT_MS <= 45 * 60e3 && G.MAX_WAIT_MS >= 10 * 60e3, 'the cap is between 10 and 45 minutes');
  const pc = (/full-pc:[\s\S]*$/.exec(S.yml) || [''])[0], iGate = pc.indexOf('fullgate.mjs'), iFull = pc.indexOf('full.mjs');
  ok(iGate > 0 && iFull > iGate, 'full-suite.yml: the full-pc job runs fullgate.mjs BEFORE full.mjs');
  ok(/cancel-in-progress:\s*false/.test(S.yml) && !/cancel-in-progress:\s*true/.test(S.yml), 'full-suite.yml: a newer master never cancels a running full suite (#6548: every run was cancelled, no result for 21 h)');
  ok(/timeout-minutes:\s*(\d+)/.test(pc) && Number(/timeout-minutes:\s*(\d+)/.exec(pc)[1]) >= 90, 'the job timeout leaves room for the wait plus the run');
  return f;
}
const rep = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error(`no such text in ${k}: ${a}`); return { ...S, [k]: S[k].split(a).join(b) }; };
const fails = await run(SRC), total = N;
const BREAKS = [
  ['queued land PRs ignored', rep('gate', 'if (landPRs > 0)', 'if (false)')],
  ['lander runs ignored', rep('gate', 'if (landRunning > 0)', 'if (false)')],
  ['no quiet period', rep('gate', 'now - headAt < QUIET_MS', 'false')],
  ['quiet period far too long', rep('gate', 'QUIET_MS = 4 * 60e3', 'QUIET_MS = 4 * 60e6')],
  ['it can starve forever', rep('gate', 'if (waitedMs >= MAX_WAIT_MS)', 'if (false)')],
  ['the cap is a day', rep('gate', 'MAX_WAIT_MS = 30 * 60e3', 'MAX_WAIT_MS = 1440 * 60e3')],
  ['workflow does not run the gate', rep('yml', 'fullgate.mjs', 'nothing.mjs')],
  ['workflow runs the gate after the suite', (S) => { const m = /(node tools\\infra\\fullgate\.mjs[^\n]*\n)/.exec(S.yml); if (!m) throw new Error('no such text in yml: fullgate line'); return { ...S, yml: S.yml.replace(m[1], '').replace(/(node tools\\infra\\full\.mjs[^\n]*\n)/, `$1          ${m[1]}`) }; }],
  ['a newer master cancels a running suite again (#6548)', rep('yml', 'cancel-in-progress: false', 'cancel-in-progress: true')],
];
let caught = 0;
for (const [name, mut] of BREAKS) {
  let r; try { r = await run(mut(SRC)); } catch (e) { r = [`threw: ${e.message}`]; if (/no such text/.test(e.message)) fails.push(`break "${name}": ${e.message}`); }
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
}
console.log(`fullgatecheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !/^break/.test(x)).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
