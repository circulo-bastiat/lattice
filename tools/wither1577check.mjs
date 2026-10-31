#!/usr/bin/env node
// wither1577check.mjs — #1577: WitherEntityRenderer texture swap (method_4153) and spawn-phase scale (method_4152).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '07m_breed.js', '10_gfx.js', '15h_bemodel.js', '07k_goals.js', '07t_fly.js', '07zw_mobnbt.js', '07_world.js', '07b_behaviour.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender;

const rnd = readFileSync(join(ROOT, '.decomp/net/minecraft/client/render/entity/WitherEntityRenderer.java'), 'utf8');
ok(/wither_invulnerable\.png/.test(rnd) && /220\.0F/.test(rnd) && /0\.5F/.test(rnd) && /> 80/.test(rnd), '.decomp no longer says what this check encodes');

const skin = (t) => ER.witherSkinKey({ type: 'wither', invulTimer: t });
const scale = (t, p) => ER.renderScaleOf({ type: 'wither', invulTimer: t }, p);
const want = (t) => t > 0 && (t > 80 || Math.floor(t / 5) % 2 !== 1) ? 'wither_invulnerable' : null;
for (let t = 0; t <= 220; t++) ok(skin(t) === want(t), 'skin at timer ' + t + ' = ' + skin(t));
ok(skin(220) === 'wither_invulnerable' && skin(0) === null && skin(5) === null && skin(10) === 'wither_invulnerable', 'flash edges');
ok(ER.witherSkinKey({ type: 'zombie', invulTimer: 100 }) === null, 'only withers swap');
ok(scale(0, 0.5) === 2.0, 'settled wither is 2.0');
ok(Math.abs(scale(220, 0) - 1.5) < 1e-9, 'fresh wither is 1.5');
ok(Math.abs(scale(110, 0.5) - (2 - 109.5 / 220 * 0.5)) < 1e-9, 'mid-spawn scale uses (timer - partial)');
ok(/wither_invulnerable/.test(readFileSync(join(ROOT, 'tools/extract-mob-textures.mjs'), 'utf8')), 'wither_invulnerable is extracted');
ok(/wither_invulnerable: 'wither'/.test(readFileSync(join(ROOT, 'tools/pack-mobtex.mjs'), 'utf8')), 'wither_invulnerable draws the wither box list');
ok(/\(it\.eyes \|\| ER\.fullBrightBlockLight\(it\.e\)\) \? 15/.test(readFileSync(join(ROOT, 'src/07j_entityrender.js'), 'utf8')) && ER.fullBrightBlockLight({ type: 'wither' }), 'wither block light is 15');

okAv(!(want(100) === null), 'a texture that ignores the timer would be caught');
okAv(skin(7) === want(100) || skin(7) === null, 'the flash gap (timer 5..9) is plain wither');
okAv(!(Math.abs(2.0 - scale(220, 0)) < 1e-9), 'a flat 2.0 scale would be caught');
okAv(!(Math.abs(scale(110, 0) - scale(110, 1)) < 1e-12), 'a scale that ignores partialTick would be caught');

console.log(`wither1577check (#1577, wither spawn phase)\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
