#!/usr/bin/env node
// promptvarscheck.mjs - #9677: no role prompt reaches claude with an unfilled {placeholder}. The reviewer prompt used {issue}, promptFor filled only {reason}
// and {brief}, so every reviewer run got the literal "{issue}" and answered "What would you like me to work on?" (0 verdicts in 7 days). Breaks: drop {issue}.
import { readFileSync } from 'node:fs';
const R = await import('./brain/route.mjs'), CFG = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8'));
const SRC = readFileSync(new URL('./brain/route.mjs', import.meta.url), 'utf8');
let asserts = 0, fails = 0, breaks = 0; const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
// #9600: the reviewer now names its issue through {brief} (its last line); a probe role keeps {issue} covered so the old promptFor stays caught
const CFG2 = { ...CFG, roles: { ...CFG.roles, probe: { prompt: 'static part\n\nissue: {issue}' } } };
const run = (pf) => { const bad = []; for (const role of Object.keys(CFG2.roles)) { const p = pf(CFG2, role, 'review #9600 (PR 9634)', 'BRIEF'); const left = p.match(/\{[a-z]+\}/g); if (left) bad.push(`${role}: ${left.join(' ')}`); }
  if (!pf(CFG2, 'probe', 'review #9600 (PR 9634)', '').includes('9600')) bad.push('{issue} is not filled from the reason');
  if (!pf(CFG2, 'reviewer', 'review #9600 (PR 9634)', '### Issue #9600: t').includes('9600')) bad.push('the reviewer prompt does not carry its brief (which names the issue)'); return bad; };
const real = run(R.promptFor); ok(real.length === 0, 'unfilled: ' + real.join('; '));
const old = (cfg, role, reason, brief = '') => cfg.roles[role].prompt.replace('{reason}', reason || 'none given').replace('{brief}', brief);
const b = run(old); ok(b.length > 0, 'cases cannot tell the old promptFor'); if (b.length) { breaks++; console.log('  ✓ the old promptFor (no {issue}) is caught: ' + b[0]); }
ok(/\.replace\(\/\\\{issue\\\}\/g/.test(SRC), 'promptFor fills {issue}');
console.log(`promptvarscheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
