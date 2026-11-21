#!/usr/bin/env node
// patrolcountcheck.mjs — #5055: PatrolSpawner member count is ceil(Eq.localDifficulty)+1 from the
// REGIONAL value at the spawn column (PatrolSpawner.java:60-66), not the global-difficulty table.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
const SRC = { eq: read('07y_equip.js'), ps: read('07x_patrol.js') };

// Load both modules into a fresh namespace with a stub world: one loaded chunk (0,0) with `inh` ticks.
function load(src, time, inh) {
  const NS = { Sky: { dayTime: time }, Diff: { get: () => 'normal' } };
  NS.World = { loadedAt: () => true, key: (a, b) => a + ',' + b, chunks: new Map() };
  new Function('MCL', src.eq)(NS);
  new Function('MCL', src.ps)(NS);
  NS.Equip.inhabited.set('0,0', inh);
  return NS;
}
const count = (src, diff, time, inh) => { const NS = load(src, time, inh); return NS.Patrol.memberCount(NS, 0, 0, diff); };
const FULL = 0, NEW = 4 * 24000;   // moon phase 0 is the full moon, 4 the new moon
const HI = 3600000;

// Returns the list of failed expectations for a given (possibly broken) source set.
function verify(src) {
  const bad = [];
  const want = (name, got, exp) => { if (got !== exp) bad.push(`${name}: got ${got}, want ${exp}`); };
  try {
    want('fresh hard', count(src, 'hard', NEW, 0), 4);
    want('fresh normal', count(src, 'normal', NEW, 0), 3);
    want('fresh easy', count(src, 'easy', NEW, 0), 2);
    want('peaceful', count(src, 'peaceful', FULL, HI), 0);
    want('hard, inhabited, full moon', count(src, 'hard', FULL, HI), 7);
    want('hard, inhabited, new moon', count(src, 'hard', NEW, HI), 7);
    want('hard, half inhabited', count(src, 'hard', NEW, HI / 2), 5);
    want('hard, inhabited high', count(src, 'hard', 0, HI) > count(src, 'hard', NEW, 0), true);
    // isRegionLoaded (PatrolSpawner.java:53): spawn column (px+MIN_DIST) with its +10 neighbour chunk unloaded refuses.
    const reach = (loaded) => {
      const NS = load(src, 10 * 24000, 0); let reached = false;
      NS.Sky.isDay = () => true; NS.Player = { x: 0, y: 64, z: 0 };
      NS.World.loadedAt = loaded;
      NS.Patrol.ready = true; NS.Patrol.state.cooldown = 0;
      NS.Patrol.memberCount = () => { reached = true; return 0; };
      const L0 = NS.EntityList; NS.EntityList = { random: () => 0 };
      try { NS.Patrol.tick(NS); } finally { NS.EntityList = L0; }
      return reached;
    };
    want('all loaded reaches count', reach(() => true), true);
    want('+10 neighbour chunk unloaded refuses', reach((x) => x >= -40), false);
    // doPatrolSpawning=false: no tick advances the timer, over 20 patrol periods.
    {
      const NS = load(src, 10 * 24000, 0);
      NS.Sky.isDay = () => true; NS.Player = { x: 0, y: 64, z: 0 };
      NS.Commands = { ruleGet: (r) => (r === 'doPatrolSpawning' ? false : true) };
      NS.Patrol.ready = true; NS.Patrol.state.cooldown = 5;
      let reached = 0; NS.Patrol.memberCount = () => { reached++; return 0; };
      for (let i = 0; i < 20 * 12000; i++) NS.Patrol.tick(NS);
      want('doPatrolSpawning=false leaves timer', NS.Patrol.state.cooldown, 5);
      want('doPatrolSpawning=false spawns none', reached, 0);
    }
  } catch (e) { bad.push('threw: ' + e.message); }
  return bad;
}

let pass = 0, breaks = 0; const fails = [];
const base = verify(SRC);
if (base.length) fails.push('real source: ' + base.join('; ')); else pass++;

const mut = (name, f, t) => {
  breaks++;
  const s = { ...SRC, ps: SRC.ps.replace(f, t) };
  if (s.ps === SRC.ps) { fails.push('mutation did not apply: ' + name); return; }
  if (verify(s).length) { pass++; console.log('   ✓ break caught: ' + name); } else fails.push('break not caught: ' + name);
};
mut('revert to table', 'return Math.ceil(ld) + 1;', "return { easy: 2, normal: 3, hard: 4 }[difficulty];");
mut('single-column region test', 'for (let qx = (cx - 10) >> 4; qx <= (cx + 10) >> 4; qx++)', 'for (let qx = cx >> 4; qx <= cx >> 4; qx++)');
mut('ignore doPatrolSpawning', "=== 'false') return 0;\n    var W", "=== 'zzz') return 0;\n    var W");
mut('drop the +1', 'return Math.ceil(ld) + 1;', 'return Math.ceil(ld);');
mut('global id instead of regional', 'return Math.ceil(ld) + 1;', 'return Math.ceil(NS2.Equip.DIFFICULTY_ID[difficulty]) + 1;');

for (const f of fails) console.log('   ✗ ' + f);
console.log(`${fails.length ? 'FAIL' : 'PASS'} patrolcountcheck: ${pass} assertions, ${breaks} breaks caught, ${fails.length} failure(s)`);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
