#!/usr/bin/env node
// invisibleblockcheck.mjs — KW-48: blocks turn partly/fully INVISIBLE after breaking blocks,
// while staying solid and breakable (Dan, playing, 27 Sept 2026). docs/archive/KNOWN-WRONG.md KW-48
// names four candidate causes: (1) the section-visibility/occlusion flood not recomputed after
// an edit, (2) a remesh that rebuilds the edited section but not a NEIGHBOUR section when the
// break sits on a section/chunk edge, (3) a mesh-upload race (a stale mesh overwriting a fresh
// one), (4) face culling reading a neighbour's state before its update. AUDIT, don't patch: this
// breaks blocks in the REAL RUNNING GAME (real frame loop, real streamer, real upload queue) at
// every kind of edge a break can land on, and asserts the one thing Dan can see — an exposed
// face of a non-air block must end up in a DRAWN section, not a culled or unmeshed one.
//
//   MCLITE_PRESET=medium node tools/invisibleblockcheck.mjs [dist/mclite.html]

import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0; const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };

const s = await open(FILE, { width: 1024, height: 640 });
if (!s) { console.log('invisibleblockcheck: SKIP — no Chromium on this machine (cdp.mjs found none)'); process.exit(0); }

console.log('invisibleblockcheck — KW-48: does a broken block\'s exposed face stay drawn?');

const ev = (src) => s.evaluate(new Function(src));

