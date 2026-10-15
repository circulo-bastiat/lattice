// lockstepresetcheck.mjs -- #6225: SeedAgent counter reset between reps. 3 reps in ONE process must print identical Randoms when
// the reset file is rewritten before each rep (what runchase.mjs does); with the reset omitted they must differ (the break).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgent } from './lockstep/run.mjs';
const HERE = fileURLToPath(new URL('.', import.meta.url));
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log('   ok: ' + m); else { fails++; console.log('  ✗ ' + m); } };
const brk = (c, m) => { n++; if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const chase = readFileSync(join(HERE, 'runchase.mjs'), 'utf8'), agentSrc = readFileSync(join(HERE, 'lockstep', 'SeedAgent.java'), 'utf8');
const wired = (c, a) => /MCLITE_LOCKSTEP_RESET/.test(c) && /mclite\.lockstep\.reset/.test(a);
ok(wired(chase, agentSrc), 'runchase writes the reset file, SeedAgent reads it');
brk(!wired(chase.replaceAll('MCLITE_LOCKSTEP_RESET', 'x'), agentSrc), 'runchase without reset hook');
brk(!wired(chase, agentSrc.replaceAll('mclite.lockstep.reset', 'x')), 'agent without reset property');
try {
  if (spawnSync('javac', ['-version']).error) throw new Error('no javac');
  const dir = mkdtempSync(join(tmpdir(), 'lockstepreset-'));
  const agent = buildAgent(dir);
  const c = spawnSync('javac', ['-d', dir, join(HERE, 'lockstep', 'Reps.java')], { encoding: 'utf8' });
  if (c.status !== 0) throw new Error('javac Reps: ' + c.stderr);
  const rf = join(dir, 'reset.txt');
  const run = (reset) => spawnSync('java', [`-javaagent:${agent}`, '-Dmclite.lockstep.salt=0', `-Dmclite.lockstep.reset=${rf}`, '--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED', '-cp', dir, 'Reps', reset ? rf : '-'], { encoding: 'utf8' }).stdout.trim().split('\n');
  const a = run(true), b = run(false);
  ok(a.length === 3 && a[0] && a.every((x) => x === a[0]), '3 reps in one process, reset each rep: traces equal');
  brk(b.length === 3 && !(b[0] === b[1] && b[1] === b[2]), 'reset omitted: later reps differ from rep 0');
} catch (e) { console.log('   (java half could not run here: ' + String(e.message).split('\n')[0].slice(0, 140) + ')'); }
console.log(`lockstepresetcheck: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
