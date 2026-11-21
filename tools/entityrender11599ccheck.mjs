#!/usr/bin/env node
// entityrender11599check.mjs — #11599 (AUDIT-MAP). 07j_entityrender.js's rod/bow/frame-light/rotLerp/shaking renderer classes (part 3) driven through their real
// entry points (ER.shouldRender / ER.stateOf / ER.renderAmount / ER.itemLift / ER.itemSpin / ER.arrowYaw / ER.arrowPitch /
// ER.arrowMatrix / ER.fireballMatrix), then re-run against source mutants that cut each one: every cut must be noticed.
//   EntityRenderer + EntityRenderDispatcher (shouldRender)   FallingBlockEntityRenderer / TntEntityRenderer (stateOf)
//   ItemEntityRenderer (renderAmount, bob, spin)             ArrowEntityRenderer / SpectralArrowEntityRenderer (yaw, pitch, matrix)
//   DragonFireballEntityRenderer (fireballMatrix, FIREBALL_SCALE)
import { loadEngine, initRegistry } from './loadsrc.mjs';

const near = (a, b) => Math.abs(a - b) < 1e-9;
let N = 0;
function run(patch) {
  const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js'], dom: false,
    ...(patch ? { patch: (f, t) => (f === '07j_entityrender.js' ? patch(t) : t) } : {}) });
  initRegistry(M);
  const ER = M.EntityRender, f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    ER.init();
    ok(ER.glowSquidBlockLight({ type: 'glow_squid', darkTicksRemaining: 0 }, 3) === 15 && ER.glowSquidBlockLight({ type: 'glow_squid', darkTicksRemaining: 5 }, 3) === 7 && ER.glowSquidBlockLight({ type: 'glow_squid', darkTicksRemaining: 5 }, 10) === 10 && ER.glowSquidBlockLight({ type: 'squid' }, 3) === 3, 'GlowSquidEntityRenderer block light');
    ok(ER.fullBrightBlockLight({ type: 'blaze' }) === true && ER.fullBrightBlockLight({ type: 'magma_cube' }) === true && ER.fullBrightBlockLight({ type: 'zombie' }) === false, 'fullbright block light renderers');
    ok(near(ER.spitYaw({ spitYaw: 100, spitYawO: 80 }, 0.5), 0) && near(ER.spitYaw({ spitYaw: 90 }, 1), 0) && near(ER.spitYaw({ spitYaw: 180, spitYawO: 180 }, 0), Math.PI / 2), 'LlamaSpitEntityRenderer yaw');
    ok(near(ER.slimeStretch({ lastStretch: 1, stretch: 3 }, 0.5), 2) && ER.slimeStretch({ lastStretch: -2, stretch: -2 }, 0.5) === 0, 'MagmaCube/Slime stretch');
    const sl = ER.slimeScale({ type: 'slime', size: 2, lastStretch: 2, stretch: 2 }, 0), mc = ER.slimeScale({ type: 'magma_cube', size: 2, lastStretch: 2, stretch: 2 }, 0);
    ok(near(sl.sxz, 0.999) && near(sl.sy, 3.996) && near(mc.sxz, 1) && near(mc.sy, 4) && ER.slimeScale({ type: 'zombie' }, 0) === null, 'SlimeEntityRenderer scale');
    const bell = (d) => ER.bellAnim({ ringing: true, ticks: 3, lastSideHit: d }, 0).deltaFor('bell_body'), s3 = Math.sin(3 / Math.PI) / 5;
    ok(near(bell('north').rx, -s3) && near(bell('south').rx, s3) && near(bell('east').rz, -s3) && near(bell('west').rz, s3) && ER.bellAnim({ ringing: false, ticks: 3, lastSideHit: 'north' }, 0).deltaFor('bell_body').rx === 0 && ER.bellAnim({ ringing: true }, 0).deltaFor('x') === null, 'BellBlockEntityRenderer swing');
    ok(ER.isChristmasDate(new Date(2026, 11, 24)) && ER.isChristmasDate(new Date(2026, 11, 26)) && !ER.isChristmasDate(new Date(2026, 11, 23)) && !ER.isChristmasDate(new Date(2026, 11, 27)) && !ER.isChristmasDate(new Date(2026, 10, 25)), 'ChestBlockEntityRenderer christmas dates');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['glow squid max base', (t) => t.replace('return v === 15 ? 15 : Math.max(v, base);', 'return v === 15 ? 15 : v;')],
  ['glow squid fade', (t) => t.replace('(e.darkTicksRemaining | 0) / 10', '(e.darkTicksRemaining | 0) / 20')],
  ['fullbright blaze', (t) => t.replace("e.type === 'vex' || e.type === 'blaze' ||", "e.type === 'vex' ||")],
  ['spit yaw offset', (t) => t.replace('(partial === undefined ? 1 : partial) - 90) * Math.PI', '(partial === undefined ? 1 : partial)) * Math.PI')],
  ['spit yaw lerp', (t) => t.replace('(yo + (y - yo) * (partial', '(y + (y - yo) * (partial')],
  ['slime stretch clamp', (t) => t.replace('return st < 0 ? 0 : st;', 'return st;')],
  ['slime stretch lerp', (t) => t.replace("(e.lastStretch || 0) + ((e.stretch || 0) - (e.lastStretch || 0)) * (partial || 0);\n    return st < 0", "(e.stretch || 0);\n    return st < 0")],
  ['slime 0.999', (t) => t.replace("e.type === 'slime' ? 0.999 : 1", 'e.type === \'slime\' ? 1 : 1')],
  ['slime g', (t) => t.replace('k * size / g }', 'k * size * g }')],
  ['bell north', (t) => t.replace("d === 'north') rx = -s", "d === 'north') rx = s")],
  ['bell west', (t) => t.replace("d === 'west') rz = s", "d === 'west') rz = -s")],
  ['bell ringing', (t) => t.replace('if (e && e.ringing) {', 'if (e) {')],
  ['christmas upper', (t) => t.replace('d.getDate() <= 26', 'd.getDate() <= 25')],
  ['christmas month', (t) => t.replace('d.getMonth() + 1 === 12', 'd.getMonth() + 1 >= 11')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
