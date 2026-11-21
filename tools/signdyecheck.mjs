#!/usr/bin/env node
// signdyecheck.mjs — #5797: SignBlock.onUse (dye recolours, glow ink sac makes text glow, stack shrinks outside creative,
// same dye twice consumes nothing) and the glowing/dim text draw (SignBlockEntityRenderer). Drives the real Use.blockUse.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07t_fly.js', '07q_effects.js', '09b_sky.js', '07zo_bee.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const { States: S, BlockEntities: BE, World: W, EntityList: EL, Inventory: Iv, Behave: B, Use } = MCL;
MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
BE.init(); W.init(1); B.init(W); EL.init(); if (MCL.Ai && MCL.Ai.init) MCL.Ai.init();
if (Use.init) Use.init(W);
for (let cx = -1; cx < 4; cx++) { const ch = W.makeChunk(cx, 0); ch.state = MCL.CH.GENERATED; W.chunks.set(W.key(cx, 0), ch); }
// DyeColor.getSignColor from the 1.18.2 jar (DyeColor.java)
const JAR = { white: 0xFFFFFF, orange: 0xFF6821, magenta: 0xFF00FF, light_blue: 0x9AC0CD, yellow: 0xFFFF00, lime: 0xBFFF00, pink: 0xFF69B4,
  gray: 0x808080, light_gray: 0xD3D3D3, cyan: 0x00FFFF, purple: 0xA020F0, blue: 0x0000FF, brown: 0x8B4513, green: 0x00FF00, red: 0xFF0000, black: 0 };
const width = (t) => t.length * 6;

function verdict(sab) {
  const bad = [], x = 10, y = 64, z = 10;
  const run = (item, n, creative) => {
    W.setBlock(x, y - 1, z, S.stateOf("stone")); W.setBlock(x, y, z, S.stateOf("oak_sign"));
    const be = BE.get(x, y, z) || BE.create(x, y, z, 'sign'); be.lines = ['hi', '', '', '']; be.color = 'black'; be.glowing = false;
    const P = { x: 10.5, y: 64, z: 12.5, slot: 0, instabuild: !!creative, yaw: 0, mayBuild: true, inventory: Iv.create() };
    Iv.setItem(P.inventory, 0, Iv.stack(item, n, 0));
    const go = () => {
      const held = Iv.getItem(P.inventory, 0), c0 = held.n;
      const r = Use.blockUse(P, x, y, z, W.getBlock(x, y, z), held);
      if (sab === 'unconsumed') held.n = c0;
      return r;
    };
    return { be, P, go, count: () => { const h = Iv.getItem(P.inventory, 0); return Iv.isEmpty(h) ? 0 : h.n; } };
  };
  for (const [d, col] of Object.entries(JAR)) {
    if (d === 'black') continue;
    const t = run(d + '_dye', 3, false);
    if (sab !== 'ignored') t.go();
    if (BE.SIGN_COLORS[d] !== col) bad.push(d + ' sign colour table differs from the jar');
    if (t.be.color !== d) bad.push(d + ' dye did not recolour the sign');
    if (t.count() !== 2) bad.push(d + ' dye did not consume exactly 1, count ' + t.count());
    if (sab !== 'ignored') { const again = t.go(); if (again || t.count() !== 2) bad.push(d + ' same dye twice must consume nothing'); }
  }
  const bk = run('black_dye', 3, false); bk.be.color = 'red'; if (sab !== 'ignored') bk.go(); if (bk.be.color !== 'black') bad.push('black dye did not recolour');
  const g = run('glow_ink_sac', 2, false); if (sab !== 'ignored') g.go();
  if (!g.be.glowing) bad.push('glow ink sac did not set glowing'); if (g.count() !== 1) bad.push('glow ink sac count ' + g.count());
  if (sab !== 'ignored') { g.go(); if (g.count() !== 1) bad.push('glow ink sac on a glowing sign consumed'); }
  const cr = run('glow_ink_sac', 2, true); if (sab !== 'ignored') cr.go();
  if (!cr.be.glowing || cr.count() !== 2) bad.push('creative must set glowing and keep the stack');
  // draw: plain = 0.4 dim, no outline; glowing = full colour with outline
  const lay = (e) => { const l = BE.signTextLayout(e, width); return l[0]; };
  const glowed = Object.assign({}, g.be, { glowing: sab === 'neverdrawn' ? false : true });
  const lg = lay(Object.assign({}, glowed, { color: 'red' })), lp = lay({ lines: ['hi'], color: 'red', glowing: false });
  if (!lg || lg.color !== 0xFF0000 || lg.outline !== 0x660000) bad.push('glowing red must draw full colour with a dim outline');
  if (!lp || lp.color !== 0x660000 || lp.outline !== -1) bad.push('plain red must draw dim without outline');
  return bad;
}
const real = verdict(null); let caught = 0;
const BREAKS = ['ignored', 'unconsumed', 'neverdrawn'];
for (const b of BREAKS) { if (verdict(b).length) caught++; else console.log(' NOT CAUGHT:', b); }
for (const f of real) console.log(' FAIL:', f);
console.log(`signdyecheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
