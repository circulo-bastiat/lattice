#!/usr/bin/env node
// slotqueuecheck.mjs - #7506: takeServerSlot hands slots out FIFO (random polling starved lockstep pilots to ~1 salt per call).
// ANTI-VACUITY: each break mutates server.mjs's source and must be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
const SRC = readFileSync(new URL('./referee/server.mjs', import.meta.url), 'utf8');
const TEST = `const {takeServerSlot}=await import(process.argv[2]);
const order=[]; const r0=await takeServerSlot();
const ps=[]; for(let i=0;i<4;i++){if(i===3)process.env.MCLITE_SLOT_SINCE='1';ps.push(takeServerSlot(20000).then(r=>{order.push(i);setTimeout(r,150);}));delete process.env.MCLITE_SLOT_SINCE;await new Promise(r=>setTimeout(r,40));}
r0(); await Promise.all(ps); console.log(order.join(','));`;
function run(src) {
  const d = mkdtempSync(join(tmpdir(), 'slotq-')); mkdirSync(join(d, 'tmp'));
  const m = fileURLToPath(new URL('./referee/.slotq-' + process.pid + '.mjs', import.meta.url)); writeFileSync(m, src); writeFileSync(join(d, 't.mjs'), TEST);   // beside the real one: it resolves things relative to itself writeFileSync(join(d, 't.mjs'), TEST);
  const r = spawnSync(process.execPath, [join(d, 't.mjs'), m], { env: { ...process.env, TMPDIR: join(d, 'tmp'), MCLITE_REFEREE_SLOTS: '1' }, encoding: 'utf8' });
  rmSync(m, { force: true }); if (r.status) console.error(r.stderr.slice(0, 600));
  return r.stdout.trim();
}
const good = run(SRC);
if (good !== '3,0,1,2') { console.error('slotqueuecheck FAIL: waiters were served in order "' + good + '", expected 3,0,1,2'); process.exit(1); }
const breaks = [
  ['rank ignored', SRC.replace('rank < free.length ? free : []', 'free')],
  ['newest first', SRC.replace('readdirSync(qdir).sort()', 'readdirSync(qdir).sort().reverse()')],
];
let caught = 0;
for (const [n, s] of breaks) { if (s === SRC) { console.error('slotqueuecheck: break "' + n + '" did not apply'); process.exit(1); } if (run(s) !== '3,0,1,2') caught++; else console.error('slotqueuecheck: break "' + n + '" NOT caught'); }
if (caught !== breaks.length) process.exit(1);
console.log(`slotqueuecheck: 4 waiters FIFO, ${caught} breaks caught`);
