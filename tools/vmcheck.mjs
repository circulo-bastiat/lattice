#!/usr/bin/env node
// vmcheck.mjs — is the VM lane reachable, and what is it good for? (D-368)
//
//   node tools/vmcheck.mjs             report the live state of the VM lane
//   node tools/vmcheck.mjs --selftest  grade the reasoning only (this is the suite stage)
//
// ⚠ SAME SHAPE AS `bridgecheck`, AND FOR THE SAME REASON (D-363): Dan's VM being switched off
// is not a defect in MC-Lite, so the suite stage grades the LOGIC and never his machine.
//
// ── WHAT THE VM LANE IS ─────────────────────────────────────────────────────
// A Hyper-V host bridge at `C:\Users\user\Downloads\tentativevirtualmachine`, with two guests
// (`linux` = claude-sandbox, `windows` = claude-windows). Jobs go in as JSON files; there is no
// time limit. ⚠ **It restarts itself at logon** — which is why it survived the 8 September
// Windows update that left the ai-jobs runner dead for a week, and that difference is the whole
// argument for using it (KW-6).
//
// ▶ WHAT IT IS GOOD FOR HERE, in order:
//   1. **The browser stages.** They are the only checks that look at the picture and they SKIP
//      where there is no Chromium (KW-3). `guest/agent/install-playwright.sh` and
//      `guest/agent/htmlsmoke.mjs` are already written in that folder and have never been wired
//      to this project. ⚠ Run them at `MCLITE_PRESET=medium` or you measure a machine Dan does
//      not play on (KW-4, D-196).
//   2. **The low-end target, on a dial.** `manage.cmd cores 2` / `ram 4096` makes a 2200G-class
//      box on demand. The 2200G is the real target and today it is argued rather than measured.
//   3. **A lane that survives a reboot**, for anything long.
//
// ⚠⚠ WHAT IT CANNOT DO, SAID FIRST SO IT IS NEVER MISREAD: **there is no GPU in the guest.**
// Passthrough was tried and reverted on 9 Sept 2026 — the log says "back to the plain synthetic
// display". So the VM measures the **software-rendering floor**, which is a useful floor for
// this project and is **not** a test of the black-WebGPU bug (KW-1). That needs real hardware.
// ⚠ And a graphics measurement taken over SSH is wrong whatever the hardware: session 0 has no
// desktop and always reports software rendering. The VM folder's agent note has the procedure.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.MCLITE_VM_ROOT,
  process.env.HOME ? join(process.env.HOME, 'mnt', 'tentativevirtualmachine') : null,
  'C:/Users/user/Downloads/tentativevirtualmachine',
].filter(Boolean);

export function findVm(exists = existsSync) {
  for (const c of CANDIDATES) if (exists(join(c, 'exchange', 'inbox'))) return c;
  return null;
}

/** The bridge heartbeat is a file with a `ts`. Same rule as the ai-jobs one: age decides. */
export function bridgeAge(status, now = Date.now()) {
  if (!status || !status.ts) return null;
  const t = Date.parse(status.ts);
  return Number.isFinite(t) ? (now - t) / 1000 : null;
}
export function verdict(ageS) {
  if (ageS === null) return 'unreadable';
  if (ageS < 300) return 'alive';
  if (ageS < 86400) return 'stale';
  return 'down';
}

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

{
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };
  console.log('anti-vacuity: break it, and it must be caught');
  brk('a day-old heartbeat reported as alive', () => { if (verdict(90000) === 'down') throw 0; });
  brk('a fresh heartbeat reported as down', () => { if (verdict(4) === 'alive') throw 0; });
  brk('a missing heartbeat answered with a guess', () => { if (verdict(bridgeAge(null)) === 'unreadable') throw 0; });
  brk('an unparseable timestamp counted as fresh', () => { if (bridgeAge({ ts: 'not a date' }) === null) throw 0; });
  brk('the VM found where there is no exchange folder', () => { if (findVm(() => false) === null) throw 0; });
  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

const selftestOnly = process.argv.includes('--selftest');
let line = 'not looked at (--selftest)';
if (!selftestOnly) {
  const root = findVm();
  if (!root) line = '⛔ VM folder not found. Looked in: ' + CANDIDATES.join(', ');
  else {
    let st = null;
    try { st = JSON.parse(readFileSync(join(root, 'exchange', 'status', 'bridge.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { /* absent */ }
    const age = bridgeAge(st);
    const v = verdict(age);
    const guests = (st?.machines || []).map((m) => `${m.key}:${m.state}`).join('  ') || '(none reported)';
    line = `${{ alive: '⭐ bridge ALIVE', stale: '⚠ bridge STALE', down: '⛔ bridge DOWN', unreadable: '⚠ bridge UNREADABLE' }[v]}` +
           (age === null ? '' : ` (${age.toFixed(0)}s old)`) + `  ·  guests: ${guests}`;
    console.log('');
    console.log(' vm root ............ ' + root);
    if (v === 'alive' && (st?.machines || []).every((m) => m.state === 'Off')) {
      console.log(' ⚠ the bridge is up and BOTH GUESTS ARE OFF — a job will queue and wait. Start one first:');
      console.log("   bash bin/vmjob host 'start'   (from the VM folder)");
    }
  }
}

console.log('');
console.log('================ vmcheck =================');
console.log(' lane ............... ' + line);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
