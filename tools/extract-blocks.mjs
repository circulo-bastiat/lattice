#!/usr/bin/env node
// extract-blocks.mjs — turn Mojang's own data into MC-Lite's block registry.
//
//   node tools/extract-blocks.mjs [--jar path] [--out dir] [--verbose]
//
// Reads every blockstates file, enumerates every state, resolves every model through its
// parent chain, and writes a registry plus a report. Nothing here is hand-written, which is
// the entire point: a generated registry cannot quietly disagree with the real game the way
// a typed one will.
//
// It is also deliberately loud. Every dangling texture reference, missing model and
// unresolved variant is counted and listed, because "it ran" is not the same as "it is
// right", and the failures are where the parity bugs live.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Jar } from './jarlib.mjs';
import {

  resolveModel, parseBlockstate, propertiesOf, enumerateStates,
  placementsFor, classify, texturesUsed, DIRS,
} from './models.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator
// Jars are Dan's own copies of the game and are NOT in the repo (D-6), so their location is a
// property of the machine, not the project. `--jar` still wins; MCLITE_JARS moves the default.
import { existsSync } from 'node:fs';
import { JARS as MCLITE_JARS, MCDATA_PC } from './paths.mjs';
/* MCLITE_JARS now comes from tools/paths.mjs (session 5) */
// Two layouts are accepted, because Dan's jars live in a launcher directory and the build
// machine's live in a flat one: <JARS>/1.18.2.jar and <JARS>/1.18.2/1.18.2.jar. Point
// MCLITE_JARS at a .minecraft `versions` folder and it just works.
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : (existsSync(nested) ? nested : flat);
};


const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.includes('--' + n);

const JAR = opt('jar', jarPath('1.18.2'));
const OUT = opt('out', MCLITE_ROOT + 'assets');
const PC = opt('pc', MCDATA_PC);
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jar = new Jar(JAR);
console.log(`jar: ${JAR}  (${jar.entries.size} entries)`);

// The authoritative property domains. See the note on propertiesOf(): the blockstates file
// is not a reliable witness to its own domains, and the walls are the proof.
const AUTH = new Map();
try {
  const pcb = JSON.parse(readFileSync(join(PC, 'blocks.json'), 'utf8'));
  for (const b of pcb) {
    const m = new Map();
    for (const st of b.states || []) {
      m.set(st.name,
        st.type === 'bool' ? ['true', 'false']
        : st.type === 'enum' ? st.values.map(String)
        : Array.from({ length: st.num_values }, (_, i) => String(i)));
    }
    AUTH.set(b.name, m);
  }
  console.log(`authoritative domains: ${AUTH.size} blocks from ${join(PC, 'blocks.json')}`);
} catch (e) {
  console.log(`⚠ NO AUTHORITATIVE DOMAINS (${e.message}) - falling back to inference.`);
  console.log('   Expect every wall to lose 80% of its state space. See propertiesOf().');
}

const bsFiles = jar.under('assets/minecraft/blockstates/').filter((n) => n.endsWith('.json'));
console.log(`blockstates: ${bsFiles.length}`);

const modelCache = new Map();
const registry = [];
const report = {
  jar: JAR,
  blocks: 0, states: 0, placements: 0,
  modelsResolved: 0, modelsMissing: [], danglingTextures: [], emptyStates: [],
  noAuthority: [],
  shapes: {}, propertyHistogram: {}, texturesUsed: new Set(),
  multipartBlocks: [], stateExplosions: [],
  biggest: [],
};

// ⚠ AIR IS PINNED TO BLOCK INDEX 0 (D-103), and everything else stays alphabetical.
//
// Session 2 made the world store REGISTRY REAL STATE IDS instead of the 49 legacy ids, and a
// real state id is what a section palette entry, the mesher's 18^3 scratch volume and every
// neighbour-padding read now hold. All three are zero-filled typed arrays, and every one of
// them treats a zero as "nothing here". If air were block 16 (which is where the alphabet puts
// it) then state 0 would be `acacia_button[face=ceiling,facing=east,powered=false]`, and a
// section's untouched padding would quietly become a wall of buttons. Pinning air first makes
// realFirst[0] = 0 and air's one and only real state 0, so zero means air by construction
// rather than by a conversion somebody has to remember.
//
// tools/regcheck.mjs asserts this, and breaks it deliberately to prove the assertion works.
const airFirst = (list) => {
  const air = list.filter((f) => f.split('/').pop() === 'air.json');
  const rest = list.filter((f) => f.split('/').pop() !== 'air.json').sort();
  if (air.length !== 1) throw new Error(`expected exactly one air.json in blockstates, found ${air.length}`);
  return [...air, ...rest];
};

