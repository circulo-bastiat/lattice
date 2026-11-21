#!/usr/bin/env node
// extract-placement.mjs — each block's `getPlacementState` FACING/ROTATION/SHAPE rule, OUT OF .decomp (cloud unit
// zealous-dirac, item referee-placement, D-773 "ported, not hand-made").
//
//   node tools/extract-placement.mjs          # suite stage: re-derives and fails if the committed golden drifted
//   node tools/extract-placement.mjs --write  -> tools/golden/place-facing-1.18.2.tsv
//
// The rule lives on the block CLASS, so each registered block follows its class chain (extract-pathfind.mjs's parser of
// Blocks.java) to the nearest `getPlacementState(ItemPlacementContext)` body, which is classified into ONE token that
// 14_player.js's `P.placementState` applies (placerefcheck judges it against the real server):
//   look · away · cw        horizontal getPlayerFacing() / .getOpposite() / .rotateYClockwise()
//   look6 · away6           getPlayerLookDirection() (6-way, pitch counts) / its opposite
//   floorlook               WallMountedBlock/BellBlock: a floor or ceiling click faces getPlayerFacing() (a side click is the wall's)
//   side · endrod · hopper  the clicked face: getSide() · EndRodBlock's flip against a same-facing rod · HopperBlock (side's opposite, vertical -> down)
//   rot180 · rot0           ROTATION = floor((180 + yaw) * 16/360 + .5) & 15 (sign, banner) · floor(yaw * 16/360 + .5) & 15 (skull)
//   rail · vine             AbstractRailBlock's shape from the facing axis · VineBlock's first placement direction
// A body matching none of these writes no row: that block keeps the engine's default (never a guess).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from './extract-pathfind.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BLK = join(ROOT, '.decomp', 'net', 'minecraft', 'block');
const OUT = join(ROOT, 'tools', 'golden', 'place-facing-1.18.2.tsv');
if (!existsSync(BLK)) { console.log('extract-placement: no .decomp/ here — keeping the committed golden'); process.exit(0); }

