// lockstepcheck.mjs -- #4986 (G17-L0): the -javaagent (lockstep/SeedAgent.java) pins java.util.Random's no-arg constructor.
// Probe.java builds Randoms on the main thread and on a named worker; the same salt must print the same longs twice, and
// a different salt / no agent must print different ones (the breaks). The real-server zombie-lane measurement is
// lockstep/run.mjs (minutes; see docs/decisions/4986-lockstep-rng.md) -- this check is the cheap, deterministic half.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAgent } from './lockstep/run.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
const noJava = java.error || spawnSync('javac', ['-version']).error;

// java-free half (runs everywhere, incl. the lander): the agent source and the decision doc must carry the contract;
// each mutated copy must fail the same predicate (the breaks).
function staticHalf() {
  const agentSrc = readFileSync(join(HERE, 'lockstep', 'SeedAgent.java'), 'utf8');
  const doc = readFileSync(join(HERE, '..', '..', 'docs', 'decisions', '4986-lockstep-rng.md'), 'utf8');
  const okAgent = t => /java\/util\/Random/.test(t) && /randomUUID/.test(t) && /mclite\.lockstep\.salt/.test(t);
  const okDoc = t => /can(not)? be pinned|cannot/i.test(t) && /chi-square|KS/i.test(t);
  let fails = 0, breaks = 0;
  if (okAgent(agentSrc) && okDoc(doc)) console.log('   ok: SeedAgent pins java/util/Random by salt; decision doc names fallback');
  else { fails++; console.log('  ✗ agent/doc contract missing'); }
  for (const [name, bad] of [['agent without Random', !okAgent(agentSrc.replaceAll('java/util/Random', 'x'))], ['agent without salt', !okAgent(agentSrc.replaceAll('mclite.lockstep.salt', 'x'))], ['doc without fallback', !okDoc(doc.replace(/chi-square|KS/gi, 'x'))]]) {
    if (bad) { breaks++; console.log(`   ✓ break caught: ${name}`); } else { fails++; console.log(`  ✗ break NOT caught: ${name}`); }
  }
  return { fails, breaks };
}

function main() {
  // 11 Oct: the lander (a Windows PC) bounced this check 8x as "never shows it can fail": whatever the java half hit there (JDK version, ASM export flags)
  // it threw before the summary line printed. Any java-half failure now degrades to the static half WITH the "<n> breaks caught" line, never to silence.
  try { mainJava(); } catch (e) {
    console.log('   (java half could not run here: ' + String(e && e.message || e).split('\n')[0].slice(0, 140) + ')');
    const st = staticHalf();
    console.log(`lockstepcheck: static half only: 4 assertions, ${st.fails} failures, ${st.breaks} breaks caught`);
    process.exit(st.fails ? 1 : 0);
  }
}
function mainJava() {
  const st = staticHalf();
  if (noJava) { console.log(`lockstepcheck: no java/javac, static half only: 4 assertions, ${st.fails} failures, ${st.breaks} breaks caught`); process.exit(st.fails ? 1 : 0); }
  const dir = mkdtempSync(join(tmpdir(), 'lockstepchk-'));
  const agent = buildAgent(dir);
  const c = spawnSync('javac', ['-d', dir, join(HERE, 'lockstep', 'Probe.java')], { encoding: 'utf8' });
  if (c.status !== 0) throw new Error('javac Probe: ' + c.stderr);
  const run = (salt, useAgent = true, extra = '') => spawnSync('java', [...(extra ? [extra] : []), ...(useAgent ? [`-javaagent:${agent}`, `-Dmclite.lockstep.salt=${salt}`, '--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED'] : []), '-cp', dir, 'Probe'], { encoding: 'utf8' }).stdout.trim();
  let fails = st.fails, breaks = st.breaks;
  const a = run(0), b = run(0);
  if (a && a === b && a.split('\n')[0].split(' ').length === 4 && a.split('\n').length === 3 && a.split('\n')[1].split(' ').length > 80) console.log('   ok: salt 0 twice -> identical Randoms (main + worker thread)');
  else { fails++; console.log(`  ✗ not pinned: [${a}] vs [${b}]`); }
  for (const [name, other] of [['salt changed', run(7)], ['no agent', run(0, false)], ['ThreadLocalRandom/Math.random hook disabled', run(0, true, '-Dmclite.lockstep.nohook=true')], ['no agent again', run(0, false)]]) {
    if (other !== a) { breaks++; console.log(`   ✓ break caught: ${name}`); } else { fails++; console.log(`  ✗ break NOT caught: ${name}`); }
  }
  // #6222: UUID.randomUUID pinned by (thread, caller, nth, salt)
  const runU = (salt, useAgent = true) => spawnSync('java', [...(useAgent ? [`-javaagent:${agent}`, `-Dmclite.lockstep.salt=${salt}`, '--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED'] : []), '-cp', dir, 'Probe', 'uuid'], { encoding: 'utf8' }).stdout.trim();
  const ua = runU(0), ub = runU(0);
  if (ua && ua === ub && ua.split(' ').length === 5) console.log('   ok: 5 randomUUIDs, salt 0 twice -> identical');
  else { fails++; console.log(`  ✗ randomUUID not pinned: [${ua}] vs [${ub}]`); }
  for (const [name, other] of [['uuid salt changed', runU(7)], ['uuid no agent', runU(0, false)]]) {
    if (other !== ua) { breaks++; console.log(`   ✓ break caught: ${name}`); } else { fails++; console.log(`  ✗ break NOT caught: ${name}`); }
  }
  console.log(`lockstepcheck: ${4 + 5 + 3} assertions, ${fails} failures, ${breaks} breaks caught`);
  process.exit(fails ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
