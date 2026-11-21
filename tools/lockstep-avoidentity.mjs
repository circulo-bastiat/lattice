#!/usr/bin/env node
// lockstep-avoidentity -- #7937 (G18b-L24): lockstep scenario avoidentity, 20 salts. AvoidEntityGoal for cat from player (untamed;
// CatFleeGoal 16, 0.8, 1.33), wolf from llama (AvoidLlamaGoal 24, 1.5, 1.5), rabbit from wolf and from player, with the threat
// 4, 8 and 12 blocks away. Reference = FleeEntityGoal (.decomp) evaluated every tick against live positions, parameters parsed
// out of each mob's own .decomp: the start gate (3D box + base max distance), the near (squared < 49) / far speed switch,
// and a TAMED cat / wolf never flees (CatFleeGoal.canStart/shouldContinue, AvoidLlamaGoal.canStart). Villager: vanilla
// has NO FleeEntityGoal (its fleeing is brain tasks), so none may run for it.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dec = (f) => readFileSync(join(ROOT, '.decomp/net/minecraft/entity', f), 'utf8');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

const flee = (src, re) => { const m = re.exec(src.replace(/\s+/g, ' ')); if (!m) throw new Error('no flee for ' + re); return { range: +m[1], slow: +m[2], fast: +m[3] }; };
const CT = flee(dec('passive/CatEntity.java'), /CatFleeGoal<>\(this, PlayerEntity\.class, ([\d.]+)F?, ([\d.]+), ([\d.]+)\)/);
const WF = flee(dec('passive/WolfEntity.java'), /AvoidLlamaGoal<>\(this, LlamaEntity\.class, ([\d.]+)F?, ([\d.]+), ([\d.]+)\)/);
const RB = flee(dec('passive/RabbitEntity.java'), /Flee(?:Entity)?Goal<>\(\s*this,\s*WolfEntity\.class,\s*([\d.]+)F?,\s*([\d.]+),\s*([\d.]+)/);
const RP = flee(dec('passive/RabbitEntity.java'), /Flee(?:Entity)?Goal<>\(\s*this,\s*PlayerEntity\.class,\s*([\d.]+)F?,\s*([\d.]+),\s*([\d.]+)/);
// [mob, threat, params, tamed]
const PAIRS = [['cat', 'player', CT, false], ['cat', 'player', null, true], ['wolf', 'llama', WF, false], ['wolf', 'llama', null, true],
  ['rabbit', 'wolf', RB, false], ['rabbit', 'player', RP, false], ['villager', 'zombie', null, false], ['villager', 'vindicator', null, false]];
const DIST = [4, 8, 12];
const TICKS = 50, PY = 20;
if (/FleeEntityGoal/.test(dec('passive/VillagerEntity.java'))) throw new Error('villager now has a FleeEntityGoal in the decomp');

function runAll(patch, salt) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07zb_creeper.js', '07n_tame.js', '07zv_villagerbrain.js', '07l_spawn.js', '14c_raycast.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
  const W = M.World, EL = M.EntityList, stone = M.States.stateOf('stone');
  const bad = [], starts = { n: 0 };
  for (const [mob, thr, P, tamed] of PAIRS) for (const d of DIST) {
    W.init(1);
    for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) W.setBlock(x, PY - 1, z, stone);
    EL.clear(); EL.random = stream(salt * 131 + d * 7);
    const y = PY;
    const e = EL.spawn(mob, -d / 2 + 0.5, y, 0.5);
    if (tamed) e.tamed = true;
    let t;
    if (thr === 'player') { t = { x: d / 2 + 0.5, y: PY, z: 0.5, health: 20, gamemode: 'survival', survival: true }; M.Player = t; }
    else { t = EL.spawn(thr, d / 2 + 0.5, PY, 0.5); t.ai = null; }
    if (!e || !t) { bad.push(mob + ' spawn failed'); continue; }
    if (!e.ai) { bad.push(mob + ' has no goals'); continue; }
    if (!P) { // tamed cat / wolf, villager: no flee goal may run on any tick
      for (let k = 0; k < TICKS; k++) { EL.tickMob(e); if (M.Ai.runningGoals(e).some((g) => g[1] === 'FleeEntityGoal')) { bad.push(`${mob}${tamed ? ' (tamed)' : ''}/${thr} d=${d} salt=${salt} tick=${k}: flee ran`); break; } }
      continue;
    }
    let prev = false, ran = false;
    for (let k = 0; k < TICKS; k++) {
      const dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z, dsq = dx * dx + dy * dy + dz * dz, maxD = Math.max(P.range, 2);
      const gate = Math.abs(dx) <= P.range && Math.abs(dz) <= P.range && Math.abs(dy) <= 3 && dsq <= maxD * maxD;
      e.moveMod = 0;
      EL.tickMob(e);
      const run = M.Ai.runningGoals(e).some((g) => g[1] === 'FleeEntityGoal');
      const tag = `${mob}/${thr} d=${d} salt=${salt} tick=${k}`;
      if (run && !prev && !gate) bad.push(tag + ': flee started outside the start gate');
      if (run) { ran = true; starts.n++; const want = dsq < 49 ? P.fast : P.slow; if (Math.abs(e.moveMod - want) > 1e-9) bad.push(`${tag}: speed ${e.moveMod} want ${want} (dsq ${dsq.toFixed(1)})`); }
      prev = run;
    }
  }
  return { bad, runs: starts.n };
}

let fails = 0, breaks = 0, runs = 0;
for (let s = 0; s < 20; s++) { const r = runAll(null, s); runs += r.runs; if (r.bad.length) { fails++; console.log('  FAIL salt ' + s + ': ' + r.bad.slice(0, 3).join(' | ')); } }
if (!runs) { fails++; console.log('  FAIL vacuous: no flee tick ever ran'); }
const mut = (name, file, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== file) return src; const o = src.replace(f, to); hit = o !== src; return o; };
  let caught = false;
  for (let s = 0; s < 3 && !caught; s++) caught = runAll(patch, s).bad.length > 0;
  if (!hit) { fails++; console.log('  FAIL mutation did not apply: ' + name); } else if (caught) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('near/far speed swapped', '07k_goals.js', 'nearThreat ? fastSpeed : speed', 'nearThreat ? speed : fastSpeed');
mut('near threshold 49 -> 25', '07k_goals.js', '< 49.0;', '< 25.0;');
mut('range gate ignored', '07k_goals.js', 'if (dsq > maxD * maxD) continue;', '');
console.log(`lockstep-avoidentity: ${20 + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${runs} flee ticks over 20 salts)`);
process.exit(fails ? 1 : 0);