try {
  await sleep(1500);
  await ev('if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play(48480); return 1;');
  const up = await s.waitFor(new Function('return (MCL.Hud && MCL.Hud.mode === "game" && MCL.World '
    + '&& MCL.Gfx && MCL.Jobs) ? 1 : 0;'), 90000);
  if (!ok(!!up, 'the world came up')) throw new Error('no world');
  await sleep(4000);

  // A solid stone cube, CHUNK- and SECTION-aligned so relative offsets are real local
  // coordinates: 3 chunks square, 2 full sections tall. Fully enclosed interior blocks draw
  // nothing (correct — vanilla shows the same "solid stone core is invisible" picture), which
  // is the baseline every break below is measured against.
  const setup = await ev(
    'const M = window.MCL, W = M.World, P = M.Player, S = M.States, CFG = M.CFG, SC = M.Section, CH = M.CH;' +
    'const baseY = Math.floor((Math.floor(P.y) + 40 - CFG.WORLD_MIN_Y) / 16) * 16 + CFG.WORLD_MIN_Y;' +
    'const x0 = Math.floor(P.x / 16) * 16, z0 = Math.floor(P.z / 16) * 16;' +
    'const stone = S.stateOf("stone");' +
    'const sy0 = (baseY - CFG.WORLD_MIN_Y) >> 4;' +
    // Fill the two sections directly (S.fill is O(1) on a uniform section) rather than 73,728
    // individual W.setBlock calls — the bulk fill is not what this check is testing; the EDITS
    // below are.
    'for (let ccx = -1; ccx <= 1; ccx++) for (let ccz = -1; ccz <= 1; ccz++) {' +
    '  const cx = (x0 >> 4) + ccx, cz = (z0 >> 4) + ccz;' +
    '  const c = W.getOrCreate(cx, cz);' +
    '  SC.fill(c.sec[sy0], stone); SC.fill(c.sec[sy0 + 1], stone);' +
    '  c.state = CH.GENERATED;' +
    '  c.meshDirty[0] |= (1 << sy0) | (1 << (sy0 + 1));' +
    '}' +
    'return { x0, z0, baseY };'
  );
  ok(typeof setup.baseY === 'number', `a chunk/section-aligned stone cube at (${setup.x0},${setup.baseY},${setup.z0})`);

  // Stand the camera INSIDE the structure, at the boundary between its two sections — Dan is
  // standing next to the block he breaks, and the section-visibility flood's unconditional
  // 3x3x3 seed (10_gfx.js) is centred on the CAMERA's section, not on wherever the player
  // happened to spawn. Without this, "floodHas" tests nothing but distance from spawn.
  const camX = setup.x0 + 8, camZ = setup.z0 + 8, camY = setup.baseY + 16;
  await ev(`const P = window.MCL.Player; P.x = ${camX}; P.z = ${camZ}; P.y = ${camY}; P.ey = ${camY}; return 1;`);

  // Wait for a SPECIFIC set of sections to stop being mesh-dirty and leave the upload queue —
  // not "nothing anywhere is pending", which never goes true: the real game keeps streaming in
  // ordinary terrain around the player the whole time this check runs.
  async function settle(targets, label) {
    let pending = 1;
    for (let i = 0; i < 40 && pending; i++) {
      await sleep(300);
      pending = await ev(
        'const W = window.MCL.World, G = window.MCL.Gfx;' +
        `const targets = ${JSON.stringify(targets)};` +
        'let n = 0;' +
        'for (const t of targets) {' +
        '  const c = W.chunks.get(W.key(t.cx, t.cz));' +
        '  if (!c || (c.meshDirty[0] & (1 << t.sy)) || W.meshJobs.has(W.sectionKey(t.cx, t.cz, t.sy))) { n++; continue; }' +
        '  if (G.uploadQueue.some(function (j) { return j.key === G.sectionKey(t.cx, t.cz, t.sy); })) n++;' +
        '}' +
        'return n;'
      );
    }
    ok(pending === 0, `${label}: the touched sections stopped being mesh-dirty/queued`, `pending=${pending}`);
  }
  const SY0 = await ev(`const CFG = window.MCL.CFG; return (${setup.baseY} - CFG.WORLD_MIN_Y) >> 4;`);
  const initSecTargets = [];
  for (let ccx = -1; ccx <= 1; ccx++) for (let ccz = -1; ccz <= 1; ccz++) {
    const cx = (setup.x0 >> 4) + ccx, cz = (setup.z0 >> 4) + ccz;
    initSecTargets.push({ cx, cz, sy: SY0 }, { cx, cz, sy: SY0 + 1 });
  }
  await settle(initSecTargets, 'initial build');

  // For a section (cx,cz,sy) — is the exposed face Dan would see actually going to be DRAWN?
  // `inMap && quads>0` is candidates 2/3/4 (the mesh itself is wrong or missing); `floodHas` is
  // candidate 1 (the section is meshed correctly but the visibility graph still hides it).
  async function statAt(x, y, z) {
    return ev(
      'const M = window.MCL, W = M.World, G = M.Gfx, CFG = M.CFG;' +
      `const x = ${x}, y = ${y}, z = ${z};` +
      'const cx = x >> 4, cz = z >> 4, sy = (y - CFG.WORLD_MIN_Y) >> 4;' +
      'const c = W.chunks.get(W.key(cx, cz));' +
      'const key = G.sectionKey(cx, cz, sy);' +
      'const m = G.meshes.get(key);' +
      'return { cx, cz, sy, meshedBit: c ? !!(c.meshed[0] & (1 << sy)) : false,' +
      '  inMap: !!m, quads: m ? (m.quads[0] + m.quads[1] + m.quads[2]) : -1,' +
      '  floodHas: G.floodHas(W.camCx, W.camCz, cx, cz, sy), vis: c ? c.vis[sy] : -1 };'
    );
  }
  async function breakBlock(x, y, z) {
    await ev(`window.MCL.World.setBlock(${x},${y},${z},0); return 1;`);
  }

  // ── the break scenarios ─────────────────────────────────────────────────────────────────
  const o = setup;
  const scen = [
    { name: 'interior (same-section neighbours only)', x: o.x0 + 8, y: o.baseY + 8, z: o.z0 + 8 },
    { name: 'Y section edge (top of the lower section)', x: o.x0 + 8, y: o.baseY + 15, z: o.z0 + 8 },
    { name: 'X chunk edge (west face of the middle chunk)', x: o.x0 + 15, y: o.baseY + 8, z: o.z0 + 8 },
    { name: 'Z chunk edge', x: o.x0 + 8, y: o.baseY + 8, z: o.z0 + 15 },
    { name: 'section+chunk CORNER (diagonal neighbour)', x: o.x0 + 15, y: o.baseY + 15, z: o.z0 + 15 }
  ];

  // Every neighbour position (world coords, still inside the built cube) a break at (x,y,z)
  // could expose a NEW face into, mirroring exactly the 3x3x3 dirty rule in W.setBlock.
  function neighbourPts(x, y, z) {
    const lx = ((x % 16) + 16) % 16, ly = ((y - o.baseY) % 16 + 16) % 16, lz = ((z % 16) + 16) % 16;
    const dxs = [0]; if (lx === 0) dxs.push(-16); if (lx === 15) dxs.push(16);
    const dys = [0]; if (ly === 0) dys.push(-16); if (ly === 15) dys.push(16);
    const dzs = [0]; if (lz === 0) dzs.push(-16); if (lz === 15) dzs.push(16);
    const pts = [];
    for (const dx of dxs) for (const dy of dys) for (const dz of dzs) {
      const ny = y + dy;
      if (ny < o.baseY || ny >= o.baseY + 32) continue;   // genuine sky above the cube — skip
      pts.push({ x: x + dx, y: ny, z: z + dz, neighbour: !!(dx || dy || dz) });
    }
    return pts;
  }

  for (const sc of scen) {
    console.log(`\n${sc.name} — break (${sc.x},${sc.y},${sc.z})`);
    const pts = neighbourPts(sc.x, sc.y, sc.z);
    const targets = pts.map((p) => ({ cx: p.x >> 4, cz: p.z >> 4, sy: (p.y - o.baseY + SY0 * 16) >> 4 }));
    await breakBlock(sc.x, sc.y, sc.z);
    await settle(targets, '  after break');
    for (const p of pts) {
      const st = await statAt(p.x, p.y, p.z);
      const where = `section (${st.cx},${st.cz},sy${st.sy})${p.neighbour ? ' [neighbour]' : ''}`;
      ok(st.meshedBit === st.inMap, `${where}: meshed bit matches the upload map`, JSON.stringify(st));
      ok(st.inMap && st.quads > 0, `${where}: has an uploaded mesh with geometry`, JSON.stringify(st));
      ok(st.floodHas, `${where}: the visibility flood says it is visible from where the camera is`, JSON.stringify(st));
    }
  }

  // ── a race: two edits close together, before the first settles ─────────────────────────────
  console.log('\nrace — two edits landing before either settles (D-517\'s scenario)');
  {
    const p1 = { x: o.x0 + 20, y: o.baseY + 8, z: o.z0 + 20 };
    const p2 = { x: o.x0 + 20, y: o.baseY + 8, z: o.z0 + 21 };
    await breakBlock(p1.x, p1.y, p1.z);
    // no settle — fire the second edit into the SAME section while the first mesh job may
    // still be in flight
    await breakBlock(p2.x, p2.y, p2.z);
    const raceTargets = [{ cx: p1.x >> 4, cz: p1.z >> 4, sy: SY0 }];
    await settle(raceTargets, '  after the race');
    for (const p of [p1, p2]) {
      const st = await statAt(p.x, p.y, p.z);
      ok(st.inMap && st.quads > 0, `race section (${st.cx},${st.cz},sy${st.sy}) converged to a real mesh`, JSON.stringify(st));
      ok(st.floodHas, `race section (${st.cx},${st.cz},sy${st.sy}) is visible`, JSON.stringify(st));
    }
    // both breaks must actually be gone (world data correct — Dan's report is a render bug, not
    // a data bug, so this is the control that says the WORLD agrees the blocks are broken)
    const gone = await ev(
      `const W = window.MCL.World;` +
      `return (W.getBlock(${p1.x},${p1.y},${p1.z}) === 0) && (W.getBlock(${p2.x},${p2.y},${p2.z}) === 0);`
    );
    ok(gone === true, 'both raced breaks are air in the world data');
  }

  // ── anti-vacuity: prove this check CAN see a section wrongly withheld from the draw list ──
  console.log('\nanti-vacuity — force a mesh to go stale and confirm the check catches it');
  {
    const p = { x: o.x0 + 9, y: o.baseY + 9, z: o.z0 + 9 };
    const before = await statAt(p.x, p.y, p.z);
    ok(before.inMap, 'sanity: the probe section starts meshed', JSON.stringify(before));
    await breakBlock(p.x, p.y, p.z);
    await settle([{ cx: p.x >> 4, cz: p.z >> 4, sy: SY0 }], '  after probe break');
    // pre-fix KW-48 shape, forced by hand: the pipeline runs, but the mesh it ends up holding
    // is emptied out from under it — this is what "meshed the wrong/no geometry" looks like.
    await ev(
      'const M = window.MCL, G = M.Gfx, CFG = M.CFG;' +
      `const cx = ${p.x} >> 4, cz = ${p.z} >> 4, sy = (${p.y} - CFG.WORLD_MIN_Y) >> 4;` +
      'const key = G.sectionKey(cx, cz, sy); const m = G.meshes.get(key); if (m) m.quads = [0, 0, 0];' +
      'return 1;'
    );
    const forced = await statAt(p.x, p.y, p.z);
    ok(forced.quads === 0, 'BREAK: the forced-stale mesh reads as empty', JSON.stringify(forced));
    // this check's own assertion shape (inMap && quads>0) must call THAT a failure
    ok(!(forced.inMap && forced.quads > 0), 'BREAK: this check\'s own assertion correctly reads the forced staleness as a failure');
  }

  const errs = s.problems || [];
  ok(errs.length === 0, 'the page logged no errors (' + errs.slice(0, 3).join(' | ') + ')');
} finally {
  await s.close();
}

console.log('');
console.log('================ invisibleblockcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 40)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
