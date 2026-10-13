#!/usr/bin/env node
// lightemitcheck.mjs — #358: an emitter's own light survives a neighbour's removal (vanilla
// ChunkBlockLightProvider.recalculateLevel starts every cell at its own luminance).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['08_lighting.js'] });
const SR = MCL.States, L = MCL.Light;
const TORCH = SR.stateOf('torch'), GLOW = SR.stateOf('glowstone'), RTORCH = SR.stateOf('redstone_torch');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function world(noEmitOnRemove) {
  const blocks = new Map(), light = new Map();
  const k = (x, y, z) => x + ',' + y + ',' + z;
  const w = { removing: false };
  w.adapter = {
    block: (x, y, z) => blocks.get(k(x, y, z)) || 0,
    get: (x, y, z, ch) => { const b = light.get(k(x, y, z)) || 0; return ch === L.SKY ? b >>> 4 : b & 15; },
    set: (x, y, z, ch, lv) => { const b = light.get(k(x, y, z)) || 0; light.set(k(x, y, z), ch === L.SKY ? (lv << 4) | (b & 15) : (b & 0xF0) | lv); },
    opaque: (st) => SR.lightSolid[st] === 1,
    atten: (st) => SR.atten[st],
    emit: (st) => (noEmitOnRemove && w.removing) ? 0 : SR.emit[st],
    loaded: (x, y, z) => x >= -20 && x <= 20 && y >= 0 && y <= 20 && z >= -20 && z <= 20,
  };
  w.put = (x, y, z, st) => { blocks.set(k(x, y, z), st); L.queueEdit(x, y, z); L.settle(); };
  w.blk = (x, y, z) => w.adapter.get(x, y, z, L.BLOCK);
  return w;
}

function scenario(broken) {
  const w = world(broken);
  L.init(); L.setAdapter(w.adapter);
  w.put(0, 5, 0, TORCH);
  w.put(1, 5, 0, GLOW);
  const pre = [w.blk(0, 5, 0), w.blk(-1, 5, 0), w.blk(-3, 5, 0)];
  w.removing = true;
  w.put(1, 5, 0, 0);
  const post = [w.blk(0, 5, 0), w.blk(-1, 5, 0), w.blk(-3, 5, 0)];
  // redstone torch (7) seven cells from a torch that is then broken
  w.removing = false;
  w.put(8, 5, 0, RTORCH);
  w.removing = true;
  w.put(0, 5, 0, 0);
  const rs = [w.blk(8, 5, 0), w.blk(7, 5, 0)];
  return { pre, post, rs };
}

const g = scenario(false);
ok(g.post.join() === '14,13,11', 'torch beside a removed glowstone keeps 14/13/11, got ' + g.post);
ok(g.rs.join() === '7,6', 'redstone torch survives torch removal 7/6, got ' + g.rs);
const b = scenario(true);
breaks++;
if (b.post.join() !== '14,13,11' || b.rs.join() !== '7,6') console.log('   ✓ break caught: emitter re-seed removed');
else fails.push('anti-vacuity: emitter re-seed removed was not caught');
console.log(`\n${pass} checks passed, ${fails.length} failed`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