// FACING expressions with a local variable resolved to its assignment (`Direction $$4 = $$0.getPlayerFacing();`).
function facingExprs(b) {
  const vars = {};
  for (const m of b.matchAll(/(?<![\w$])(\$\$\d+) = ([^;]+);/g)) vars[m[1]] = m[2].trim();
  const out = [];
  for (const m of b.matchAll(/\.with\(\s*FACING\s*,\s*/g)) {
    let i = m.index + m[0].length, depth = 0, e = '';
    for (; i < b.length; i++) { const ch = b[i]; if (ch === '(') depth++; else if (ch === ')') { if (depth === 0) break; depth--; } e += ch; }
    e = e.replace(/\s+/g, ' ').trim();
    out.push(vars[e] !== undefined ? vars[e] : e);
  }
  return out;
}
export function classify(b) {
  if (/getPlayerLookDirection\(\)\.getOpposite\(\)\.getOpposite\(\)/.test(b)) return 'look6';
  if (/FACING, \$\$0\.getPlayerLookDirection\(\)\.getOpposite\(\)\)/.test(b)) return 'away6';
  if (/ROTATION,[^\n]*\(180\.0F \+ \$\$0\.getPlayerYaw\(\)\) \* 16\.0F \/ 360\.0F/.test(b)) return 'rot180';
  if (/ROTATION,[^\n]*\(\$\$0\.getPlayerYaw\(\) \* 16\.0F \/ 360\.0F\)/.test(b)) return 'rot0';
  if (/FACING, \$\$0\.getPlayerFacing\(\)\.rotateYClockwise\(\)\)/.test(b)) return 'cw';
  if (/getSide\(\)\.getOpposite\(\);[\s\S]*Axis\.field_11052 \? Direction\.field_11033 : \$\$1/.test(b)) return 'hopper';
  if (/getShapeProperty\(\), \$\$5 \? RailShape\.field_12674 : RailShape\.field_12665/.test(b)) return 'rail';   // 12674 EAST_WEST
  if (/isOf\(this\) && \$\$2\.get\(FACING\) == \$\$1 \? this\.getDefaultState\(\)\.with\(FACING, \$\$1\.getOpposite\(\)\)/.test(b)) return 'endrod';
  if (/getFacingProperty\(\$\$4\)/.test(b) && /getPlacementDirections/.test(b)) return 'vine';
  const f = facingExprs(b);
  if (f.length === 2 && /\.with\((FACE|ATTACHMENT),/.test(b) && f[0] === '$$0.getPlayerFacing()') return 'floorlook';
  if (f.length !== 1) return null;
  if (f[0] === '$$0.getSide()') return 'side';
  if (f[0] === '$$0.getPlayerFacing()') return 'look';
  if (f[0] === '$$0.getPlayerFacing().getOpposite()') return 'away';
  return null;
}
const d = derive(BLK);
const body = (c) => { const s = d.src[c]; const m = s && s.match(/public BlockState getPlacementState\(ItemPlacementContext[^)]*\)\s*\{([\s\S]*?)\n    \}/); return m ? m[1] : null; };
const rows = [], bad = [];
for (const [name, cls] of d.regs) {
  if (!cls) continue;
  for (let c = cls; c && c !== 'AbstractBlock'; c = d.ext[c]) {
    const b = body(c); if (b === null) continue;
    const r = classify(b);
    if (r) rows.push([name, r, c]);
    break;
  }
}
console.log('=============== extract-placement ===============');
console.log(' registered blocks ... ' + d.regs.length);
const kinds = [...new Set(rows.map((r) => r[1]))].sort();
console.log(' rule rows ........... ' + rows.length + '  (' + kinds.map((k) => k + ' ' + rows.filter((x) => x[1] === k).length).join(', ') + ')');
// Anchors: one block per rule, each read off its class body by hand once (D-30: a parser that drifts is caught here).
const want = { observer: 'look6', piston: 'away6', dispenser: 'away6', barrel: 'away6', oak_sign: 'rot180', white_banner: 'rot180',
  skeleton_skull: 'rot0', anvil: 'cw', hopper: 'hopper', rail: 'rail', powered_rail: 'rail', end_rod: 'endrod', vine: 'vine',
  stone_button: 'floorlook', grindstone: 'floorlook', lever: 'floorlook', bell: 'floorlook', shulker_box: 'side',
  lightning_rod: 'side', oak_fence_gate: 'look', oak_stairs: 'look', campfire: 'look', furnace: 'away', loom: 'away' };
for (const [n, r] of Object.entries(want)) { const row = rows.find((x) => x[0] === n); if (!row || row[1] !== r) bad.push(`anchor ${n}: ${row ? row[1] : 'missing'}, want ${r}`); }
for (const n of ['stone', 'oak_log', 'oak_slab', 'wall_torch']) if (rows.some((x) => x[0] === n)) bad.push(`anchor ${n} listed, want absent`);
// Anti-vacuity: the classifier must refuse a body it does not know, and must tell a facing from its opposite.
let breaks = 0;
if (classify('return this.getDefaultState().with(FACING, $$0.getPlayerFacing().getOpposite().rotateYClockwise());') === null) breaks++; else bad.push('break: an unknown body was classified');
if (classify('return this.getDefaultState().with(FACING, $$0.getPlayerFacing().getOpposite());') === 'away') breaks++; else bad.push('break: away not told from look');
if (d.regs.length < 850) bad.push('only ' + d.regs.length + ' registrations parsed');
if (bad.length) { for (const b of bad) console.error(' x ' + b); process.exit(1); }
const text = '# block\trule\towner_class — getPlacementState facing rule (tools/extract-placement.mjs, .decomp)\n' + rows.map((r) => r.join('\t')).join('\n') + '\n';
if (process.argv.includes('--write')) {
  mkdirSync(join(ROOT, 'tools', 'golden'), { recursive: true });
  writeFileSync(OUT, text);
  console.log(' wrote ............... tools/golden/place-facing-1.18.2.tsv');
} else if (!existsSync(OUT) || readFileSync(OUT, 'utf8').replace(/\r/g, '') !== text) {
  console.error(' x the committed golden differs from .decomp — run node tools/extract-placement.mjs --write'); process.exit(1);
}
console.log(' assertions passed .... ' + (Object.keys(want).length + 4 + 1));
console.log(' breaks caught ........ ' + breaks);
