// tools/usagefreshcheck.mjs - #11253: usage() takes the source with the newest `at` (file / usage-data branch / MCLITE_USAGE), in every order. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { pickUsage } from './infra/usagepick.mjs';
const GO = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
const mk = (at) => JSON.stringify({ at, accounts: { pro: { ok: true } } });
const T = ['2026-11-06T08:18:00Z', '2026-11-07T20:00:00Z', '2026-11-08T02:27:00Z'];
const perms = (a) => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
const verdict = (pick, go) => {
  const bad = [], now = Date.parse('2026-11-08T03:00:00Z');
  const names = ['file', 'branch', 'variable'];
  for (const order of perms([0, 1, 2])) {   // order[i] = which time source i holds
    const r = pick(names.map((n, i) => [n, mk(T[order[i]])]), now);
    if (!r || r.source !== names[order.indexOf(2)]) bad.push('newest did not win for order ' + order);
  }
  let r = pick([['file', ''], ['branch', mk(T[0])], ['variable', mk(T[1])]], now);
  if (!r || r.source !== 'variable') bad.push('empty file must be skipped');
  r = pick([['file', '{"at":'], ['branch', mk(T[0])]], now); if (!r || r.source !== 'branch') bad.push('corrupt file must be skipped');
  r = pick([['file', mk(T[2])], ['branch', mk(T[1])]], now); if (!r || r.source !== 'file') bad.push('missing variable: newest file must win');
  r = pick([['file', mk(T[0])], ['variable', mk(T[1])]], now); if (!r || r.source !== 'variable' || r.ageMin !== 420) bad.push('age/source wrong when the file is stale');
  if (pick([], now) !== null || pick([['file', '']], now) !== null) bad.push('no usable source must give null');
  if (!/pickUsage\(src\)/.test(go)) bad.push('go.mjs usage() does not use pickUsage');
  if (!/MCLITE_USAGE/.test(go.slice(go.indexOf('export async function usage')))) bad.push('go.mjs usage() does not read the variable');
  return bad;
};
const fileFirst = (src, now) => { for (const [n, raw] of src) { try { const u = JSON.parse(raw); if (u && u.accounts) return { u, source: n, ageMin: 0 }; } catch {} } return null; };
const BREAKS = [
  ['file first', fileFirst, GO],
  ['oldest wins', (s, n) => pickUsage(s.map(([k, v]) => { try { return [k, { ...JSON.parse(v), at: new Date(-Date.parse(JSON.parse(v).at)).toISOString() }]; } catch { return [k, v]; } }), n), GO],
  ['go.mjs bypasses pick', pickUsage, GO.replace('pickUsage(src)', 'null')],
  ['variable not read', pickUsage, GO.replace(/MCLITE_USAGE/g, 'X_USAGE')],
];
const real = verdict(pickUsage, GO); let caught = 0;
for (const [name, p, go] of BREAKS) { if (verdict(p, go).length) { caught++; console.log('✓ caught: ' + name); } else real.push('break not caught: ' + name); }
console.log(real.length ? 'FAIL\n' + real.join('\n') : `usagefreshcheck: ok, 14 assertions, ${caught} breaks caught`);
process.exit(real.length ? 1 : 0);
