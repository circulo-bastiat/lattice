#!/usr/bin/env node
// tools/visfloodcheck.mjs — D-440, queue row 0 item 4: a block under a cactus vanished at
// distance because the section-visibility flood (M.visibility in 05_mesher.js — the Minecraft
// chunk-visibility graph) tested MATERIAL opacity (SR.opaque) instead of the graph's own test
// (SR.visOpaque = solidRender: canOcclude() && a full-cube outline, D-350). A cactus is opaque
// by material (its texture is not see-through) but is NOT a full cube, so it should never block
// the flood the way a wall of stone does — and before this fix it did.
//
//   node tools/visfloodcheck.mjs [--verbose]
//
// Headless: pokes M.scratchBlocks directly (no browser, no world) so this runs in every --fast
// suite pass, not just the browser lane. cullcheck.mjs (browser, pixel-level) is the picture-level
// sibling of this fix; this is the fast, exact, table-level one.
//
// Sections:
//   1. a full plane of cactus does NOT split the section's visibility graph
//   2. the audit — every known inset/non-full block in the roster is NOT a flood occluder,
//      and ordinary full blocks still ARE
//   3. anti-vacuity — flip SR.visOpaque for one state and the flood must show it

import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const fails = [];
const okAv = (c, m) => { if (c) pass++; else fails.push(m); };
const p = (...a) => console.log('   ' + a.join(' '));

console.log('visfloodcheck — D-440, the section-visibility flood must not treat an inset model as a full occluder');

const M = loadEngine({});
const SR = M.States;
M.Mesher.ensureScratch();

function fillAll(stateId) { M.Mesher.scratchBlocks.fill(stateId); }

// ── 1. a full plane of cactus does not disconnect -Y from +Y ──────────────────────────────────
console.log('\n1. a section entirely full of cactus keeps its visibility graph open');
const cactusId = SR.stateOf('cactus');
okAv(cactusId > 0, 'the registry has a cactus state');
fillAll(cactusId);
const maskCactus = M.Mesher.visibility();
okAv(maskCactus === M.Mesher.VIS_ALL, `a section of pure cactus should connect all six faces (mask ${maskCactus.toString(2)}, want ${M.Mesher.VIS_ALL.toString(2)})`);
p(`cactus: mask=${maskCactus.toString(2).padStart(15, '0')}`);

// same volume, ordinary stone: MUST disconnect everything (mask 0), or this test proves nothing
const stoneId = SR.stateOf('stone');
fillAll(stoneId);
const maskStone = M.Mesher.visibility();
okAv(maskStone === 0, `a section of solid stone should connect NOTHING (mask ${maskStone.toString(2)}) — if this fails the test volume itself is broken`);

// ── 2. the audit — every inset model named in the ticket, plus the ordinary blocks that must
//    still occlude, so the fix is table-driven (SR.visOpaque = solidRender) and not a cactus
//    special case ──────────────────────────────────────────────────────────────────────────────
console.log('\n2. the audit — inset models do not occlude the flood; full blocks still do');
const INSET = ['cactus', 'oak_fence', 'cobblestone_wall', 'oak_slab', 'glass_pane', 'torch', 'oak_stairs', 'flower_pot', 'iron_bars'];
const FULL = ['stone', 'dirt', 'oak_planks', 'obsidian', 'sandstone'];
for (const name of INSET) {
  const st = SR.stateOf(name);
  if (st === 0) { p(`(skip: no state for ${name})`); continue; }
  okAv(SR.visOpaque[st] === 0, `${name} is an inset model and must NOT be a flood occluder (visOpaque=${SR.visOpaque[st]})`);
}
for (const name of FULL) {
  const st = SR.stateOf(name);
  if (st === 0) { p(`(skip: no state for ${name})`); continue; }
  okAv(SR.visOpaque[st] === 1, `${name} is a full cube and MUST still occlude the flood (visOpaque=${SR.visOpaque[st]})`);
}
// and the material-opacity table, unchanged: cactus's TEXTURE is still opaque (this fix must not
// touch face-culling, AO or light attenuation, which all read SR.opaque, not SR.visOpaque).
okAv(SR.opaque[cactusId] === 1, 'cactus must stay MATERIAL-opaque (SR.opaque) — this fix only touches the flood test, not face culling/AO/light');

// ── 3. anti-vacuity — break it and watch it fail ───────────────────────────────────────────────
console.log('\n3. anti-vacuity — flip cactus back to a flood occluder and the section must go dark');
const saved = SR.visOpaque[cactusId];
SR.visOpaque[cactusId] = 1;                 // reintroduce D-440 for one state
fillAll(cactusId);
const maskBroken = M.Mesher.visibility();
okAv(maskBroken === 0, `anti-vacuity: with visOpaque[cactus] forced to 1 the flood must connect nothing (got mask ${maskBroken.toString(2)}) — if this passes the check cannot see the bug it exists for`);
SR.visOpaque[cactusId] = saved;              // restore
const maskRestored = M.Mesher.visibility();
okAv(maskRestored === M.Mesher.VIS_ALL, 'restoring visOpaque restores the open graph (sanity, not a second bug hunt)');

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL: ' + f);
process.exit(fails.length ? 1 : 0);
