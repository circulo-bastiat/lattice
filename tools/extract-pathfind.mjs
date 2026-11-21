#!/usr/bin/env node
// extract-pathfind.mjs — s119, `Ai.OWED`'s canPathfindThrough residue (D-637's one stand-in).
//
//   node tools/extract-pathfind.mjs   -> tools/golden/pathfind-land-1.18.2.tsv
//
// `LandPathNodeMaker.getCommonNodeType`'s last test is `!state.canPathfindThrough(world, pos,
// NavigationType.LAND)` -> BLOCKED. The base (`AbstractBlock.canPathfindThrough`) answers LAND
// with `!state.isFullCube(world, pos)` — a slab-shaped or carpet-shaped collider is NOT blocked
// by default — and ~50 block classes override it. This reads, out of `.decomp/` (D-488):
//   1. every `register("name", new SomeBlock(...))` (and the `createXBlock(...)` helpers'
//      own `return new SomeBlock(`) in Blocks.java -> name -> constructed class;
//   2. the class tree of net/minecraft/block/*.java (`extends`);
//   3. each block's rule OWNER = the first class in its chain whose canPathfindThrough body
//      decides LAND (PlantBlock's own body defers LAND to super, so the walk continues past it);
//   4. the owner's LAND answer, classified from the body: `false`, `open` (`$$0.get(OPEN)`),
//      `snow` (`LAYERS) < 5`), `true`, `notlava` (FluidBlock), else `default`.
// Only NON-default rows are written. Closed in both directions: every registered block is
// joined to a class (or named as unjoinable and the run fails), and every overriding class
// is classified (or the run fails).
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BLK = join(ROOT, '.decomp', 'net', 'minecraft', 'block');
const OUT = join(ROOT, 'tools', 'golden', 'pathfind-land-1.18.2.tsv');
if (!existsSync(BLK)) { console.log('extract-pathfind: no .decomp/ here — keeping the committed golden'); process.exit(0); }

export function derive(blkDir) {
  const src = {}, ext = {};
  for (const f of readdirSync(blkDir)) if (f.endsWith('.java')) src[f.slice(0, -5)] = readFileSync(join(blkDir, f), 'utf8');
  for (const [c, s] of Object.entries(src)) {
    const m = s.match(new RegExp('class ' + c + '(?:<[^>]*>)? extends (\\w+)'));
    if (m) ext[c] = m[1];
  }
  const blocks = src.Blocks;
  const helpers = {};
  for (const m of blocks.matchAll(/private static (\w+) (\w+)\([^)]*\)\s*\{([\s\S]*?)\n    \}/g)) {
    const n = m[3].match(/return new (\w+)\(/);
    if (n) helpers[m[2]] = n[1];
  }
  const regs = [];
  for (const m of blocks.matchAll(/register\(\s*"([a-z0-9_]+)",\s*(?:new (\w+)\(|(\w+)\()/g)) {
    const cls = m[2] || helpers[m[3]];
    regs.push([m[1], cls || null, m[3] || null]);
  }
  const body = (c) => {
    const s = src[c]; if (!s) return null;
    const m = s.match(/public boolean canPathfindThrough\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
    return m ? m[1] : null;
  };
  const landRule = (b) => {
    const land = (() => { const m = b.match(/case field_50:\s*return ([^;]+);/); return m ? m[1].trim() : null; })();
    if (land !== null) {
      if (land === 'false') return 'false';
      if (/get\(OPEN\)/.test(land)) return 'open';
      if (/get\(LAYERS\) < 5/.test(land)) return 'snow';
      if (land === 'true') return 'true';
      if (/isFullCube/.test(land)) return 'default';
      return null;
    }
    const t = b.trim();
    if (t === 'return false;') return 'false';
    if (t === 'return true;') return 'true';
    if (/FluidTags\.field_15518/.test(t) && /^return !this\.fluid/.test(t)) return 'notlava';
    if (/NavigationType\.field_51 && !this\.collidable \? true : super\.canPathfindThrough/.test(t)) return 'super';
    return null;
  };
  const owners = {}, unclassified = [];
  const ruleOf = (cls) => {
    let c = cls;
    while (c) {
      const b = body(c);
      if (b !== null) {
        const r = landRule(b);
        if (r === null) { unclassified.push(c); return [null, c]; }
        if (r !== 'super') { owners[c] = r; return [r, c]; }
      }
      c = ext[c];
    }
    return ['default', 'AbstractBlock'];
  };
  const rows = [], unjoined = [];
  for (const [name, cls, helper] of regs) {
    if (!cls) { unjoined.push(name + (helper ? ' via ' + helper : '')); continue; }
    const [r, owner] = ruleOf(cls);
    if (r !== 'default') rows.push([name, r, owner, cls]);
  }
  return { regs, rows, unjoined, unclassified: [...new Set(unclassified)], owners, src, ext };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('extract-pathfind.mjs')) {
  const d = derive(BLK);
  console.log('================ extract-pathfind ================');
  console.log(' registered blocks ... ' + d.regs.length);
  console.log(' non-default rows .... ' + d.rows.length + '  (' + ['false', 'open', 'snow', 'true', 'notlava'].map(r => r + ' ' + d.rows.filter(x => x[1] === r).length).join(', ') + ')');
  console.log(' owner classes ....... ' + Object.keys(d.owners).length);
  let bad = 0;
  if (d.unjoined.length) { console.error(' x unjoined: ' + d.unjoined.slice(0, 10).join(', ')); bad++; }
  if (d.unclassified.length) { console.error(' x unclassified owners: ' + d.unclassified.join(', ')); bad++; }
  if (d.regs.length < 850) { console.error(' x only ' + d.regs.length + ' registrations parsed'); bad++; }
  if (bad) process.exit(1);
  mkdirSync(join(ROOT, 'tools', 'golden'), { recursive: true });
  writeFileSync(OUT, '# block\tland_rule\towner_class\tclass — canPathfindThrough(LAND), non-default rows only (tools/extract-pathfind.mjs, .decomp)\n' +
    d.rows.map(r => r.join('\t')).join('\n') + '\n');
  console.log(' wrote ............... tools/golden/pathfind-land-1.18.2.tsv');
  console.log('==================================================');
}
