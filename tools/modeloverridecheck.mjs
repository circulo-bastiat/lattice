#!/usr/bin/env node
// modeloverridecheck.mjs - #4963 (Dan, 10 Oct: run ONE worker on Haiku 5.5): a brain run whose reason carries model=<id> uses that model;
// nothing else changes the model. Also: the tester role runs at low effort for the 5.5 test. behaviour + wiring + anti-vacuity.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const P = (f) => fileURLToPath(new URL('../' + f, import.meta.url)), rd = (f) => readFileSync(P(f), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const ROUTE = rd('tools/brain/route.mjs'), LAUNCH = rd('tools/brain/launch.mjs'), ROLES = JSON.parse(rd('tools/brain/roles.json'));
let seq = 0;
async function load(src) { const f = P(`tools/brain/_modelfor${process.pid}_${seq++}.tmp.mjs`); writeFileSync(f, src); try { return await import(pathToFileURL(f).href); } finally { unlinkSync(f); } }
function cases(R) { const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  const m = R.modelFor;
  t('model=claude-haiku-5-5 wins', () => m('model=claude-haiku-5-5', 'sonnet') === 'claude-haiku-5-5');
  t('inside a longer reason', () => m('Dan test model=claude-haiku-5-5 please', 'sonnet') === 'claude-haiku-5-5');
  t('no reason keeps the fallback', () => m('', 'sonnet') === 'sonnet' && m(undefined, 'sonnet') === 'sonnet');
  t('a reason without model= keeps the fallback', () => m('started by Dan', 'sonnet') === 'sonnet');
  t('the word model inside another word does not count', () => m('remodel=xyz', 'sonnet') === 'sonnet');
  t('shell junk is refused', () => m('model=a;rm -rf /', 'sonnet') === 'sonnet' && m('model=$(x)', 'sonnet') === 'sonnet');
  t('an ISO waker reason keeps the fallback', () => m('2026-10-10T18:00:00.000Z', 'sonnet') === 'sonnet');
  return bad; }
const bad = cases(await load(ROUTE)); ok(bad.length === 0, 'behaviour: ' + bad.join(' | '));
const wiring = (S) => { const b = [];
  if (!/modelFor\(reason, /.test(S.l)) b.push('launch.mjs does not use modelFor(reason, ...)');
  if (!/authFailed, modelFor \} from/.test(S.l)) b.push('launch.mjs does not import modelFor');
  if (S.j.roles.tester.effort !== 'low') b.push('tester effort is not low (the 5.5 test)');
  if (S.j.roles.worker.model !== 'sonnet') b.push('worker model changed from sonnet (only the one-off override may change it)');
  return b; };
const S0 = { l: LAUNCH, j: ROLES }; ok(wiring(S0).length === 0, 'wiring: ' + wiring(S0).join(' | '));
for (const [n, f] of [
  ['override ignored', (s) => s.replace('return m ? m[1] : fallback;', 'return fallback;')],
  ['override always on', (s) => s.replace('return m ? m[1] : fallback;', "return m ? m[1] : 'claude-haiku-5-5';")],
  ['shell junk accepted', (s) => s.replace('[A-Za-z0-9.-]{1,60}', '[^ ]{1,60}')],
  ['model= inside another word counts', (s) => s.replace('(?:^|\\s)model=', 'model=')],
]) { const m = f(ROUTE); let c = false; if (m !== ROUTE) { try { c = cases(await load(m)).length > 0; } catch { c = true; } } ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
for (const [n, f] of [
  ['launch stops using modelFor', (S) => ({ ...S, l: S.l.replace('modelFor(reason, ', '(') })],
  ['tester effort back to medium', (S) => ({ ...S, j: { ...S.j, roles: { ...S.j.roles, tester: { ...S.j.roles.tester, effort: 'medium' } } } })],
  ['worker model switched', (S) => ({ ...S, j: { ...S.j, roles: { ...S.j.roles, worker: { ...S.j.roles.worker, model: 'haiku' } } } })],
]) { const m = f(S0); const c = JSON.stringify(m) !== JSON.stringify(S0) && wiring(m).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
console.log(`modeloverridecheck: ${asserts} assertions, ${fails} failed, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
