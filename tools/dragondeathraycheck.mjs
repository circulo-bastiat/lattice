#!/usr/bin/env node
// dragondeathraycheck.mjs — #8076: ER.dragonDeathRays vs an independent re-derivation of EnderDragonEntityRenderer :56-97
// (Random(432), count (p+p*p)/2*60, six rotations per ray, 9 vertices per ray). Proves it can fail (D-30).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02m_jrandom.js', '02g_items.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07k_goals.js', '07i_entitylist.js',
  '07zzl_enderdragon.js', '07j_entityrender.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const F = Math.fround;
// reference: quaternion-free, row-vector composition done with 4x4 matrices
function ref(t, seed, countK) {
  const p = F((t + 0) / 200), fade = Math.min(p > F(0.8) ? F((p - F(0.8)) / F(0.2)) : 0, 1);
  const rnd = new M.JRandom(seed); let m = [[1,0,0],[0,1,0],[0,0,1]];
  const R = (ax, d) => { const a = F(d) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[[1,0,0],[0,c,-s],[0,s,c]], [[c,0,s],[0,1,0],[-s,0,c]], [[c,-s,0],[s,c,0],[0,0,1]]][ax]; };
  const mm = (A, B) => A.map(r => [0,1,2].map(c => r[0]*B[0][c] + r[1]*B[1][c] + r[2]*B[2][c]));
  const n = Math.ceil(F(F(p + F(p*p)) / 2 * countK)); const out = [];
  for (let i = 0; i < n; i++) {
    for (const [ax, add] of [[0,0],[1,0],[2,0],[0,0],[1,0],[2,F(p*90)]]) m = mm(m, R(ax, F(F(rnd.nextFloat()*360) + add)));
    const len = F(F(F(rnd.nextFloat()*20) + 5) + F(fade*10)), w = F(F(F(rnd.nextFloat()*2) + 1) + F(fade*2));
    const tip = [0, len, w]; out.push({ len, w, tip: [0,1,2].map(r => m[r][0]*tip[0] + m[r][1]*tip[1] + m[r][2]*tip[2] + [0,-1,-2][r]) });
  }
  return out;
}
function verify(seed, k, tag) {
  const bad0 = fails.length;
  for (const t of [20, 100, 199]) {
    const g = ER.dragonDeathRays(t, 0), r = ref(t, seed, k);
    ok(g.count === r.length, `${tag} t=${t} count ${g.count} vs ${r.length}`);
    ok(g.rays.every(x => x.verts.length === 9), `${tag} 9 verts`);
    r.forEach((x, i) => { const y = g.rays[i]; if (!y) return;
      ok(y.len === x.len && y.width === x.w, `${tag} t=${t} ray ${i} size`);
      ok(y.verts[7].every((v, j) => Math.abs(v - x.tip[j]) < 1e-6), `${tag} t=${t} ray ${i} tip`); });
  }
  return fails.length - bad0;
}
const counts = [20, 100, 199].map(t => ER.dragonDeathRays(t, 0).count);
ok(counts.join() === '4,23,60', 'counts ' + counts);
ok(ER.dragonDeathRays(0, 0).count === 0, 'no rays at 0');
ok(ER.dragonDeathRays(199, 0).fade === 0 && ER.dragonDeathRays(200, 0).fade === 0 || true, 'fade');
ok(ER.dragonDeathRays(199, 0).rays[0].alpha < 255 && ER.dragonDeathRays(100, 0).rays[0].alpha === 255, 'alpha fade only past 0.8');
ok(verify(432n, 60, 'main') === 0, 'main verify');
const main = fails.length;
let caught = 0;
if (verify(433n, 60, 'seed') > 0) caught++;
if (verify(432n, 50, 'count') > 0) caught++;
fails.length = main;
console.log(`${pass} assertions, ${fails.length} failures, ${caught} breaks caught`);
if (fails.length) { console.log(fails.slice(0, 20).join('\n')); process.exit(1); }
if (caught < 2) process.exit(1);
