#!/usr/bin/env node
// lockstepgoldenapplefeedcheck -- #9439 (part of #9265): the SeedAgent feed hook (LANE:goldenapple, -Dmclite.lockstep.feed=<tick>) on the REAL 1.18.2 server.
// A NoAI Weakness zombie villager is summoned; at its entity tick FEED a fake ServerPlayerEntity holding a golden apple calls the real MobEntity.interactMob.
// The ENTX row of that tick must show the cure timer (3600..6000) and Weakness replaced by Strength; without the hook the same run must show neither.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgent } from './referee/lockstep/run.mjs';
import { parseEntxLog } from './referee/lockstep/trace.mjs';
import { startServer } from './referee/server.mjs';
import { connectRcon } from './referee/rcon.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FEED = 10, WEAKNESS = 18, STRENGTH = 5;
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) { breaks++; console.log("✓ caught: " + m); } else { bad++; console.log('NOT CAUGHT ' + m); } };

async function run(agent, feed) {
  const dir = mkdtempSync(join(tmpdir(), 'goldenfeed-')), log = join(dir, 'entx.txt');
  const jvm = [`-javaagent:${agent}`, '--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED', `-Dmclite.lockstep.entxlog=${log}`, ...(feed ? [`-Dmclite.lockstep.feed=${FEED}`] : [])];
  const server = await startServer({ workDir: join(dir, 'srv'), port: 25671, rconPort: 26671, xmx: '1536M', jvmArgs: jvm });
  let rcon;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'forceload add 0 0']) await rcon.command(c);
    await rcon.command(`summon minecraft:zombie_villager 8.5 -60 8.5 {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,ActiveEffects:[{Id:${WEAKNESS}b,Amplifier:0b,Duration:1000000}]}`);
    await sleep(3000);
  } finally { if (rcon) rcon.close(); await server.stop(); }
  const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
  rmSync(dir, { recursive: true, force: true });
  return text;
}
// the rule: FEED line says success, row FEED has cure timer 3600..6000 and Strength without Weakness; the row before has neither
function judge(text) {
  const rows = parseEntxLog(text), zv = (t) => (rows[t] || []).find((r) => r[0] === 'zombie_villager');
  const fed = /^FEED \d+ \d+ \S*SUCCESS/m.test(text), a = zv(FEED), b = zv(FEED - 1), c = zv(FEED + 5);
  if (!a || !b || !c) return { pass: false, why: 'missing rows' };
  const fx = (r) => r[3].map((f) => f[0]);
  const pass = fed && a[2] >= 3600 && a[2] <= 6000 && c[2] === a[2] - 5 && fx(a).includes(STRENGTH) && !fx(a).includes(WEAKNESS) && b[2] === -1 && fx(b).includes(WEAKNESS);
  return { pass, why: `fed=${fed} conv=${a[2]} fx=${fx(a)} before=${b[2]}/${fx(b)}` };
}
const agent = buildAgent(mkdtempSync(join(tmpdir(), 'goldenagent-')));
const text = await run(agent, true);
const j = judge(text);
console.log('feed run: ' + j.why);
ok(j.pass, 'feed run: ' + j.why);
// breaks: the same rule must reject each doctored log
const doc = (f) => judge(text.split('\n').map(f).filter((l) => l !== null).join('\n')).pass;
caught(!doc((l) => (l.startsWith('FEED ') ? null : l)), 'no FEED line');
caught(!doc((l) => l.replace(/^(ENTX \d+ zombie_villager \d+) -?\d+ /, '$1 -1 ')), 'no cure timer');
caught(!doc((l) => l.replace(/\b5:\d+:\d+,?/g, '').replace(/ $/, ' -')), 'no Strength');
const none = judge(await run(agent, false));
console.log('no-hook run: ' + none.why);
caught(!none.pass, 'hook disabled (same server, no -Dmclite.lockstep.feed)');
console.log(`goldenapple-feed: ${5} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad || breaks !== 4 ? 1 : 0);
