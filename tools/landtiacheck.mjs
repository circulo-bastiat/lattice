#!/usr/bin/env node
// landtiacheck.mjs (#10527) — the hosted lander selects tests with tia.mjs, which reads $MCLITE_DATA/tia-map.json. A fresh hosted checkout has no map,
// so land.yml must restore the full-state branch (read-only: never `save`) and export MCLITE_DATA before the land step. Without it every PR is core-only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (p) => readFileSync(ROOT + p, 'utf8');

/** problems with a land.yml text, given whether the lander (land.mjs) uses tia select */
export function problems(yml, usesTia) {
  if (!usesTia) return [];
  const out = [], lines = yml.split('\n').filter((l) => !/^\s*#/.test(l));
  const t = lines.join('\n');
  if (!/state-sync\.sh\s+restore\s+full-state/.test(t)) out.push('land.yml has no state-sync restore of full-state');
  if (/state-sync\.sh\s+save/.test(t)) out.push('land.yml saves state: the lander must stay read-only');
  if (!/MCLITE_DATA=/.test(t)) out.push('land.yml does not export MCLITE_DATA');
  const r = t.search(/state-sync\.sh\s+restore/), l = t.search(/infra\/land\.mjs/);
  if (r >= 0 && l >= 0 && r > l) out.push('restore comes after the land step');
  return out;
}

let fails = 0, breaks = 0;
const yml = rd('tools/infra/mirror/land.yml'), usesTia = /tia\.mjs/.test(rd('tools/infra/land.mjs'));
if (!usesTia) { fails++; console.log('   x land.mjs no longer uses tia.mjs: retire this check'); }
for (const p of problems(yml, usesTia)) { fails++; console.log(`   x ${p}`); }
// anti-vacuity: each defect must be caught
const mut = [['restore removed', yml.replace(/state-sync\.sh restore full-state/, 'true')], ['MCLITE_DATA removed', yml.replace(/MCLITE_DATA=/, 'X=')],
  ['save added', yml + '\n          bash work/tools/infra/mirror/state-sync.sh save full-state fs\n']];
for (const [n, y] of mut) if (problems(y, true).length) { breaks++; console.log(`   ✓ ${n}: caught`); } else { fails++; console.log(`   x ${n}: not caught`); }
console.log(`landtiacheck: ${breaks + 1} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
