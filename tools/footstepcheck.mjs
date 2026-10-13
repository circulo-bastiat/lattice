#!/usr/bin/env node
// footstepcheck.mjs -- #372 G13: the footstep is Entity.move's, not "the block at floor(y-0.2)".
//
//   node tools/footstepcheck.mjs
//
// Drives the real P.tickFootsteps over fixtures and reads the event + source off S.play:
//   fence top -> block.wood.step (getLandingPos fallback), snow layer -> block.snow.step
//   (#inside_step_sound_blocks), lily pad -> silent (water is liquid), touching water ->
//   entity.player.swim, amethyst -> chime then step, and every one on the PLAYERS source.
// Anti-vacuity: each rule is broken in the engine source (loadEngine's patch hook) and must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function run(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02j_sounds.js', '14b_physics.js', '14_player.js'], dom: false, patch });
  const S = M.Sound, P = M.Player, R = M.Reg, id = (n) => M.States.stateOf(n);
  const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'sounds.meta.json'), 'utf8'));
  S.init({ sounds: readFileSync(join(MCLITE_ROOT, 'assets', 'sounds.bin')).toString('base64'), soundsBytes: meta.rawBytes });
  const played = [];
  S.play = (ev, o) => { played.push({ ev, source: o.source }); return true; };
  let blocks = {};
  M.World = { getBlock: (x, y, z) => blocks[x + ',' + y + ',' + z] || 0 };
  const step = (fix, o) => {
    blocks = fix; played.length = 0;
    Object.assign(P, { mode: 0, flying: false, crouching: false, onGround: true, inWater: false, x: 0.5, y: 5.0, z: 0.5, vx: 0.1, vy: -0.08, vz: 0,
      moveDist: 2, nextStep: 1, stepAge: 100, lastChimeAge: 0, lastChimeIntensity: 1 }, o || {});
    P.tickFootsteps();
    return played.map((p) => p.ev + '@' + p.source).join(',');
  };
  const out = {};
  out.fenceFall = step({ '0,2,0': id('oak_fence') }, { y: 4.1 });           // block 3 air, fence at 2
  out.snow = step({ '0,4,0': id('grass_block'), '0,5,0': id('snow') }, { y: 5.1 });
  out.lily = step({ '0,4,0': id('water'), '0,5,0': id('lily_pad') }, { y: 5.09 });
  out.swim = step({ '0,4,0': id('sand') }, { y: 5.0, inWater: true, onGround: false });
  out.amethyst = step({ '0,4,0': id('amethyst_block') }, { y: 5.0 });
  out.stone = step({ '0,4,0': id('stone') }, { y: 5.0 });
  return out;
}
const check = (o) => {
  ok(o.fenceFall === 'block.wood.step@player', 'fence under air plays wood, got ' + o.fenceFall);
  ok(o.snow === 'block.snow.step@player', 'snow layer plays snow, got ' + o.snow);
  ok(o.lily === '', 'lily pad is silent, got ' + o.lily);
  ok(/^entity\.player\.swim@player$/.test(o.swim), 'touching water swims, got ' + o.swim);
  ok(o.amethyst === 'block.amethyst_block.chime@player,block.amethyst_block.step@player', 'amethyst chimes then steps, got ' + o.amethyst);
  ok(o.stone === 'block.stone.step@player', 'stone plays stone on the players source, got ' + o.stone);
  return fails.length;
};
console.log('footstepcheck -- #372, the footstep rules of Entity.move');
const good = run();
if (process.argv.includes('--verbose')) console.log(good);
check(good);

// anti-vacuity: break each rule in the real source; the check must fail
const P14 = '14_player.js';
const breaksList = [
  ['no landing fallback', (f, s) => f === P14 ? s.replace('if (lower) {', 'if (false) {') : s, 'fenceFall'],
  ['no inside-step block', (f, s) => f === P14 ? s.replace('use = above;', '') : s, 'snow'],
  ['liquid not silent', (f, s) => f === P14 ? s.replace('if (b === C.water || b === C.lava || b === C.bubble) return false;', '') : s, 'lily'],
  ['no swim sound', (f, s) => f === P14 ? s.replace('if (P.inWater) {\n      var vx', 'if (false) {\n      var vx') : s, 'swim'],
  ['no chime', (f, s) => f === P14 ? s.replace('P.stepAge >= P.lastChimeAge + 20', 'false') : s, 'amethyst'],
  ['blocks source', (f, s) => f === P14 ? s.replace("P, 'player');\n  };", 'P);\n  };') : s, 'stone'],
];
for (const [name, patch, key] of breaksList) {
  let o; try { o = run(patch); } catch (e) { o = {}; }
  const saved = fails.length, p0 = pass;
  const before = fails.length; check(o);
  const caught = fails.length > before;
  fails.length = saved; pass = p0;
  breaks++;
  if (caught) { pass++; console.log('  ✓ break caught: ' + name); } else fails.push('anti-vacuity: not caught: ' + name);
}
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} checks passed, 0 failures (${breaks} breaks caught)`);
