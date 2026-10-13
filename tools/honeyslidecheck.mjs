#!/usr/bin/env node
// honeyslidecheck.mjs — #5575: HoneyBlock isSliding/updateSlidingVelocity (.decomp constants). Evaluates the two
// pure helpers out of src/14l_use.js and checks the entityCollide hook. Anti-vacuity: breaks its own source.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', '14l_use.js'), 'utf8');
function problems(text) {
  const bad = [];
  const i = text.indexOf('Use.honeySliding = '), j = text.indexOf('Use.entityCollide = ');
  if (i < 0 || j < 0) return ['helpers missing'];
  const Use = {};
  try { new Function('Use', text.slice(i, text.lastIndexOf('/**', j))).call(null, Use); } catch (e) { return ['eval: ' + e.message]; }
  const E = (o) => Object.assign({ x: 0.5, y: 5.5, z: 1.5, vx: 0.1, vy: -0.2, vz: 0, onGround: false, width: 0.6, fallDistance: 9 }, o);
  let e = E({});
  if (!Use.honeySliding(e, 0, 5, 0)) bad.push('beside, falling: not sliding');
  Use.honeySlideVelocity(e);
  if (e.vy !== -0.05) bad.push('vy not -0.05: ' + e.vy);
  if (Math.abs(e.vx - 0.1 * (0.05 / 0.2)) > 1e-12) bad.push('horizontal not scaled');
  if (e.fallDistance !== 0) bad.push('fallDistance kept');
  e = E({ vy: -0.1 }); Use.honeySlideVelocity(e);
  if (e.vy !== -0.05 || e.vx !== 0.1) bad.push('slow fall must only set vy');
  if (Use.honeySliding(E({ onGround: true }), 0, 5, 0)) bad.push('ground slides');
  if (Use.honeySliding(E({ y: 5.95 }), 0, 5, 0)) bad.push('above top slides');
  if (Use.honeySliding(E({ vy: -0.08 }), 0, 5, 0)) bad.push('vy -0.08 slides');
  if (Use.honeySliding(E({ x: 0.5, z: 0.5 }), 0, 5, 0)) bad.push('inside centre slides');
  if (!/Use\.honeySlideVelocity\(e\)/.test(text.slice(j))) bad.push('entityCollide hook missing');
  return bad;
}
const fails = problems(src);
let breaks = 0;
const caught = (label, text) => {
  if (text === src) fails.push('anti-vacuity: ' + label + ' did not change source');
  else if (problems(text).length) { breaks++; console.log('   ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
caught('hook removed', src.replace('Use.honeySlideVelocity(e);\n          if (Math', 'if (Math'));
caught('vy constant', src.replace('e.vy = -0.05;', 'e.vy = -0.06;'));
caught('ground check', src.replace('if (e.onGround) return false;', ''));
caught('top check', src.replace('0.9375 - 1.0E-7', '1.5'));
console.log('\n================ honeyslidecheck ================');
console.log(` assertions passed .. ${14 - fails.length}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
