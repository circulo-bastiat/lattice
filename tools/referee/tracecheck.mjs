// tracecheck.mjs -- #4987 (G17-L1): the lockstep trace comparator reports the FIRST divergent tick + field, bit-for-bit.
import { serverRow, engineRow, compareTraces, FIELDS } from './lockstep/trace.mjs';
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } };
const brk = (c, m) => { n++; if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const mk = (T) => Array.from({ length: T }, (_, t) => engineRow(t, { x: t * 0.1, y: 4, z: 0.5, vx: 0.1, vy: -0.0784, vz: 0, yaw: 90, onGround: true, health: 20, air: 300, fireTicks: -1 }, { sounds: [] }));
const A = mk(50), B = mk(50);
ok(compareTraces(A, B) === null, 'identical traces compare equal');
ok(Object.keys(A[0]).every((k) => k === 'tick' || k in FIELDS) && Object.keys(FIELDS).every((k) => k in A[0]), 'engine row carries exactly the schema');
const S = serverRow(3, { Pos: ['0.3d', '4.0d', '0.5d'], Motion: [0.1, -0.0784, 0], Rotation: [90, 0], OnGround: '1b', Health: '20.0f', Air: '300s', Fire: '-1s' });
ok(S.pos[0] === 0.3 && S.health === 20 && S.onGround === true && S.air === 300, 'serverRow parses snbt scalars');
ok(compareTraces([S], [{ ...A[3], pos: [0.3, 4, 0.5] }], { fields: ['pos', 'health', 'air'] }) === null, 'server vs engine row agree on shared fields');
// breaks: each must be caught, at the FIRST tick and the right field
const mut = (f) => { const C = mk(50); f(C); return compareTraces(A, C); };
let d = mut((C) => { C[20].pos[0] += Number.EPSILON * 8; C[30].health = 19; });
brk(d && d.tick === 20 && d.field === 'pos', '1-ulp-ish position drift reported at first tick 20, field pos');
d = mut((C) => { C[7].onGround = false; C[9].yaw = 91; });
brk(d && d.tick === 7 && d.field === 'onGround', 'onGround flip reported at tick 7');
d = mut((C) => { C.pop(); });
brk(d && d.field === '(length)', 'length mismatch reported');
ok(compareTraces(A, mk(50).map((r, i) => i === 4 ? { ...r, goals: [[1, 'x']] } : r)) === null, 'a field one side lacks (goals null) is skipped, not a divergence');
// tol is the documented escape hatch: the same drift passes only when tol is given
const E = mk(50); E[5].vel[1] += 1e-12;
ok(compareTraces(A, E, { tol: { vel: 1e-9 } }) === null, 'documented tolerance accepts 1e-12');
brk(compareTraces(A, E) !== null, 'without tolerance the same 1e-12 is a divergence');
// #6219: particles [[id,count]] per tick, server log string vs engine Px.tally
const sp = serverRow(1, {}, { particles: 'minecraft:heart:3,smoke:2' }).particles;
const ep = engineRow(1, {}, { particles: { smoke: 2, heart: 3 } }).particles;
ok(compareTraces([{ tick: 1, particles: sp }], [{ tick: 1, particles: ep }]) === null, 'server particle log == engine tally');
const ep1 = engineRow(1, {}, { particles: { smoke: 2, heart: 2 } }).particles;
d = compareTraces([{ tick: 1, particles: sp }], [{ tick: 1, particles: ep1 }]);
brk(d && d.field === 'particles', 'one fewer particle reported as field particles');
// #6221: server rows carry bodyYaw/headYaw; a body control run before travel (KW-51) lags one tick and is reported
const SV = Array.from({ length: 20 }, (_, t) => serverRow(t, { Rotation: [t * 5, 0] }, { bodyYaw: t * 5, headYaw: t * 5 }));
ok(SV[4].bodyYaw === 20 && SV[4].headYaw === 20 && serverRow(1, {}).bodyYaw === null, 'serverRow fills bodyYaw/headYaw from the capture, null without');
const EG = (lag) => Array.from({ length: 20 }, (_, t) => engineRow(t, { yaw: t * 5, yBodyRot: Math.max(0, t - lag) * 5, yHeadRot: t * 5 }));
ok(compareTraces(SV, EG(0), { fields: ['bodyYaw', 'headYaw'] }) === null, 'correct order matches server body/head yaw');
d = compareTraces(SV, EG(1), { fields: ['bodyYaw', 'headYaw'] });
brk(d && d.tick === 1 && d.field === 'bodyYaw', 'body control before travel (1-tick lag) reported at tick 1, bodyYaw');
console.log(`tracecheck: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
