#!/usr/bin/env node
// endermancarriedcheck.mjs — #1749: EndermanBlockFeatureRenderer + EndermanEntityModel carrying/angry pose.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ ' + m); else fails.push('anti-vacuity: ' + m); };
console.log('endermancarriedcheck — #1749');
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07zg_enderman.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
  const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
}
M.EntityRender.init();
const ER = M.EntityRender;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const mk = (o) => Object.assign({ type: 'enderman', x: 10.5, y: 20, z: 10.5, px: 10.5, py: 20, pz: 10.5, yaw: 0, pyaw: 0, age: 0, maxHealth: 40, health: 40 }, o || {});
const dirt = M.States.stateOf('dirt');
const feats = (e) => { M.EntityList.ready = true; M.EntityList.list = [e]; return ER.visible(10, 20, 10, 1).filter((it) => it.shape === 'mushroom'); };

ok(feats(mk()).length === 0, 'idle enderman draws no carried block');
const f = feats(mk({ carriedBlock: dirt }));
ok(f.length === 1 && f[0].state === dirt, 'carrying enderman draws its block');
const c = f[0] && f[0].mush.c;
// independent derivation, yaw 0: t=(0,.6875,-.75); Rx20*Ry45*(.25,.1875,.25); plus the block centre via L
const d = Math.PI / 180, cx = Math.cos(20 * d), sx = Math.sin(20 * d);
const rxv = (v) => [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
const ryv = (a, v) => [Math.cos(a * d) * v[0] + Math.sin(a * d) * v[2], v[1], -Math.sin(a * d) * v[0] + Math.cos(a * d) * v[2]];
const t2 = rxv(ryv(45, [0.25, 0.1875, 0.25]));
const h = rxv(ryv(45, [-0.25, -0.25, -0.25]));   // S * Ry90 * (.5,.5,.5)
const exp = [t2[0] + h[0], 0.6875 + t2[1] + h[1], -0.75 + t2[2] + h[2]];
ok(c && near(c[0], -exp[0]) && near(c[1], -(exp[1]) + 1.501) && near(c[2], exp[2]), 'block centre matches hand derivation (got ' + c + ')');
const m = f[0] && f[0].mush.m;
ok(m && near(Math.hypot(m[0], m[3], m[6]), 0.5), 'block drawn at half scale');

// pose
const rest = { n: 'head', rx: 0, ry: 0, rz: 0, px: 0, py: -13, pz: 0 };
const dl = (n, en) => ER.setupAnimDelta(n, 0, 0, 0, 0, false, 'biped', { rest: Object.assign({}, rest, { n }), biped: true, enderman: en });
const carry = { carrying: true, angry: false }, ang = { carrying: false, angry: true };
ok(near(dl('right_arm', carry).rx, -0.5) && near(dl('left_arm', carry).rx, -0.5), 'carrying arms pitch -0.5');
ok(near(dl('right_arm', carry).rz, 0.05) && near(dl('left_arm', carry).rz, -0.05), 'carrying arms roll +-0.05');
ok(near(dl('head', ang).dpy, -5) && near(dl('hat', ang).dpy, -5), 'angry head/hat pivotY -5');
ok(!dl('head', carry).dpy && !dl('right_arm', ang).rz, 'flags are independent');
const an = (e) => ER.animOf(e, 1).enderman;
ok(an(mk({ carriedBlock: dirt })).carrying && !an(mk()).carrying, 'animOf reads carriedBlock');
ok(an(mk({ target: {} })).angry && !an(mk()).angry, 'animOf reads target as angry');

const src = ER.endermanCarried;
ER.endermanCarried = () => null;
okAv(feats(mk({ carriedBlock: dirt })).length === 0, 'a layer that draws nothing is caught');
ER.endermanCarried = (e, p) => { const r = src(e, p); r.c = [r.c[0], r.c[1] + 1, r.c[2]]; return r; };
okAv(!near(feats(mk({ carriedBlock: dirt }))[0].mush.c[1], c[1]), 'a shifted block is caught');
ER.endermanCarried = src;
const sa = ER.animOf;
ER.animOf = (e, p) => Object.assign({}, sa(e, p), { enderman: null });
okAv(ER.animOf(mk({ carriedBlock: dirt }), 1).enderman === null, 'dropping the pose flags is caught');
ER.animOf = sa;

// #2842: pick-up stores the block's DEFAULT state (vanilla getDefaultState), never the facing/axis one
{
  const hay = M.Reg.id.hay_block, base = M.Reg.realFirst[hay] + M.Reg.defaultState[hay];
  const odd = M.Reg.realFirst[hay] + (M.Reg.defaultState[hay] + 1) % (M.Reg.realFirst[hay + 1] - M.Reg.realFirst[hay]);
  const pick = (st) => {
    M.World = { getBlock: () => st, setBlock() {} }; M.Tags = { ready: true, stateIn: () => true };
    const e = mk({ carriedBlock: null }); new M.Enderman.PickUpBlockGoal(e).tick();
    return e.carriedBlock;
  };
  ok(odd !== base && M.States.block[odd] === hay, 'test setup: a non-default hay_block state');
  ok(pick(odd) === base, 'pick-up stores default state (got ' + pick(odd) + ', want ' + base + ')');
  const dp = M.Reg.defaultState; M.Reg.defaultState = dp.map((v) => v + 0);
  M.Reg.defaultState[hay] = (dp[hay] + 1) % (M.Reg.realFirst[hay + 1] - M.Reg.realFirst[hay]);
  okAv(pick(odd) !== base, 'a pick-up that stores another state is caught');
  M.Reg.defaultState = dp;
}

console.log(`\n${pass} checks passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((x) => console.log('  FAIL: ' + x)); process.exit(1); }
