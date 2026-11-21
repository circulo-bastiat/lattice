#!/usr/bin/env node
// lightstatecheck.mjs — #357: light opacity is per STATE and light may not cross a covered face.
//
//   1. per-state opacity (AbstractBlock.getOpacity: isOpaqueFullCube ? 15 : isTranslucent ? 0 : 1, with
//      Block.isTranslucent = !fullCube && fluid empty): named rows + sweeps over every real state.
//   2. the face-shape rule (ChunkLightProvider.getStateForLighting / getPropagatedLevel): sealed rooms
//      roofed with bottom, top and double slabs and upside-down stairs are DARK inside; a waterlogged
//      slab under open sky drops 15 to 14 straight below it.
// Anti-vacuity: drop the face test / the per-state table and each row must fail ("<n> breaks caught").

import { loadEngine } from './loadsrc.mjs';

const MCL = loadEngine({ extra: ['08_lighting.js'] });
const SR = MCL.States, L = MCL.Light, R = MCL.Reg;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const P = R.PROP, V = R.PVAL;
function st(name, props = {}) {
  let s = SR.stateOf(name);
  ok(s > 0, `unknown block ${name}`);
  for (const [k, v] of Object.entries(props)) s = SR.withProp(s, P[k], V[v]);
  return s;
}
const STONE = st('stone');

// ── 1. per-state opacity ──────────────────────────────────────────────────────────────────────
function opacityRows() {
  const rows = [
    ['double oak_slab', st('oak_slab', { type: 'double' }), 15],
    ['bottom oak_slab', st('oak_slab', { type: 'bottom' }), 0],
    ['top oak_slab', st('oak_slab', { type: 'top' }), 0],
    ['snow layers=8', st('snow', { layers: '8' }), 15],
    ['snow layers=7', st('snow', { layers: '7' }), 0],
    ['waterlogged bottom oak_slab', st('oak_slab', { type: 'bottom', waterlogged: 'true' }), 1],
    ['waterlogged double oak_slab', st('oak_slab', { type: 'double', waterlogged: 'true' }), 15],
    ['waterlogged oak_stairs', st('oak_stairs', { waterlogged: 'true' }), 1],
    ['dry oak_stairs', st('oak_stairs', { waterlogged: 'false' }), 0],
    ['waterlogged cobblestone_wall', st('cobblestone_wall', { waterlogged: 'true' }), 1],
    ['dry cobblestone_wall', st('cobblestone_wall', { waterlogged: 'false' }), 0],
    ['waterlogged oak_fence', st('oak_fence', { waterlogged: 'true' }), 1],
    ['waterlogged glass_pane', st('glass_pane', { waterlogged: 'true' }), 1],
    ['dry sea_pickle', st('sea_pickle', { waterlogged: 'false' }), 0],
    ['waterlogged sea_pickle', st('sea_pickle', { waterlogged: 'true' }), 1],
    ['stone', STONE, 15],
  ];
  for (const [n, s, want] of rows) ok(SR.atten[s] === want, `${n}: atten ${SR.atten[s]} want ${want}`);
  ok(SR.lightSolid[st('oak_slab', { type: 'double' })] === 1, 'double slab lightSolid');
  ok(SR.lightSolid[st('snow', { layers: '8' })] === 1, 'snow 8 lightSolid');
  ok(SR.lightSolid[st('oak_slab', { type: 'bottom' })] === 0, 'bottom slab not lightSolid');
  // sweeps: every waterlogged state has a fluid, so opacity >= 1; every double slab is 15
  let wl = 0, dbl = 0;
  for (let s = 1; s < SR.count; s++) {
    if (SR.propValue(s, P.waterlogged) === V['true'] && SR.atten[s] < 15) { wl++; ok(SR.atten[s] >= 1, `waterlogged ${R.names[SR.block[s]]} state ${s} atten 0`); }
    if (R.names[SR.block[s]].endsWith('_slab') && SR.propValue(s, P.type) === V.double) { dbl++; ok(SR.atten[s] === 15, `double ${R.names[SR.block[s]]} atten ${SR.atten[s]}`); }
  }
  ok(wl > 500 && dbl >= 30, `sweeps too small (${wl}, ${dbl})`);
}

