#!/usr/bin/env node
// dripleafcheck.mjs — #8684: BigDripleafBlock tilt machinery (07zv_dripleaf.js) against BigDripleafBlock.java.
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '07zv_dripleaf.js'] });
const W = M.World, CH = M.CH, S = M.States, D = M.Dripleaf;
M.Behave.init(W);
W.init(1);
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const LEAF = S.stateOf('big_dripleaf') | 0;
ok(LEAF > 0 && !!D && D.ready, 'big_dripleaf state and MCL.Dripleaf ready');

const sounds = [], sched = [];
M.Sound = { play: (n) => sounds.push(n) };
M.Behave.schedule = (x, y, z, d) => sched.push(d);
let power = false;
M.Redstone = { receivedPower: () => (power ? 15 : 0) };
const X = 4, Y = 70, Z = 4;
const fresh = () => { W.setBlock(X, Y - 1, Z, S.stateOf('clay')); W.setBlock(X, Y, Z, LEAF); sounds.length = 0; sched.length = 0; power = false; };
const tick = () => M.Dripleaf.scheduledTick(X, Y, Z);

fresh();
ok(D.tilt(X, Y, Z) === 'none', 'placed leaf is NONE');
ok(D.onEntityCollision(X, Y, Z, { onGround: false, y: Y + 1 }) === false && D.tilt(X, Y, Z) === 'none', 'airborne entity does nothing');
ok(D.onEntityCollision(X, Y, Z, { onGround: true, y: Y + 0.6 }) === false, 'entity below 0.6875 does nothing');
power = true;
ok(D.onEntityCollision(X, Y, Z, { onGround: true, y: Y + 1 }) === false, 'powered leaf ignores entity');
power = false;
D.onEntityCollision(X, Y, Z, { onGround: true, y: Y + 1 });
ok(D.tilt(X, Y, Z) === 'unstable' && sched.join() === '10' && sounds.length === 0, 'collision -> UNSTABLE, tick in 10, silent');
sched.length = 0;
tick(); ok(D.tilt(X, Y, Z) === 'partial' && sched.join() === '10' && sounds.join() === D.TILT_DOWN, 'UNSTABLE -> PARTIAL, 10, tilt_down');
sched.length = 0;
tick(); ok(D.tilt(X, Y, Z) === 'full' && sched.join() === '100', 'PARTIAL -> FULL, reset after 100');
sounds.length = 0;
tick(); ok(D.tilt(X, Y, Z) === 'none' && sounds.join() === D.TILT_UP, 'FULL -> NONE with tilt_up');

fresh(); D.changeTilt(X, Y, Z, 'partial', null); power = true; sounds.length = 0;
tick(); ok(D.tilt(X, Y, Z) === 'none' && sounds.join() === D.TILT_UP, 'powered tick resets');
fresh(); sounds.length = 0; power = true;
D.neighborUpdate(X, Y, Z); ok(sounds.length === 0, 'neighbour signal on NONE leaf resets silently');
fresh(); D.changeTilt(X, Y, Z, 'unstable', null); power = true;
D.neighborUpdate(X, Y, Z); ok(D.tilt(X, Y, Z) === 'none', 'neighbour signal resets a tilted leaf');
fresh(); D.onProjectileHit(X, Y, Z);
ok(D.tilt(X, Y, Z) === 'full' && sounds.join() === D.TILT_DOWN && sched.join() === '100', 'projectile -> FULL + sound + 100');
ok(tickOnStone(), 'scheduledTick ignores non-leaf');
function tickOnStone() { W.setBlock(X, Y, Z, S.stateOf('stone')); return D.scheduledTick(X, Y, Z) === false; }

// anti-vacuity: break the data / rules and prove the checks above notice
{ fresh(); const r = D.DELAY.unstable; D.DELAY.unstable = 7; D.onEntityCollision(X, Y, Z, { onGround: true, y: Y + 1 });
  okAv(sched.join() !== '10', 'wrong UNSTABLE delay is caught'); D.DELAY.unstable = r; }
{ fresh(); const r = D.ABOVE; D.ABOVE = 0.1; D.onEntityCollision(X, Y, Z, { onGround: true, y: Y + 0.6 });
  okAv(D.tilt(X, Y, Z) === 'unstable', 'wrong height threshold lets a low entity tilt it'); D.ABOVE = r; }
{ fresh(); const r = D.DELAY.full; D.DELAY.full = 10; D.onProjectileHit(X, Y, Z);
  okAv(sched.join() !== '100', 'wrong FULL reset delay is caught'); D.DELAY.full = r; }
{ fresh(); const r = D.powered; D.powered = () => false; D.changeTilt(X, Y, Z, 'partial', null); power = true; D.neighborUpdate(X, Y, Z);
  okAv(D.tilt(X, Y, Z) === 'partial', 'ignoring redstone leaves the tilt'); D.powered = r; }
{ fresh(); const r = D.TILT_DOWN; D.TILT_DOWN = 'x'; D.onProjectileHit(X, Y, Z);
  okAv(sounds.join() !== r, 'wrong tilt sound name is caught'); D.TILT_DOWN = r; }

console.log(pass + ' checks passed, ' + breaks + ' anti-vacuity breaks caught, ' + fails.length + ' failed');
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
