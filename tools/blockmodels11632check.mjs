#!/usr/bin/env node
// blockmodels11632check.mjs — #11632: proves 02b_registry.js BlockModels.getModelParticleSprite (R.stParticle, 'PTCL' section)
// decodes, feeds States.particleTile and BlockDustParticle (Px.spawnBlockDust); source breaks caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07zx_particle.js'], patch: patch ? (f, s) => (f === '02b_registry.js' ? patch(s) : s) : undefined });
  const S = M.States, R = M.Reg, o = {};
  const st = (n) => S.stateOf(n);
  o.len = R.stParticle.length > 1000 && R.stParticle instanceof Uint16Array;
  o.stone = S.particleTile(st('stone')) >= 0;
  o.dirtGrass = S.particleTile(st('grass_block')) === S.particleTile(st('dirt')) && S.particleTile(st('dirt')) >= 0; // grass's particle is dirt
  o.distinct = S.particleTile(st('stone')) !== S.particleTile(st('dirt'));
  o.chest = S.particleTile(st('chest')) === S.particleTile(st('oak_planks')) && S.particleTile(st('chest')) >= 0;
  o.air = S.particleTile(0) === -1;
  let some = 0, none = 0;
  for (let i = 0; i < R.stParticle.length; i++) R.stParticle[i] === 0xFFFF ? none++ : some++;
  o.mix = some > 1000 && none > 0 && none < some;
  o.sentinel = (() => { const s = st('stone'); const v = R.stParticle[S.vis[s]]; R.stParticle[S.vis[s]] = 0xFFFF; const r = S.particleTile(s) === -1; R.stParticle[S.vis[s]] = v; return r; })();
  const p = M.Particles ? M.Particles : null;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/S\.particleTile\(state\)/.test(rd('07zx_particle.js')), 'reach: spawnBlockDust reads States.particleTile');
ok(/R\.stParticle\[SR\.vis\[state\]\]/.test(rd('02c_states.js')), 'reach: States.particleTile reads R.stParticle');
ok(/spawnBlockDust\(/.test(rd('07zx_particle.js')), 'reach: spawnBlockDust defined');
const BR = [
  ['magic', "pmagic !== 'PTCL'", "pmagic === 'PTCL'", ['stone']],
  ['read', 'R.stParticle[i] = c.u16();', 'R.stParticle[i] = c.u16() & 0;', ['stone', 'distinct']],
  ['skip', 'if (bytes.length - c.p >= 4) {\n      var pmagic', 'if (false) {\n      var pmagic', ['stone']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X, threw = false;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; threw = true; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = threw || expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`blockmodels11632check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