for (const file of airFirst(bsFiles)) {
  const name = file.split('/').pop().replace(/\.json$/, '');
  let bs;
  try {
    bs = parseBlockstate(jar.readJson(file));
  } catch (e) {
    report.modelsMissing.push(`${name}: unreadable blockstates (${e.message})`);
    continue;
  }
  if (bs.kind === 'multipart') report.multipartBlocks.push(name);
  if (AUTH.size && !AUTH.has(name)) report.noAuthority.push(name);

  const props = propertiesOf(bs, AUTH.get(name) || null);
  let states;
  try {
    states = enumerateStates(props);
  } catch (e) {
    report.stateExplosions.push(`${name}: ${e.message}`);
    continue;
  }

  const entry = {
    name,
    kind: bs.kind,
    properties: Object.fromEntries([...props].map(([k, v]) => [k, [...v].sort()])),
    stateCount: states.length,
    states: [],
  };

  for (const state of states) {
    const placements = placementsFor(bs, state);
    if (!placements.length) {
      report.emptyStates.push(`${name}[${JSON.stringify(state)}]`);
    }
    const parts = [];
    for (const p of placements) {
      let model;
      try {
        model = resolveModel(jar, p.model, modelCache);
        report.modelsResolved++;
      } catch (e) {
        report.modelsMissing.push(`${name} -> ${p.model}: ${e.message}`);
        continue;
      }
      for (const tex of texturesUsed(model)) report.texturesUsed.add(tex);
      // a face whose texture variable never resolved is a real defect, not a warning
      for (const el of model.elements) {
        for (const d of DIRS) {
          const f = el.faces[d];
          if (f && !f.texture) {
            report.danglingTextures.push(`${name} -> ${p.model} face ${d} = ${f.textureVar}`);
          }
        }
      }
      parts.push({
        model: p.model,
        x: p.x, y: p.y, uvlock: p.uvlock, weight: p.weight,
        shape: classify(model),
        elements: model.elements.length,
        ao: model.ambientocclusion,
      });
      report.placements++;
      report.shapes[classify(model)] = (report.shapes[classify(model)] || 0) + 1;
    }
    entry.states.push({ state, parts });
    report.states++;
  }

  for (const k of Object.keys(entry.properties)) {
    report.propertyHistogram[k] = (report.propertyHistogram[k] || 0) + 1;
  }
  report.biggest.push([name, states.length]);
  registry.push(entry);
  report.blocks++;
}

// ⚠ Item models that parent into a block model can reference textures no BLOCKSTATE ever
// does. Measured 6 Sept 2026: `item/structure_block` -> `block/structure_block` uses the
// texture `block/structure_block`, while the blockstates file only ever uses the four
// `structure_block_<mode>` variants. Missing it left exactly one item in the roster with no
// geometry — a small hole, but the kind that is much cheaper to close here than to explain
// later. The atlas is built from this list, so the list has to be the real union.
{
  let extra = 0;
  for (const f of jar.under('assets/minecraft/models/item/').filter((n) => n.endsWith('.json'))) {
    let chainHasBlock = false, id = f.replace('assets/minecraft/models/', '').replace(/\.json$/, '');
    let cur = id, guard = 0;
    while (cur && guard++ < 16) {
      if (cur.startsWith('block/')) { chainHasBlock = true; break; }
      const path = `assets/minecraft/models/${cur}.json`;
      if (!jar.has(path)) break;
      const m = jar.readJson(path);
      cur = m.parent ? String(m.parent).replace('minecraft:', '') : null;
    }
    if (!chainHasBlock) continue;
    try {
      const model = resolveModel(jar, id, modelCache);
      for (const tex of texturesUsed(model)) {
        if (!report.texturesUsed.has(tex)) { report.texturesUsed.add(tex); extra++; }
      }
    } catch { /* an item model that will not resolve is extract-items' problem to report */ }
  }
  report.itemOnlyTextures = extra;
  console.log(`textures reachable only from item models: ${extra}`);
}

