// pcretirecheck (#10414): the retirement verdict says "retire" only when the hosted path is on AND the PC path was idle for 24 h. Each rule is then broken to prove the check fails.
import { readiness, PIECES } from './infra/pcretire.mjs';
// built from pieces: the test mirror's scrub rewrites the literal PC host name to 'PC', which would make this check fail there only (tools/infra/mirror.mjs does the same)
const PCHOST = 'DESKTOP-' + '6OUIDG0';
const now = Date.parse('2026-10-27T12:00:00Z'), hrs = (h) => new Date(now - h * 3600e3).toISOString();
const verdictOf = (impl, vars, runs, rn = []) => Object.fromEntries(impl(vars, runs, now, rn).map((r) => [r.piece, r.verdict]));
const U = (h, at) => JSON.stringify({ at: hrs(h), host: at }), ON = { BRAIN_RUNNER: 'mirror', TEST_RUNNER: 'lattice' };
function verdict(impl) {
  const bad = [], idle = { 'brain.yml': [{ created_at: hrs(2), conclusion: 'skipped' }], 'land.yml': [], 'full-suite.yml': [{ created_at: hrs(30), conclusion: 'success' }] };
  let v = verdictOf(impl, ON, idle);
  if (Object.values(v).some((x) => x !== 'retire')) bad.push('all hosted + idle PC is not retire: ' + JSON.stringify(v));
  v = verdictOf(impl, {}, idle); if (Object.values(v).some((x) => x !== 'keep')) bad.push('retire with no hosted variable set');
  v = verdictOf(impl, { ...ON, TEST_RUNNER: 'pc' }, idle); if (v['lander runners -land/-land2'] !== 'keep' || v['full-suite GPU runner'] !== 'keep') bad.push('retire the lander/full runner while TEST_RUNNER=pc');
  v = verdictOf(impl, ON, { ...idle, 'brain.yml': [{ created_at: hrs(1), conclusion: 'success' }] }); if (v['Hyper-V brain VM'] !== 'keep') bad.push('retire the VM although brain.yml ran on it an hour ago');
  v = verdictOf(impl, ON, { ...idle, 'land.yml': [{ created_at: hrs(1), conclusion: 'failure' }] }); if (v['lander runners -land/-land2'] !== 'keep') bad.push('a failed PC run does not count as PC work');
  v = verdictOf(impl, { ...ON, MCLITE_USAGE: U(0.1, PCHOST) }, idle); if (v['usaged service'] !== 'keep') bad.push('retire usaged although the PC stamped MCLITE_USAGE minutes ago');
  v = verdictOf(impl, { ...ON, MCLITE_USAGE: U(0.1, 'runner-abc') }, idle); if (v['usaged service'] !== 'retire') bad.push('the hosted tick stamping MCLITE_USAGE counts as PC work');
  v = verdictOf(impl, { ...ON, MCLITE_USAGE: U(30, PCHOST) }, idle); if (v['usaged service'] !== 'retire') bad.push('a 30 h old PC stamp counts as PC work');
  v = verdictOf(impl, ON, { ...idle, 'brain.yml': [{ created_at: hrs(16), conclusion: null, status: 'queued' }] }); if (v['Hyper-V brain VM'] !== 'retire') bad.push('a run queued for 16 h that no PC runner took counts as PC work');
  v = verdictOf(impl, ON, { ...idle, 'brain.yml': [{ created_at: hrs(0.1), conclusion: null, status: 'queued' }] }); if (v['Hyper-V brain VM'] !== 'keep') bad.push('a run queued 6 minutes ago (a busy runner) does not count as PC work');
  v = verdictOf(impl, ON, idle, [{ name: 'DADS', busy: true }]); if (v['idle DADS runners'] !== 'keep') bad.push('retire the DADS runners while one is busy');
  v = verdictOf(impl, ON, idle, [{ name: 'DADS', busy: false }, { name: 'brain-1', busy: true }]); if (v['idle DADS runners'] !== 'retire') bad.push('an idle DADS runner (or a busy non-DADS one) blocks retiring');
  v = verdictOf(impl, { BRAIN_RUNNER: 'mirror', TEST_RUNNER: 'pc' }, idle, []); if (v['idle DADS runners'] !== 'keep') bad.push('retire DADS runners while TEST_RUNNER=pc');
  const whyOf = (vars) => Object.fromEntries(impl(vars, idle, now, []).map((r) => [r.piece, r.why]));
  let w = whyOf({}); if (!/BRAIN_RUNNER=mirror/.test(w['Hyper-V brain VM']) || !/TEST_RUNNER=lattice/.test(w['lander runners -land/-land2']) || !/BRAIN_RUNNER=mirror and TEST_RUNNER=lattice/.test(w['idle DADS runners'])) bad.push('a keep line does not name the variable to set');
  if (Object.keys(PIECES).length !== 6) bad.push('piece list changed');
  return bad;
}
const base = readiness;
const breaks = [
  (a, b, n, r) => base(a, b, n, r).map((x) => ({ ...x, why: x.why.replace(/set repo variable .*/, 'set it') })),   // the keep line names no variable
  (a, b, n, r) => base(a, b, n, []),                                                         // busy DADS runners ignored
  (a, b, n, r) => base(a, b, n, (r || []).map((x) => ({ ...x, busy: true }))),               // every runner counted busy

  (a, b, n) => base(a, Object.fromEntries(Object.entries(b).map(([k, r]) => [k, r.map((x) => ({ ...x, status: undefined }))])), n),  // stuck queued runs counted
  (a, b, n) => base(a, Object.fromEntries(Object.entries(b).map(([k, r]) => [k, r.filter((x) => x.status !== 'queued')])), n),     // every queued run ignored
  (a, b, n) => base(a, b, n).map((r) => ({ ...r, verdict: 'retire' })),                      // always retire
  (a, b, n) => base(a, {}, n),                                                               // ignores runs
  (a, b, n) => base({ BRAIN_RUNNER: 'mirror', TEST_RUNNER: 'lattice' }, b, n),               // ignores variables
  (a, b, n) => base({ ...a, MCLITE_USAGE: undefined }, b, n),                                // ignores the usaged stamp
  (a, b, n) => base(a, Object.fromEntries(Object.entries(b).map(([k, r]) => [k, r.filter((x) => x.conclusion === 'success')])), n), // failures not counted
];
const bad = verdict(base); bad.forEach((b) => console.log('FAIL', b));
let caught = 0; breaks.forEach((b, i) => { if (verdict(b).length) caught++; else console.log('NOT CAUGHT: break #' + (i + 1)); });
console.log(`pcretirecheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
process.exit(bad.length || caught < breaks.length ? 1 : 0);
