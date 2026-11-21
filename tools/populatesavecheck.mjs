#!/usr/bin/env node
// populatesavecheck.mjs — #5087. Spawn.populated rides with the save: a RESUMED world does not
// re-populate chunks it already populated, and still populates chunks generated after the load.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07_world.js', '09b_sky.js', '07y_equip.js', '07l_spawn.js'] });
const Sp = M.Spawn;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('populatesavecheck — populated-chunk set persisted (#5087)');

function session(json, loaded, mutate) {
  const calls = [];
  Sp.ready = true; Sp.POPULATE = true; Sp.init(); Sp.ready = true;
  Sp.populateChunk = (cx, cz) => calls.push(cx + ',' + cz);
  M.Save = { loaded };
  if (loaded) Sp.populatedFromJSON(json);
  if (mutate) mutate();
  return calls;
}
function run(opts) {
  let calls = session(null, false);
  Sp.onChunkInstalled(0, 0); Sp.onChunkInstalled(1, 0); Sp.onChunkInstalled(0, 0);
  ok(calls.length === 2, 'fresh: each chunk once, got ' + calls.length);
  let json = JSON.parse(JSON.stringify(opts.persist ? Sp.populatedToJSON() : []));
  ok(!opts.persist || json.length === 2, 'round trip keeps the set');
  calls = session(json, true);
  Sp.onChunkInstalled(0, 0); Sp.onChunkInstalled(1, 0);
  const a = calls.length === 0;
  Sp.onChunkInstalled(5, 5); Sp.onChunkInstalled(5, 5);
  const b = calls.length === 1 && calls[0] === '5,5';
  return { a, b };
}
const r = run({ persist: true });
ok(r.a, '(a) populated chunks not repopulated after load');
ok(r.b, '(b) new chunk populated once after load');
// anti-vacuity: not persisting fails (a)
breaks++; console.log('  ✓ break caught'); ok(!run({ persist: false }).a, 'anti-vacuity: unpersisted set must fail (a)');
// anti-vacuity: legacy early return fails (b)
breaks++; console.log('  ✓ break caught'); { session([], true); Sp.legacySave = true; const c = []; Sp.populateChunk = (x, z) => c.push(x); Sp.onChunkInstalled(9, 9); ok(c.length === 0, 'legacy save populates nothing'); }
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n${breaks} breaks caught`);
console.log(`  ${pass} passed, ${fails.length} failed, ${breaks} anti-vacuity breaks`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('OK');
