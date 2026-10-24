// tools/routeevalcheck.mjs - #8980 (Dan, 19 Oct: checks must run the real thing). EVALUATES brain.yml's `route` job `if:` (and the `run` job's) on sample
// events with tools/infra/ghexpr.mjs, instead of grepping its text. 19 Oct: `!contains(body,'from: brain')` skipped every health alert (all are
// `from: brain`) for 24 h; the grep checks stayed green. Anti-vacuity: re-adds that exclusion and other faults to the workflow text, and breaks the
// evaluator itself; each must make this check fail.
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { yml: rd('../.github/workflows/brain.yml'), expr: rd('./infra/ghexpr.mjs') };
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const ifOf = (yml, job) => {   // the `if:` line directly under `  <job>:` (2-space job key), quotes stripped; only LOCATES the expression, the verdict comes from evaluating it
  const lines = yml.split('\n'); const at = lines.findIndex((l) => l === `  ${job}:`); if (at < 0) return null;
  for (let i = at + 1; i < lines.length && /^(    |\s*$|\s*#)/.test(lines[i]); i++) { const m = /^    if: (.*)$/.exec(lines[i]); if (m) { let v = m[1].trim(); if (/^"[\s\S]*"$/.test(v)) v = v.slice(1, -1); return v; } }
  return null;
};
const ev = (body, labels = ['bus']) => ({ github: { event_name: 'issue_comment', event: { issue: { labels: labels.map((name) => ({ name })) }, comment: { body } } }, vars: {} });
const mail = (to, from) => `to: ${to}\nfrom: ${from}\n\nsome text`;
const CASES = [   // [name, ctx, route should run]
  ['health alert to commander from brain', ev(mail('commander', 'brain')), true],
  ['health alert to fixer from brain', ev(mail('fixer', 'brain')), true],
  ['mail to commander from Dan', ev(mail('commander', 'dan')), true],
  ['mail to commander from a worker branch', ev(mail('commander', 'work/8625-x')), true],
  ['request mail', ev(mail('requests', 'dan')), true],
  ['mail to enlarger', ev(mail('enlarger', 'brain')), true],
  ['mail to dan (pushes to the phone)', ev(mail('dan', 'brain')), true],
  ['upper-case header', ev(mail('Commander', 'Brain')), true],
  ['to: log line (the brain\'s own record)', ev(mail('log', 'brain')), false],
  ['to: all news', ev(mail('all', 'dan')), false],
  ['comment on a non-bus issue', ev(mail('commander', 'brain'), ['bug']), false],
  ['bus comment with no header', ev('hello'), false],
  ['schedule, BRAIN_RUNNER unset', { github: { event_name: 'schedule', event: {} }, vars: {} }, true],
  ['schedule, BRAIN_RUNNER=mirror (the tick moved)', { github: { event_name: 'schedule', event: {} }, vars: { BRAIN_RUNNER: 'mirror' } }, false],
  ['schedule, BRAIN_RUNNER=vm', { github: { event_name: 'schedule', event: {} }, vars: { BRAIN_RUNNER: 'vm' } }, true],
  ['workflow_dispatch', { github: { event_name: 'workflow_dispatch', event: {} }, vars: {} }, true],
];
async function verdict(S) {
  const bad = []; let E; try { E = await load(S.expr); } catch (e) { return [`ghexpr.mjs does not load: ${e.message}`]; }
  const { evaluate, truthy } = E;
  const t = (name, expr, ctx, want) => { let got; try { got = truthy(evaluate(expr, ctx)); } catch (e) { bad.push(`evaluator: ${name}: ${e.message}`); return; } if (got !== want) bad.push(`evaluator: ${name}: got ${got}, want ${want}`); };
  const C = { github: { event: { body: 'Hello World', labels: [{ name: 'A' }, { name: 'b' }] } }, vars: { X: 'y' } };
  t("contains is case-insensitive", "contains(github.event.body, 'hello')", C, true);
  t('contains misses', "contains(github.event.body, 'nope')", C, false);
  t('contains over a projected array', "contains(github.event.labels.*.name, 'B')", C, true);
  t('contains over a projected array misses', "contains(github.event.labels.*.name, 'c')", C, false);
  t('startsWith', "startsWith(github.event.body, 'hello w')", C, true);
  t('endsWith', "endsWith(github.event.body, 'WORLD')", C, true);
  t('== is case-insensitive', "vars.X == 'Y'", C, true);
  t('!= differs', "vars.X != 'z'", C, true);
  t('missing var is null, != holds', "vars.NOPE != 'mirror'", C, true);
  t('missing var == empty string', "vars.NOPE == ''", C, true);
  t('! negates', "!contains(github.event.body, 'hello')", C, false);
  t('&& needs both', "vars.X == 'y' && vars.X == 'z'", C, false);
  t('|| needs one', "vars.X == 'q' || vars.X == 'y'", C, true);
  t('precedence: && binds tighter than ||', "true || false && false", C, true);
  t('parentheses', "(true || false) && false", C, false);
  t('${{ }} wrapper', "${{ vars.X == 'y' }}", C, true);
  t("doubled quote in a string", "'it''s' == 'IT''S'", C, true);
  for (const bad2 of ["contains(", "vars.X ==", "'open"]) { let threw = false; try { evaluate(bad2, C); } catch { threw = true; } if (!threw) bad.push(`evaluator accepts malformed ${JSON.stringify(bad2)}`); }
  const route = ifOf(S.yml, 'route'), run = ifOf(S.yml, 'run');
  if (!route) bad.push('brain.yml: the route job has no `if:`');
  else for (const [name, ctx, want] of CASES) t(`route: ${name}`, route, ctx, want);
  if (!run) bad.push('brain.yml: the run job has no `if:`');
  else { t('run: a role was routed', run, { needs: { route: { outputs: { role: 'commander' } } } }, true); t('run: no role routed', run, { needs: { route: { outputs: { role: '' } } } }, false); }
  return bad;
};
const sub = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error('break target missing: ' + a); return { ...S, [k]: S[k].replace(a, b) }; };
const BREAKS = [
  ['re-add the from: brain exclusion (19 Oct)', sub('yml', "contains(github.event.comment.body, 'to: commander') ||", "(contains(github.event.comment.body, 'to: commander') && !contains(github.event.comment.body, 'from: brain')) ||")],
  ['drop the to: commander clause', sub('yml', "contains(github.event.comment.body, 'to: commander') || ", '')],
  ['drop the to: dan clause', sub('yml', " || contains(github.event.comment.body, 'to: dan')", '')],
  ['drop the bus label requirement', sub('yml', "contains(github.event.issue.labels.*.name, 'bus') && ", '')],
  ['route every comment (to: log runs)', sub('yml', "contains(github.event.comment.body, 'to: dan')", "contains(github.event.comment.body, 'to: ')")],
  ['mirror tick no longer skips the schedule', sub('yml', "vars.BRAIN_RUNNER != 'mirror'", "vars.BRAIN_RUNNER != 'nothing'")],
  ['run job runs without a role', sub('yml', "if: needs.route.outputs.role != ''", "if: true")],
  ['evaluator: contains always true', sub('expr', 'contains: (a, b) => {', 'contains: (a, b) => { return true;')],
  ['evaluator: && behaves as ||', sub('expr', 'a = truthy(a) ? b : a; } return a; }\n  function or', 'a = truthy(a) ? a : b; } return a; }\n  function or')],
  ['evaluator: ! does nothing', sub('expr', "if (isOp('!')) { k++; return !truthy(unary()); } return primary();", "if (isOp('!')) { k++; return truthy(unary()); } return primary();")],
  ['evaluator: == is case-sensitive', sub('expr', "return lower(a) === lower(b);", 'return a === b;')],
  ['evaluator: a missing path throws instead of being null', sub('expr', 'if (!cur.length) return star ? [] : null;', "if (!cur.length) throw new Error('missing');")],
];
const real = await verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { let m; try { m = mk(SRC); } catch (e) { console.log(' BAD BREAK:', n, e.message); continue; } if ((await verdict(m)).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`routeevalcheck: ${CASES.length + 19} cases, ${real.length} failed; ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
