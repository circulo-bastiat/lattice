#!/usr/bin/env node
// renderinterpcheck.mjs — #600 KW-51-3: the mob renderer lerps position, body yaw, head yaw,
// head pitch and limb angle with tickDelta, as LivingEntityRenderer does (ER.posAt / yawAt /
// animOf; one emission path feeds both backends via ER.build). Each assertion is re-run against
// a deliberately broken oracle and must fail ("<n> breaks caught").
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { breaks++; if (c) fails.push('anti-vacuity: ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const M = loadEngine({ extra: ['07j_entityrender.js'] });
const ER = M.EntityRender;
const D2R = Math.PI / 180;

const e = { x: 10, y: 5, z: -2, px: 8, py: 4, pz: 0, maxHealth: 20, type: 'zombie',
  yaw: 1.0, yawO: 0.2, yBodyRot: 1.0, yBodyRotO: 0.2, yHeadRot: 0.6, yHeadRotO: 0.1,
  xHeadRot: 0.5, xHeadRotO: 0.1, animPos: 6, animSpeed: 0.8, animSpeedO: 0.2 };
const t = 0.25;

// position
const p = ER.posAt(e, t, [0, 0, 0]);
ok(near(p[0], 8.5) && near(p[1], 4.25) && near(p[2], -0.5), 'posAt lerps prev->cur');
brk(near(p[0], 10), 'position must not be the raw tick value');

// body yaw
ok(near(ER.yawAt(e, t), 0.2 + 0.8 * t), 'yawAt lerps yBodyRotO->yBodyRot');
brk(near(ER.yawAt(e, t), 1.0), 'yaw must not be raw');
// wraparound takes the short way
const w = ER.yawAt({ yBodyRot: -3.0, yBodyRotO: 3.0 }, 0.5);
ok(Math.abs(Math.abs(w) - Math.PI) < 0.2, 'yaw lerp crosses +-PI the short way');
brk(near(w, 0), 'yaw lerp must not swing the long way');

// head yaw (relative to body), head pitch, limb
const a = ER.animOf(e, t);
const headRel = (0.1 + 0.5 * t) - (0.2 + 0.8 * t);
ok(near(a.netHeadYaw * D2R, headRel), 'netHeadYaw uses lerped head and lerped body');
brk(near(a.netHeadYaw * D2R, 0.6 - 1.0), 'netHeadYaw must not use raw values');
ok(near(a.headPitch * D2R, 0.1 + 0.4 * t), 'headPitch lerps xHeadRotO->xHeadRot');
brk(near(a.headPitch * D2R, 0.5), 'headPitch must not be raw');
ok(near(a.limbSwing, 6 - 0.8 * (1 - t)), 'limbSwing = animPos - speed*(1-tickDelta)');
brk(near(a.limbSwing, 6), 'limbSwing must not be raw');
ok(near(a.limbSwingAmount, 0.2 + 0.6 * t), 'limbSwingAmount lerps animSpeedO->animSpeed');
brk(near(a.limbSwingAmount, 0.8), 'limbSwingAmount must not be raw');
// endpoints
ok(near(ER.animOf(e, 1).headPitch * D2R, 0.5) && near(ER.posAt(e, 0, [0, 0, 0])[0], 8), 'endpoints t=0/1');

console.log(`${pass} ok, ${breaks} breaks caught, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
