#!/usr/bin/env node
// redissuecheck.mjs - #1912: the full suite files one issue per red check and closes it when the check is green again
// (tools/infra/redissues.mjs planRedIssues, called by tools/infra/full.mjs). Unit cases, then anti-vacuity: four broken
// planners (never closes, duplicates, files quarantined checks, closes a check that did not run, strips the hyphen #9647) must each fail.
import { planRedIssues, titleFor, LABEL } from './infra/redissues.mjs';

let asserts = 0, fails = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const iss = (number, title, state = 'open', labels = []) => ({ number, title, state, labels });
const has = (acts, op, id, number) => acts.some((a) => a.op === op && a.id === id && (number === undefined || a.number === number));

function cases(plan) {
  const bad = [];
  const t = (name, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(name); };
  const base = { failed: [], skipped: [], quarantine: {}, issues: [] };
  t('a new red with no issue is created', () => { const a = plan({ ...base, failed: ['cullcheck'] }); return a.length === 1 && has(a, 'create', 'cullcheck'); });
  t('a red already named by an open hand-filed issue is not duplicated', () => plan({ ...base, failed: ['backendcheck'], issues: [iss(1681, 'backendcheck: game does not start under load', 'open', ['bug'])] }).length === 0);
  t('a red with its own open issue is not duplicated', () => plan({ ...base, failed: ['g10check'], issues: [iss(5, titleFor('g10check'), 'open', [LABEL])] }).length === 0);
  t('a name inside a longer name does not count (g10check vs g10checkx)', () => has(plan({ ...base, failed: ['g10check'], issues: [iss(6, 'g10checkx is slow')] }), 'create', 'g10check'));
  t('a closed RED issue is reopened, not duplicated', () => { const a = plan({ ...base, failed: ['lumacheck'], issues: [iss(7, titleFor('lumacheck'), 'closed', [LABEL])] }); return a.length === 1 && has(a, 'reopen', 'lumacheck', 7); });
  t('a quarantined red is not filed', () => plan({ ...base, failed: ['dupcheck'], quarantine: { dupcheck: '#99' } }).length === 0);
  t('the missing-ledger marker is not filed as a check', () => plan({ ...base, failed: ['suite-ledger-missing'] }).length === 0);
  t('our issue closes when its check ran and passed', () => has(plan({ ...base, issues: [iss(8, titleFor('palettecheck'), 'open', [LABEL])] }), 'close', 'palettecheck', 8));
  t('our issue stays open when its check did not run', () => plan({ ...base, skipped: ['palettecheck'], issues: [iss(8, titleFor('palettecheck'), 'open', [LABEL])] }).length === 0);
  t('our issue stays open while still red', () => plan({ ...base, failed: ['palettecheck'], issues: [iss(8, titleFor('palettecheck'), 'open', [LABEL])] }).length === 0);
  t('#9647: a hyphenated red with its own open issue is not duplicated', () => plan({ ...base, failed: ['lockstep-explosiondamage'], issues: [iss(9597, titleFor('lockstep-explosiondamage'), 'open', [LABEL])] }).length === 0);
  t('#9647: a hyphenated red is not hidden by a longer hyphenated name', () => has(plan({ ...base, failed: ['lockstep-skeleton'], issues: [iss(10, titleFor('lockstep-skeleton-server'), 'open', [LABEL])] }), 'create', 'lockstep-skeleton'));
  t('a hand-filed issue is never closed by the suite', () => plan({ ...base, issues: [iss(9, titleFor('flashcheck'), 'open', ['bug'])] }).length === 0);
  return bad;
}

const bad = cases(planRedIssues);
ok(bad.length === 0, 'planRedIssues failed: ' + bad.join('; '));

let breaks = 0;
const neverCloses = (x) => planRedIssues(x).filter((a) => a.op !== 'close');
const duplicates = (x) => [...planRedIssues(x), ...(x.failed || []).filter((id) => !(x.quarantine || {})[id] && id !== 'suite-ledger-missing' && !planRedIssues(x).some((a) => a.id === id)).map((id) => ({ op: 'create', id }))];
const filesQuarantined = (x) => planRedIssues({ ...x, quarantine: {} });
const closesUnrun = (x) => planRedIssues({ ...x, skipped: [] });
const stripsHyphen = (x) => planRedIssues(x, (title, id) => new RegExp(`(^|[^a-z0-9_])${id.replace(/[^a-z0-9_]/gi, '')}([^a-z0-9_]|$)`, 'i').test(title));   // #9647: the old matcher
for (const [name, fn] of [['never closes', neverCloses], ['duplicates', duplicates], ['files quarantined checks', filesQuarantined], ['closes a check that did not run', closesUnrun], ['strips the hyphen from the id (#9647)', stripsHyphen]]) {
  const b = cases(fn);
  ok(b.length > 0, `the cases cannot tell "${name}" from the real planner`);
  if (b.length) { breaks++; console.log(`  ✓ "${name}" fails ${b.length} case(s): ${b.slice(0, 2).join(' | ')}`); }
}
console.log(`redissuecheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
