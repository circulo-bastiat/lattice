#!/usr/bin/env node
// lockstep-idlewander -- #7030: idle trio (WanderAroundFarGoal / LookAroundGoal / LookAtEntityGoal) of cow, pig, sheep, chicken,
// villager alone in a flat 40x40 arena, then with a player 6 blocks away, 1200 ticks, 20 salts. Every random draw of a tick is
// recorded; a goal may only START on a tick where a draw below its chance was made (LookAround 0.02, LookAtEntity 0.02), LookAtEntity only
// starts with the player inside range 6 (run lengths are not asserted: higher-priority MOVE goals preempt LookAround legitimately).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const la = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/ai/goal/LookAroundGoal.java'), 'utf8');
if (!/nextFloat\(\) < 0\.02F/.test(la) || !/20 \+ .*nextInt\(20\)/.test(la)) throw new Error('LookAroundGoal decomp changed');
const MOBS = ['cow', 'pig', 'sheep', 'chicken', 'villager'], TICKS = 1200, PY = 20;

function runAll(patch, salt) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07w_passive.js', '07zv_villagerbrain.js', '07l_spawn.js', '14c_raycast.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
  const W = M.World, EL = M.EntityList, stone = M.States.stateOf('stone');
  const bad = [], st = { look: 0, at: 0 };
  for (const mob of MOBS) for (const withPlayer of [false, true]) {
    W.init(1);
    for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
    for (let x = -20; x < 20; x++) for (let z = -20; z < 20; z++) W.setBlock(x, PY - 1, z, stone);
    const base = stream(salt * 131 + MOBS.indexOf(mob) * 7 + (withPlayer ? 1 : 0));
    let draws = [];
    EL.clear(); EL.random = () => { const v = base(); draws.push(v); return v; };
    M.Player = withPlayer ? { x: 6.5, y: PY, z: 0.5, health: 20, gamemode: 'survival', survival: true } : null;
    const e = EL.spawn(mob, 0.5, PY, 0.5);
    if (!e || !e.ai) { bad.push(mob + ' has no goals'); continue; }
    let la0 = -1, at0 = -1;
    for (let k = 0; k < TICKS; k++) {
      draws = [];
      EL.tickMob(e);
      const names = M.Ai.runningGoals(e).map((g) => g[1]);
      const tag = `${mob}${withPlayer ? '+player' : ''} salt=${salt} tick=${k}`;
      const lk = names.includes('RandomLookAroundGoal') || names.includes('LookAroundGoal'), at = names.includes('LookAtPlayerGoal') || names.includes('LookAtEntityGoal');
      if (lk && la0 < 0) { la0 = k; st.look++; if (!draws.some((v) => v < 0.02)) bad.push(tag + ': LookAround started without a roll below 0.02'); }
      if (!lk) la0 = -1;
      if (at && at0 < 0) { at0 = k; st.at++; if (!draws.some((v) => v < 0.02)) bad.push(tag + ': LookAtEntity started without a roll below 0.02'); if (!withPlayer) bad.push(tag + ': LookAtEntity with nobody in range'); }
      if (!at) at0 = -1;
    }
  }
  return { bad, st };
}

let fails = 0, breaks = 0, looks = 0;
for (let s = 0; s < 20; s++) { const r = runAll(null, s); looks += r.st.look; if (r.bad.length) { fails++; console.log('  FAIL salt ' + s + ': ' + r.bad.slice(0, 3).join(' | ')); } }
if (!looks) { fails++; console.log('  FAIL vacuous: no LookAround ever ran'); }
const mut = (name, file, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== file) return src; const o = src.replace(f, to); hit = o !== src; return o; };
  let caught = false;
  for (let s = 0; s < 3 && !caught; s++) caught = runAll(patch, s).bad.length > 0;
  if (!hit) { fails++; console.log('  FAIL mutation did not apply: ' + name); } else if (caught) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('look-around chance 0.02 -> 0.03', '07k_goals.js', 'rand()) < 0.02; };   // random.nextFloat', 'rand()) < 0.03; };   // random.nextFloat');
mut('look-at chance 0.02 -> 0.03', '07k_goals.js', "(chance === undefined) ? 0.02 :", "(chance === undefined) ? 0.03 :");
console.log(`lockstep-idlewander: ${20 + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${looks} LookAround runs over 20 salts)`);
process.exit(fails ? 1 : 0);
