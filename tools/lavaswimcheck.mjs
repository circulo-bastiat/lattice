#!/usr/bin/env node
// lavaswimcheck.mjs — G17b (#8266). The player's lava branch of LivingEntity.travel: after the move,
// getFluidHeight(LAVA) <= getSwimHeight() ? (0.5,0.8,0.5) : (0.5,0.5,0.5), then vy -= 0.08/4.
// Cases: 1-deep source, 2-deep source, flowing level 4 (height 4/9 > 0.4), flowing level 5 (3/9 <= 0.4).
//   node tools/lavaswimcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js',
                 '03_section.js', '05_mesher.js', '14b_physics.js', '07b_behaviour.js', '09c_weather.js'])
  new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const gm = JSON.parse(readFileSync(join(ROOT, 'assets/block-geometry.meta.json'), 'utf8'));
const rm = JSON.parse(readFileSync(join(ROOT, 'assets/block-runtime.meta.json'), 'utf8'));
const PHYS = JSON.parse(readFileSync(join(ROOT, 'assets/block-physics.json'), 'utf8'));
NS.Reg.init({
  runtime: readFileSync(join(ROOT, 'assets/block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ROOT, 'assets/block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes,
  physics: { defaults: PHYS.defaults, exceptions: PHYS.exceptions },
});
NS.Blocks.init();
NS.Behave.init({});
const Ph = NS.Physics, SR = NS.States;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

let cells = {};
const get = (x, y, z) => cells[Math.floor(x) + ',' + Math.floor(y) + ',' + Math.floor(z)] || 0;
NS.World = { getBlock: get };
Ph.blockAt = get;
Ph.shapeAt = () => null;

const lava = (lvl) => SR.withLocal('lava', lvl);
// each case: cells, feet y, expected deep?
const CASES = [
  ['1-deep source', { '0,10,0': lava(0) }, 10, true],
  ['2-deep source', { '0,10,0': lava(0), '0,11,0': lava(0) }, 10, true],
  ['flowing level 4', { '0,10,0': lava(4) }, 10, true],
  ['flowing level 5', { '0,10,0': lava(5) }, 10, false],
];

function run() {
  const out = [];
  for (const [name, c, y, deep] of CASES) {
    cells = c;
    const e = { x: 0.5, y, z: 0.5, vx: 0.2, vy: -0.01, vz: -0.2, yaw: 0, pitch: 0, onGround: false, flying: false,
                inWater: false, noclip: false, height: Ph.H, eyeHeight: Ph.EYE, fallDistance: 0, effects: {} };
    Ph.tick(e, { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false });
    const fy = deep ? 0.5 : 0.8;
    ok(e.inLava === true, name + ': in lava');
    ok(near(e.vx, 0.1), name + ': vx x0.5, got ' + e.vx);
    ok(near(e.vz, -0.1), name + ': vz x0.5, got ' + e.vz);
    ok(near(e.vy, -0.01 * fy - 0.02), name + ': vy x' + fy + ' - 0.02, got ' + e.vy);
    out.push(e.vy);
  }
}
run();
const clean = fails.length;
if (clean) { for (const f of fails.slice(0, 20)) console.log('  FAIL ' + f); console.log(pass + ' passed, ' + clean + ' FAILED'); process.exit(1); }

// anti-vacuity: the old chest-cell depth rule must disagree with vanilla on at least one case
let breaks = 0;
const realH = Ph.fluidHeightOf;
const chest = (e) => (SR.block[get(Math.floor(e.x), Math.floor(e.y + 1.0), Math.floor(e.z))] === NS.Reg.id.lava ? 9 : 0);
for (const [mut, fn] of [['chest-cell depth', chest], ['always shallow', () => 0], ['always deep', () => 9]]) {
  Ph.fluidHeightOf = fn; fails.length = 0; const p = pass; run(); pass = p;
  if (fails.length) breaks++;
}
Ph.fluidHeightOf = realH;
console.log(pass + ' assertions, 0 failures, ' + breaks + ' breaks caught (G17b #8266 player lava depth)');
if (breaks < 3) { console.log('anti-vacuity: expected 3 breaks'); process.exit(1); }
