// tools/claimlockcheck.mjs - #6416: claimKey / heldByComment (tools/infra/claimlock.mjs) and their wiring in claim(). Anti-vacuity below.
import { readFileSync } from 'node:fs';
import * as L from './infra/claimlock.mjs';
const GO = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
const T = Date.parse('2026-10-12T17:10:00Z'), SHA = 'a'.repeat(40), SHB = 'b'.repeat(40);
const verdict = (K, held = L.heldByComment, go = GO) => {
  const bad = [], thr = (f) => { try { f(); return false; } catch { return true; } };
  if (K(6392, SHA, T) !== K(6392, SHA, T + 1000)) bad.push('same inputs, different key');
  if (K(6392, SHA, T) === K(6398, SHA, T)) bad.push('issue not in key');
  if (K(6392, SHA, T) === K(6392, SHB, T)) bad.push('sha not in key');
  if (K(6392, SHA, T) === K(6392, SHA, T + 11 * 60000)) bad.push('bucket not in key');
  if (!thr(() => K(6392, undefined, T))) bad.push('no sha accepted');
  if (!thr(() => K(0, SHA, T))) bad.push('no issue accepted');
  if (!thr(() => K(6392, SHA, NaN))) bad.push('no bucket accepted');
  const c = (run, ago) => ({ body: `<!-- brain-run ${run} worker #3 -->\nT`, created_at: new Date(T - ago).toISOString() });
  if (!held([c(1, 25000)], 2, T)) bad.push('fresh other-run marker not held');
  if (held([c(2, 25000)], 2, T)) bad.push('own marker counts as held');
  if (held([c(1, 11 * 60000)], 2, T)) bad.push('old marker held');
  if (held([{ body: 'hi', created_at: new Date(T).toISOString() }], 2, T)) bad.push('plain comment held');
  if (!/claimKey\(issue\.number, head\.sha\)[\s\S]{0,200}status === 422\) return null/.test(go)) bad.push('claim() does not lock before takeover');
  if (!/heldByComment\(cs/.test(go)) bad.push('claim() ignores comments');
  return bad;
};
const BREAKS = [
  ['no bucket', verdict((i, s, n) => L.claimKey(i, s, 0))],
  ['no sha', verdict((i, s, n) => L.claimKey(i, SHA, n))],
  ['wrong issue', verdict((i, s, n) => L.claimKey(1, s, n))],
  ['never held', verdict(L.claimKey, () => false)],
  ['no lock in go', verdict(L.claimKey, L.heldByComment, GO.replace('claimKey(issue.number', 'x('))],
];
const base = verdict(L.claimKey);
let caught = 0;
for (const [n, b] of BREAKS) { if (b.length) caught++; else base.push(`break "${n}" not caught`); }
if (base.length) { console.log('FAIL', base.join('; ')); process.exit(1); }
console.log(`claimlockcheck ok - ${caught} breaks caught`);
