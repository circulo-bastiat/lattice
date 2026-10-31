#!/usr/bin/env node
// tools/asyncguardcheck.mjs — item 8(c) ruling guard (D-453).
//
// The "Async" mod's approach — parallelising the LIVE-world tick (entities, random block ticks,
// spawning) across threads — is ruled OUT for MC-Lite. Two independent reasons, both standing:
//   1. It needs shared mutable memory across threads. The only browser primitive for that is
//      SharedArrayBuffer, which requires cross-origin isolation (COOP/COEP headers) and is
//      therefore unavailable to a double-clicked file:// single file (Hard constraint 2). The
//      file:// / service-worker / WebAssembly.Memory back-doors are all closed as of 2026.
//   2. It breaks in-tick determinism — entities and blocks that interact in one fixed order in
//      vanilla become a race — which the charter forbids for everything that isn't worldgen/render.
// The controlled experiment tools/_asyncspawnexp.mjs also MEASURED the one sliver that could have
// fit the pure-function pattern (offloading a read-only spawn scan): it frees main-thread time on
// a HEAVY scan, but MC-Lite's actual spawn is a ~0.1ms random SAMPLE, so an offload would cost
// ~5.7ms to replace it — a ~57x net loss. So: nothing to build; keep the approach out.
//
// This guard fails if a future session quietly wires an off-thread/worker path into any live-world
// tick driver, so the ruling cannot rot silently. The chunk-GEN pool (src/09_jobs.js + the worker)
// is the ALLOWED deterministic pure-function offload (D-14) and is deliberately NOT guarded here.

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };

// The live-world tick/spawn drivers — where the Async approach would insert a thread.
const GUARDED = ['src/07l_spawn.js', 'src/07_world.js', 'src/07i_entitylist.js', 'src/07b_behaviour.js', 'src/17_main.js'];
// The off-thread constructs the ruling forbids in those files.
const FORBID = /new\s+Worker\s*\(|\.postMessage\s*\(/;

console.log('asyncguardcheck — item 8(c): the Async live-world-parallelism approach stays OUT (D-453)');

// §1 — the ruling holds in the real source
let anyMissing = false;
for (const f of GUARDED) {
  let src;
  try { src = readFileSync(resolve(ROOT, f), 'utf8'); }
  catch { anyMissing = true; ok(false, 'read ' + f); continue; }
  ok(!FORBID.test(src), f + ': no off-thread/worker construct in a live-world tick driver');
}
ok(!anyMissing, 'all guarded tick-driver files exist (a renamed/removed one must re-home this guard)');

// §2 — the chunk-GEN pool is STILL allowed to offload; the guard must not have banned D-14 too
const jobs = readFileSync(resolve(ROOT, 'src/09_jobs.js'), 'utf8');
ok(/new\s+Worker\s*\(/.test(jobs) || /WORKER_SRC/.test(jobs),
   'src/09_jobs.js still owns the allowed gen-pool offload (D-14 not collateral-damaged)');

// §3 — anti-vacuity, BOTH directions (rule 6)
const clean = readFileSync(resolve(ROOT, 'src/07l_spawn.js'), 'utf8');
okAv(!FORBID.test(clean), 'clean spawn source passes the guard');                              // must-pass
const tampered = clean.replace('Spawn.attempt = function', 'var _w = new Worker(u); Spawn.attempt = function');
okAv(tampered !== clean && FORBID.test(tampered), 'a worker wired into the spawn path is CAUGHT by the guard'); // must-fail

console.log('');
if (fails.length) { console.log('FAIL  asyncguardcheck: ' + fails.length + ' — ' + fails.join(' | ')); process.exit(1); }
console.log('ok    asyncguardcheck: ' + pass + ' assertions, ' + breaks + ' anti-vacuity breaks'); process.exit(0);
