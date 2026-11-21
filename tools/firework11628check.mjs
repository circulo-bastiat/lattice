#!/usr/bin/env node
// firework11628check.mjs — #11628: proves 07zzy_firework.js (FireworkRocketItem use + FireworksSparkParticle.Starter blast sounds),
// with reachability from 14l_use.js and SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07zzy_firework.js'], dom: false, patch: patch ? (f, s) => (f === '07zzy_firework.js' ? patch(s) : s) : undefined });
  const Fw = MCL.Firework, o = {};
  const snd = [], spawned = [], shr = []; let syncs = 0;
  MCL.Sound = { entitySound: (ev, x, y, z, v, p) => snd.push([ev, v, p]) };
  MCL.EntityList = { spawn: (n, x, y, z, op) => { const r = { n, x, y, z, op }; spawned.push(r); return r; } };
  MCL.Inventory = { shrink: (s, n) => shr.push(n), tagOf: (s) => s.tag };
  const P = { x: 0, y: 0, z: 0, eyeHeight: 1.62, syncHotbar: () => syncs++ };
  MCL.Player = P;
  const tag = { Fireworks: { Flight: 2, Explosions: [{ Type: 0, Flicker: true }] } };
  // FireworkRocketItem.useOnBlock
  const st = { tag };
  o.onBlock = Fw.useOnBlock(P, 10, 20, 30, 2, st) === true && Math.abs(spawned[0].y - 20.15) < 1e-9 && spawned[0].x === 10 && spawned[0].op.tag === tag && shr.length === 1 && syncs === 1;
  Fw.useOnBlock(P, 10, 20, 30, 0, st); o.faceX = Math.abs(spawned[1].x - 10.15) < 1e-9;
  // use(): only fall-flying, creative keeps the stack
  o.groundNo = Fw.useInAir(P, st) === false && spawned.length === 2;
  P.fallFlying = true;
  o.airYes = Fw.useInAir(P, st) === true && spawned[2].op.shooter === P && shr.length === 3;
  P.instabuild = true; Fw.useInAir(P, st); o.creative = spawned.length === 4 && shr.length === 3;
  // lifeTime / counts
  o.life = Fw.lifeFor(2, () => 3) === 36 && Fw.explosionCount({ tag }) === 2 - 1 && Fw.flightOf({ tag }) === 2;
  // FireworksSparkParticle.Starter sounds
  snd.length = 0; Fw.blastSounds({ tag, x: 0, y: 0, z: 0 }, () => 0);
  o.small = snd[0] && snd[0][0] === 'entity.firework_rocket.blast' && snd[0][1] === 20 && Math.abs(snd[0][2] - 0.95) < 1e-9 && snd[1] && snd[1][0] === 'entity.firework_rocket.twinkle';
  snd.length = 0; Fw.blastSounds({ tag: { Fireworks: { Explosions: [{ Type: 1 }] } }, x: 0, y: 0, z: 0 }, () => 0);
  o.large = snd.length === 1 && snd[0][0] === 'entity.firework_rocket.large_blast';
  snd.length = 0; Fw.blastSounds({ tag, x: 100, y: 0, z: 0 }, () => 0);
  o.far = snd[0][0] === 'entity.firework_rocket.blast_far' && snd[1][0] === 'entity.firework_rocket.twinkle_far';
  snd.length = 0; Fw.blastSounds({ tag: { Fireworks: { Explosions: [{}, {}, {}] } }, x: 0, y: 0, z: 0 }, () => 0);
  o.three = snd[0][0] === 'entity.firework_rocket.large_blast';
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/NS\.Firework\.useOnBlock\(/.test(rd('14l_use.js')) && /NS\.Firework\.useInAir\(/.test(rd('14l_use.js')), 'reach: 14l_use calls useOnBlock/useInAir');
ok(/Fw\.blastSounds\(e\)/.test(rd('07zzy_firework.js')), 'reach: explodeAndRemove plays blastSounds');
const BR = [
  ['offset', 'hy + o[1] * 0.15', 'hy', ['onBlock']],
  ['faceX', 'hx + o[0] * 0.15', 'hx', ['faceX']],
  ['spendBlock', 'if (r) spend(P, stack);', '', ['onBlock']],
  ['flyOnly', 'if (!P || !P.fallFlying) return false;', 'if (!P) return false;', ['groundNo']],
  ['creative', 'if (!P.instabuild) spend(P, stack);', 'spend(P, stack);', ['creative']],
  ['shooter', 'shooter: P }', '}', ['airYes']],
  ['large1', '(ex[i].Type | 0) === 1', 'false', ['large']],
  ['large3', 'ex.length >= 3', 'false', ['three']],
  ['far', '>= 256', '>= 1e9', ['far']],
  ['twinkle', 'if (ex[j].Flicker)', 'if (false)', ['small']],
  ['pitch', '0.95 + rnd() * 0.1', '1', ['small']],
  ['life', '10 * (1 + flight)', '10 * flight', ['life']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`firework11628check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
