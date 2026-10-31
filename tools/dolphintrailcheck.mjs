#!/usr/bin/env node
// dolphintrailcheck.mjs — #4719: DolphinEntity.tick client branch (.decomp passive/DolphinEntity.java:266-293):
// touching water and v^2 > 0.03 -> 4 'dolphin' particles at (x - rot*f +/- cos*0.3, y - rot.y, z - rot*f +/- sin*0.3).
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07zx_particle.js', '07zq_snowgolem.js', '07zz2_dolphin.js'], dom: false, initReg: false });
const D = M.Dolphin, got = [];
M.Particle.spawn = (t, x, y, z, vx, vy, vz) => { got.push({ t, x, y, z, vx, vy, vz }); return {}; };
const run = (e) => { got.length = 0; return D.tickTrail(e); };
const base = () => ({ x: 10, y: 64, z: 5, yaw: 0, pitch: 0, inWater: true, vx: 0, vy: 0, vz: -0.3 });

ok(run(base()) === 4 && got.length === 4 && got.every(p => p.t === 'dolphin'), 'fast in water: 4 dolphin particles');
// yaw 0: forward -z, so the trail is behind at +z by f in [0.5,1.2], sides +/-0.3 in x, y unchanged
ok(got.every(p => p.z > 5.49 && p.z <= 6.21 && Math.abs(Math.abs(p.x - 10) - 0.3) < 1e-9 && p.y === 64 && !p.vx && !p.vy && !p.vz), 'offsets behind and to the sides');
ok(got.filter(p => p.x > 10).length === 2, 'two each side');
ok(run({ ...base(), vz: -0.1 }) === 0 && got.length === 0, 'v^2 = 0.01: none');
ok(run({ ...base(), inWater: false }) === 0 && got.length === 0, 'out of water: none');
ok(run({ ...base(), vz: -Math.sqrt(0.03) }) === 0, 'v^2 == 0.03 exactly: none (strict >)');
ok(run({ ...base(), yaw: Math.PI / 2, vz: 0, vx: 0.3 }) === 4 && got.every(p => p.x < 10 && Math.abs(Math.abs(p.z - 5) - 0.3) < 1e-9), 'yaw 90: forward +x, trail at -x');
// anti-vacuity: a trail that ignores speed must be caught by the slow row
D.tickTrail = (e) => { got.length = 0; return 4; };
let breaks = 0;
if (D.tickTrail({ ...base(), vz: -0.1 }) !== 0) { breaks++; console.log("  ✓ slow row noticed"); }
if (D.tickTrail({ ...base(), inWater: false }) !== 0) { breaks++; console.log("  ✓ dry row noticed"); }
console.log(`  ${breaks} breaks caught`);
console.log(`dolphintrailcheck: ${pass} checks passed, ${fails.length} failures (${breaks} anti-vacuity)`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length || breaks < 2 ? 1 : 0);
