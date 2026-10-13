import { loadEngine } from './loadsrc.mjs';
// #1028 — BowAttackGoal post-shot cooldown: illusioner passes a fixed 20 (no updateAttackType override);
// skeleton keeps bowInterval() (HARD 20 / else 40).
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js'] });
const Ai = M.Ai;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function gaps(diff, fixed) {
  M.Diff = { get: () => diff };
  const e = { x: 0, y: 8, z: 0, yaw: 0, target: { x: 0, y: 8, z: 10, height: 1.8 } };
  const shots = [];
  const g = new Ai.BowAttackGoal(e, 0.5, () => shots.push(t), () => 0.5, () => true, fixed);
  let t = 0;
  g.start();
  for (t = 0; t < 400; t++) g.tick();
  return shots.map((s, i) => i ? s - shots[i - 1] : null).slice(2);
}
const same = (a) => a.length >= 3 && a.every((v) => v === a[0]);
const ill = ['easy', 'normal', 'hard'].map((d) => gaps(d, 20));
ok(ill.every(same), 'illusioner gaps constant: ' + JSON.stringify(ill));
ok(ill[0][0] === ill[2][0] && ill[1][0] === ill[2][0], 'illusioner interval identical on easy/normal/hard');
ok(ill[0][0] <= 41, 'illusioner cycle is ~40 ticks, got ' + ill[0][0]);
const sk = gaps('normal', undefined), skh = gaps('hard', undefined);
ok(sk[0] > skh[0], 'skeleton keeps difficulty-scaled interval');
// anti-vacuity: break the data, the check must notice
breaks++; { const b = gaps('normal', 40)[0]; if (b !== ill[2][0]) console.log('   ✓ break (fixed 40) caught: gap ' + b + ' != ' + ill[2][0]); else fails.push('anti-vacuity: fixed 40 not caught'); }
console.log('');
console.log('================ bowintervalcheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