report.biggest.sort((a, b) => b[1] - a[1]);
report.biggest = report.biggest.slice(0, 15);
// ⚠ G10's TEN CRACK STAGES ARE REACHABLE FROM NO MODEL (D-270). `destroy_stage_0..9` are drawn
// by the client over the block you are breaking and are named in Java, not in any blockstate or
// model file — so the model walk above cannot find them and the atlas would ship without them.
// They are added by NAME here, and `tilecheck` asserts all ten are present: a breaking overlay
// with a missing stage is a block that appears to stop cracking half way.
// ⚠ BARE `block/x`, WITHOUT THE `minecraft:` PREFIX. Every other name in this list is bare — the
// model walk strips it — and these ten were forced in with it, so the atlas shipped 791 bare keys
// and ten prefixed ones. `tilecheck` refuses the prefix project-wide and was right to; the
// runtime had grown a second lookup to cope, which is the D-139 shape (one spelling, or two
// implementations of the same thing). One spelling (D-280).
const FORCED = [];
for (let i = 0; i < 10; i++) FORCED.push('block/destroy_stage_' + i);
// #889: the placed conduit's model is `builtin/entity` with only a particle texture, and the block
// model walk drops particle-only textures; the placed row (texroster `conduit|placed`) is added by name.
// #593 -- A BLOCK-ENTITY BLOCK'S MODEL IS `{ textures: { particle } }` AND NOTHING ELSE (the 17 shulker boxes, the
// conduit): the box itself is drawn by its block-entity renderer, so no face names a texture and the walk above
// never sees the particle sprite. It is the sprite the block's break/step particles use, so it ships by name.
for (const n of jar.under('assets/minecraft/textures/block/')) {
  if (/\/(\w+_)?shulker_box\.png$/.test(n)) FORCED.push(n.replace('assets/minecraft/textures/', '').replace(/\.png$/, ''));
}
FORCED.push('block/conduit');
for (const t of FORCED) report.texturesUsed.add(t);
const texList = [...report.texturesUsed].sort();

writeFileSync(join(OUT, 'block-registry.json'), JSON.stringify(registry));
writeFileSync(join(OUT, 'textures-used.json'), JSON.stringify(texList, null, 0));

const summary = {
  ...report,
  texturesUsed: texList.length,
  modelsMissing: report.modelsMissing.slice(0, 40),
  modelsMissingCount: report.modelsMissing.length,
  danglingTextures: report.danglingTextures.slice(0, 40),
  danglingTexturesCount: report.danglingTextures.length,
  emptyStates: report.emptyStates.slice(0, 40),
  emptyStatesCount: report.emptyStates.length,
  multipartBlocks: report.multipartBlocks.length,
  multipartList: report.multipartBlocks,
  ms: Date.now() - t0,
};
writeFileSync(join(OUT, 'extract-report.json'), JSON.stringify(summary, null, 2));

console.log('');
console.log('================ extract-blocks ================');
console.log(` blocks ............ ${report.blocks}`);
console.log(` states ............ ${report.states}`);
console.log(` placements ........ ${report.placements}`);
console.log(` unique models ..... ${modelCache.size}`);
console.log(` textures used ..... ${texList.length}`);
console.log(` multipart blocks .. ${report.multipartBlocks.length}`);
console.log(` no authority ...... ${report.noAuthority.length}  ${report.noAuthority.join(' ')}`);
console.log(` shapes ............ ${Object.entries(report.shapes).map(([k, v]) => `${k}:${v}`).join('  ')}`);
console.log('');
console.log(` biggest state counts: ${report.biggest.map(([n, c]) => `${n}=${c}`).join(', ')}`);
console.log('');
console.log(` models missing .... ${report.modelsMissing.length}`);
console.log(` dangling textures . ${report.danglingTextures.length}`);
console.log(` empty states ...... ${report.emptyStates.length}`);
console.log(` state explosions .. ${report.stateExplosions.length}`);
if (flag('verbose')) {
  for (const m of report.modelsMissing.slice(0, 20)) console.log('   missing: ' + m);
  for (const m of report.danglingTextures.slice(0, 20)) console.log('   dangling: ' + m);
  for (const m of report.emptyStates.slice(0, 20)) console.log('   empty: ' + m);
}
console.log('');
console.log(` ${summary.ms} ms   ->  ${OUT}/block-registry.json`);
console.log('===============================================');

const bad = report.modelsMissing.length + report.stateExplosions.length;
process.exit(bad ? 1 : 0);