// ── 2. rooms ──────────────────────────────────────────────────────────────────────────────────
function world() {
  const blocks = new Map(), light = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const w = {
    set: (x, y, z, s) => blocks.set(key(x, y, z), s),
    ad: {
      block: (x, y, z) => blocks.get(key(x, y, z)) || 0,
      get: (x, y, z, ch) => { const b = light.get(key(x, y, z)) || 0; return ch === L.SKY ? b >>> 4 : b & 15; },
      set: (x, y, z, ch, lv) => { const b = light.get(key(x, y, z)) || 0; light.set(key(x, y, z), ch === L.SKY ? (lv << 4) | (b & 15) : (b & 0xF0) | lv); },
      opaque: (s) => SR.lightSolid[s] === 1,
      atten: (s) => SR.atten[s],
      side: (s) => SR.sideMask ? SR.sideMask[s] : 0,
      emit: (s) => SR.emit[s],
      loaded: (x, y, z) => x >= -2 && x <= 10 && z >= -2 && z <= 10 && y >= 0 && y <= 14,
    },
    sky: (x, y, z) => w.ad.get(x, y, z, L.SKY),
  };
  return w;
}
// sealed stone room x,z 0..8, floor y=2, roof layer y=8 of `roof` inside a stone rim, open sky above y>8
function roomLight(roof, probeY = 7) {
  const w = world();
  for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) {
    const edge = x === 0 || x === 8 || z === 0 || z === 8;
    w.set(x, 2, z, STONE); w.set(x, 8, z, edge ? STONE : roof);   // stone rim: light may only enter through the roof's faces
    if (edge) for (let y = 3; y <= 7; y++) w.set(x, y, z, STONE);
  }
  L.init(); L.setAdapter(w.ad);
  for (let x = -2; x <= 10; x++) for (let z = -2; z <= 10; z++) for (let y = 9; y <= 14; y++) { w.ad.set(x, y, z, L.SKY, 15); L.seed(x, y, z, 15, L.SKY); }
  L.settle();
  return w.sky(4, probeY, 4);
}
function faceRows() {
  const roofs = [
    ['bottom oak_slab', st('oak_slab', { type: 'bottom' })],
    ['top oak_slab', st('oak_slab', { type: 'top' })],
    ['double oak_slab', st('oak_slab', { type: 'double' })],
    ['upside-down oak_stairs', st('oak_stairs', { half: 'top' })],
    ['bottom oak_stairs', st('oak_stairs', { half: 'bottom' })],
  ];
  const got = [];
  for (const [n, r] of roofs) { const v = roomLight(r); got.push([n, v]); ok(v === 0, `room roofed with ${n}: sky ${v} inside, vanilla 0`); }
  ok(roomLight(st('glass')) > 0, 'control: a glass roof lets light in');
  // waterlogged slab under open sky: 15 above, 14 straight below
  const w = world();
  w.set(4, 8, 4, st('oak_slab', { type: 'bottom', waterlogged: 'true' }));
  L.init(); L.setAdapter(w.ad);
  for (let x = -2; x <= 10; x++) for (let z = -2; z <= 10; z++) for (let y = 9; y <= 14; y++) { w.ad.set(x, y, z, L.SKY, 15); L.seed(x, y, z, 15, L.SKY); }
  // the column under the slab starts from open sky beside it, as in a real world
  L.settle();
  const under = [w.sky(4, 7, 4), w.sky(4, 6, 4)];
  ok(under[0] <= 14, `under a waterlogged slab sky ${under[0]}, vanilla <= 14`);
  return got;
}

opacityRows();
faceRows();

// ── anti-vacuity ──────────────────────────────────────────────────────────────────────────────
let breaks = 0;
function broke(label, fn) {
  const before = fails.length, p0 = pass;
  fn();
  const caught = fails.length > before;
  pass = p0; fails.length = before;
  ok(caught, `ANTI-VACUITY: "${label}" was not caught`);
  if (caught) breaks++;
  console.log(`   ${caught ? '✓' : '✗'} ${label}`);
}
broke('no face test (sideMask dropped)', () => { const m = SR.sideMask; SR.sideMask = null; faceRows(); SR.sideMask = m; });
broke('per-block opacity (double slab / snow 8 / waterlog reset)', () => {
  const a = SR.atten.slice(), ls = SR.lightSolid.slice();
  for (const s of [st('oak_slab', { type: 'double' }), st('snow', { layers: '8' })]) { SR.atten[s] = 0; SR.lightSolid[s] = 0; }
  SR.atten[st('oak_slab', { type: 'bottom', waterlogged: 'true' })] = 0;
  opacityRows(); SR.atten.set(a); SR.lightSolid.set(ls);
});
broke('double slab roof lets light through', () => {
  const a = SR.atten.slice(), ls = SR.lightSolid.slice(), s = st('oak_slab', { type: 'double' });
  SR.atten[s] = 0; SR.lightSolid[s] = 0; faceRows(); SR.atten.set(a); SR.lightSolid.set(ls);
});

console.log('\n================ lightstatecheck ==============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('===============================================');
process.exit(fails.length || breaks < 3 ? 1 : 0);
