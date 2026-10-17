#!/usr/bin/env node
// texrostercheck.mjs — #592 (KW-49-2, part of #579 / GATE M): the texture roster + audit harness.
//
// MEASUREMENT ONLY. It builds the roster straight from the 1.18.2 jar — every item model and every
// block (blockstate model) with its model SOURCE (block model / generated item / builtin-entity) —
// and audits each entry per VIEW (gui, firstperson_righthand, thirdperson_righthand, ground, fixed,
// placed) against what MC-Lite shipped into assets/ (item-registry, block-registry, both atlases):
//
//   texture present ....... every texture the model chain names exists in the jar (1.13.2 first, D-6)
//   in the atlas .......... and has a slot in the atlas the view draws from
//   atlas region .......... the slot the registry uses for the item is the one the model names, and the
//                           slot's PIXELS are that texture's (frame 0, 16x16)
//   no missing pixels ..... the slot is not the generated magenta/black checker (layer 0), nor blank
//   display transform ..... the registry's gui/hand/hand3/ground/fixed = the model JSON chain's
//
// The failing entries are printed grouped by CAUSE (and written to
// assets/texture-audit.md, GENERATED) so the next units under #579 are sized by cause. A suite row that
// fails cannot print its breaks, so today's failures are a pinned baseline (ratchet, see below). Needs the build stages first:
//   node tools/suite.mjs --fast --only extract-blocks,build-atlas,extract-items,pack-models,merge-constants
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar } from './paths.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const J = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
for (const f of ['item-registry.json', 'block-registry.json', 'atlas-index.json', 'atlas.png', 'item-atlas-index.json', 'item-atlas.png']) {
  if (!existsSync(join(ASSETS, f))) { console.log('texrostercheck: assets/' + f + ' missing — run the build stages listed in this file\'s header'); process.exit(2); }
}
const jarNew = new Jar(requireJar('1.18.2'));
const jarOld = new Jar(requireJar('1.13.2'));
const VIEWS = ['gui', 'firstperson_righthand', 'thirdperson_righthand', 'ground', 'fixed', 'placed'];
const REG_KEY = { gui: 'gui', firstperson_righthand: 'hand', thirdperson_righthand: 'hand3', ground: 'ground', fixed: 'fixed' };
const strip = (id) => id.replace(/^minecraft:/, '');

// ── model chain resolution, out of the jar ────────────────────────────────────────────────────────
const modelCache = new Map();
function loadModel(id) {
  id = strip(id);
  if (modelCache.has(id)) return modelCache.get(id);
  const p = 'assets/minecraft/models/' + id + '.json';
  const m = jarNew.has(p) ? jarNew.readJson(p) : null;
  modelCache.set(id, m);
  return m;
}
/** the chain child -> root, plus what it reaches: 'generated' | 'entity' | 'block' */
function resolve(id) {
  const chain = []; let source = 'block';
  for (let cur = strip(id), n = 0; cur && n < 32; n++) {
    if (cur === 'builtin/generated') { source = 'generated'; break; }
    if (cur === 'builtin/entity') { source = 'entity'; break; }
    const m = loadModel(cur);
    if (!m) { chain.missing = cur; break; }
    chain.push(m); cur = m.parent ? strip(m.parent) : null;
  }
  const textures = {}; let elements = null; const display = {};
  for (let i = chain.length - 1; i >= 0; i--) {   // root first, children override
    Object.assign(textures, chain[i].textures || {});
    Object.assign(display, chain[i].display || {});
    if (chain[i].elements) elements = chain[i].elements;
  }
  if (chain.length && !chain[0].parent && chain.some((m) => m.elements)) source = 'block';
  return { chain, source, textures, elements, display, missing: chain.missing || null };
}
const deref = (t, tex) => { for (let n = 0; typeof t === 'string' && t[0] === '#' && n < 16; n++) t = tex[t.slice(1)]; return typeof t === 'string' && t[0] !== '#' ? strip(t) : null; };
/** every texture the model draws with: generated layerN, or the elements' faces (+ particle for blocks) */
function drawn(r) {
  const out = new Set(); let unresolved = 0;
  if (r.source === 'generated') { for (const k of Object.keys(r.textures)) if (/^layer\d+$/.test(k)) { const t = deref(r.textures[k], r.textures); t ? out.add(t) : unresolved++; } }
  else if (r.source === 'block') {
    for (const e of r.elements || []) for (const f of Object.values(e.faces || {})) { const t = deref(f.texture, r.textures); t ? out.add(t) : unresolved++; }
    if (!(r.elements || []).length && r.textures.particle) { const t = deref(r.textures.particle, r.textures); if (t) out.add(t); }
  }
  return { tex: [...out], unresolved };
}

// ── textures: jar bytes and atlas tiles ───────────────────────────────────────────────────────────
const pngCache = new Map();
function srcPng(id) {
  if (pngCache.has(id)) return pngCache.get(id);
  const p = 'assets/minecraft/textures/' + id + '.png'; let img = null;
  for (const j of [jarOld, jarNew]) if (!img && j.has(p)) { try { img = decodePng(j.read(p)); } catch { img = null; } }
  pngCache.set(id, img); return img;
}
const same = (a, b) => { for (let i = 0; i < 1024; i += 4) { if (a[i + 3] !== b[i + 3]) return false; if (a[i + 3] && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) return false; } return true; };
function loadAtlas(indexFile, pngFile) {
  const idx = J(indexFile), img = decodePng(readFileSync(join(ASSETS, pngFile)));
  const tile = (i) => { const T = idx.tile, cx = (i % idx.cols) * T, cy = Math.floor(i / idx.cols) * T, o = Buffer.alloc(T * T * 4);
    for (let y = 0; y < T; y++) Buffer.from(img.data.subarray(((cy + y) * img.width + cx) * 4, ((cy + y) * img.width + cx + T) * 4)).copy(o, y * T * 4); return o; };
  return { index: idx.index, tile, cols: idx.cols };
}
const CHECKER = (() => { const b = Buffer.alloc(1024); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const on = ((x >> 3) ^ (y >> 3)) & 1, o = (y * 16 + x) * 4; b[o] = on ? 255 : 32; b[o + 1] = 0; b[o + 2] = on ? 255 : 32; b[o + 3] = 255; } return b; })();
const blockAtlas = loadAtlas('atlas-index.json', 'atlas.png');
const itemAtlas = loadAtlas('item-atlas-index.json', 'item-atlas.png');
const mulTile = new Map();
const tileOf = (atlas, i) => { const k = atlas.cols + ':' + i + ':' + (atlas === itemAtlas); if (!mulTile.has(k)) mulTile.set(k, atlas.tile(i)); return mulTile.get(k); };

// ── the audit: (ctx) -> [{ name, source, view, cause, detail }] ───────────────────────────────────
const cmp = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const norm = (t) => t ? { rotation: t.rotation || [0, 0, 0], translation: t.translation || [0, 0, 0], scale: t.scale || [1, 1, 1] } : null;

function textureFindings(name, source, views, texs, atlas, index) {
  const out = []; const add = (cause, detail) => { for (const view of views) out.push({ name, source, view, cause, detail }); };
  for (const t of texs) {
    const src = srcPng(t);
    if (!src) { add('texture-not-in-jar', t); continue; }
    const slot = index[t];
    if (slot === undefined) { add('texture-not-in-atlas', t); continue; }
    if (slot === 0 && atlas === blockAtlas) { add('atlas-slot-is-missing-texture', t); continue; }
    const tile = tileOf(atlas, slot);
    if (tile.equals(CHECKER)) { add('atlas-slot-is-missing-texture', t); continue; }
    if (src.width !== 16) { add('atlas-source-not-16px', t + ' ' + src.width + 'x' + src.height); continue; }
    if (!same(tile, src.data)) add('atlas-region-pixels-differ', t + ' slot ' + slot);
  }
  return out;
}

function audit(ctx) {
  const out = [];
  const items = ctx.items, byName = new Map(items.map((i) => [i.name, i]));
  for (const r of ctx.roster.items) {
    const it = byName.get(r.name);
    if (!it) { for (const view of VIEWS.slice(0, 5)) out.push({ name: r.name, source: r.source, view, cause: 'jar-item-not-in-registry', detail: '' }); continue; }
    if (r.missing) out.push({ name: r.name, source: r.source, view: 'gui', cause: 'model-parent-missing-in-jar', detail: r.missing });
    for (const v of VIEWS.slice(0, 5)) {
      const want = r.display[v], have = it[REG_KEY[v]];
      if (!cmp(want, have)) out.push({ name: r.name, source: r.source, view: v, cause: 'display-transform-differs', detail: 'model ' + JSON.stringify(norm(want)) + ' registry ' + JSON.stringify(norm(have)) });
    }
    if (r.source === 'entity') continue;                       // drawn by a block-entity model, not a texture region
    const flatViews = VIEWS.slice(0, 5);
    if (r.source === 'generated') {
      const layers = (it.layers || []).map(strip);
      if (JSON.stringify(layers) !== JSON.stringify(r.tex) && r.name !== 'clock' && r.name !== 'compass')
        for (const view of flatViews) out.push({ name: r.name, source: r.source, view, cause: 'registry-layers-differ-from-model', detail: 'model ' + r.tex.join(',') + ' registry ' + layers.join(',') });
      out.push(...textureFindings(r.name, r.source, flatViews, r.tex, itemAtlas, itemAtlas.index));
    } else {   // a block-model item is drawn from the block atlas
      out.push(...textureFindings(r.name, r.source, flatViews, r.tex, blockAtlas, blockAtlas.index));
    }
  }
  for (const b of ctx.roster.blocks) {
    if (b.missingModels.length) out.push({ name: b.name, source: 'block', view: 'placed', cause: 'blockstate-model-missing-in-jar', detail: b.missingModels.join(',') });
    out.push(...textureFindings(b.name, 'block', ['placed'], b.tex, blockAtlas, blockAtlas.index));
  }
  return out;
}

// ── the roster, from the jar ──────────────────────────────────────────────────────────────────────
const roster = { items: [], blocks: [] };
for (const p of jarNew.under('assets/minecraft/models/item/').filter((n) => n.endsWith('.json'))) {
  const name = p.slice('assets/minecraft/models/item/'.length, -5);
  const r = resolve('item/' + name), d = drawn(r);
  roster.items.push({ name, source: r.source, tex: d.tex, unresolved: d.unresolved, display: r.display, missing: r.missing });
}
const blocksReg = J('block-registry.json');
for (const b of blocksReg) {
  const tex = new Set(), missingModels = new Set();
  for (const s of b.states) for (const part of s.parts) {
    const id = strip(part.model), r = resolve(id);
    if (r.missing) { missingModels.add(id); continue; }
    for (const t of drawn(r).tex) tex.add(t);
  }
  roster.blocks.push({ name: b.name, tex: [...tex], missingModels: [...missingModels] });
}
const itemsReg = Object.values(J('item-registry.json').items);
const ctx = { roster, items: itemsReg };
console.log('texrostercheck — #592: texture roster + audit harness (' + roster.items.length + ' item models, ' + roster.blocks.length + ' blocks x ' + VIEWS.length + ' views)');
const bySource = {}; for (const r of roster.items) bySource[r.source] = (bySource[r.source] || 0) + 1;
console.log('   item model sources: ' + JSON.stringify(bySource));

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
ok(roster.items.length > 1000, 'roster items ' + roster.items.length);
ok(roster.blocks.length === 900, 'roster blocks ' + roster.blocks.length);
ok(bySource.generated > 400 && bySource.block > 400 && bySource.entity > 20, 'all three model sources appear');

const findings = audit(ctx);
// ── report, grouped by cause ─────────────────────────────────────────────────────────────────────
const byCause = {};
for (const f of findings) { const c = (byCause[f.cause] ||= { entries: new Map(), views: {} }); (c.entries.get(f.name) || c.entries.set(f.name, []).get(f.name)).push(f); c.views[f.view] = (c.views[f.view] || 0) + 1; }
let md = '## Texture roster audit (#592) — ' + findings.length + ' failing (entry, view) rows\n\nRoster: ' + roster.items.length + ' item models (' + JSON.stringify(bySource) + '), ' + roster.blocks.length + ' blocks. Views: ' + VIEWS.join(', ') + '.\n\n| cause | entries | rows per view |\n|---|---|---|\n';
const causes = Object.keys(byCause).sort((a, b) => byCause[b].entries.size - byCause[a].entries.size);
for (const c of causes) md += '| ' + c + ' | ' + byCause[c].entries.size + ' | ' + JSON.stringify(byCause[c].views) + ' |\n';
for (const c of causes) {
  md += '\n### ' + c + ' (' + byCause[c].entries.size + ')\n';
  let n = 0;
  for (const [name, rows] of byCause[c].entries) { if (n++ >= 60) { md += '- … and ' + (byCause[c].entries.size - 60) + ' more\n'; break; } md += '- `' + name + '` [' + rows[0].source + '] ' + [...new Set(rows.map((r) => r.view))].join('/') + ' — ' + rows[0].detail + '\n'; }
}
writeFileSync(join(ASSETS, 'texture-audit.md'), md);
console.log(md.split('\n### ')[0]);
console.log('   full grouped list: assets/texture-audit.md');
// RATCHET: the failures above are today's measured baseline (tools/golden/texroster-known.json, written by
// --write-baseline). A NEW failing row fails this check; a baseline row that now passes must be deleted from the
// file, so the list only ever shrinks as the #579 units land.
const KNOWN_FILE = join(MCLITE_ROOT, 'tools/golden/texroster-known.json');
const rowKey = (f) => f.cause + '|' + f.name + '|' + f.view;
if (process.argv.includes('--write-baseline')) { writeFileSync(KNOWN_FILE, JSON.stringify(findings.map(rowKey).sort(), null, 1) + '\n'); console.log('   baseline written: ' + findings.length + ' rows'); }
const known = new Set(existsSync(KNOWN_FILE) ? JSON.parse(readFileSync(KNOWN_FILE, 'utf8')) : []);
const nowKeys = new Set(findings.map(rowKey));
const fresh0 = [...nowKeys].filter((k) => !known.has(k)), healed = [...known].filter((k) => !nowKeys.has(k));
ok(fresh0.length === 0, fresh0.length + ' NEW failing rows (not in the baseline): ' + fresh0.slice(0, 8).join('; '));
ok(healed.length === 0, healed.length + ' baseline rows now pass - delete them from tools/golden/texroster-known.json: ' + healed.slice(0, 8).join('; '));
console.log('   ' + findings.length + ' failing rows in ' + causes.length + ' cause(s), ' + known.size + ' in the known baseline: ' + causes.map((c) => c + '=' + byCause[c].entries.size).join(', '));

// ── anti-vacuity: break clean copies of the data and assert the audit names each break ──────────
const brk = (c, m) => { breaks++; if (ok(c, m)) console.log('   ✓ break caught: ' + m.replace('anti-vacuity: ', '').replace(' not caught', '')); };
const cause = (fs, c, name) => fs.some((f) => f.cause === c && (!name || f.name === name));
const base = new Set(findings.map((f) => f.cause + '|' + f.name + '|' + f.view));
const fresh = (fs, c, name) => fs.some((f) => f.cause === c && f.name === name && !base.has(f.cause + '|' + f.name + '|' + f.view));
const pick = (pred) => roster.items.find((r) => pred(r) && !findings.some((f) => f.name === r.name));
const cleanGen = pick((r) => r.source === 'generated' && r.tex.length === 1 && itemsReg.some((i) => i.name === r.name));
const cleanBlk = roster.blocks.find((b) => b.tex.length && !findings.some((f) => f.name === b.name && f.view === 'placed'));
if (cleanGen && cleanBlk) {
  const clone = (o) => ({ roster: o.roster, items: o.items.map((i) => ({ ...i })) });
  { // 1. a display transform is nudged
    const c = clone(ctx), it = c.items.find((i) => i.name === cleanGen.name); it.ground = { rotation: [1, 2, 3], translation: [0, 0, 0], scale: [9, 9, 9] };
    brk(fresh(audit(c), 'display-transform-differs', cleanGen.name), 'anti-vacuity: nudged ground transform not caught');
  }
  { // 2. the registry names another layer
    const c = clone(ctx), it = c.items.find((i) => i.name === cleanGen.name); it.layers = ['item/stick'];
    brk(cleanGen.tex[0] === 'item/stick' || fresh(audit(c), 'registry-layers-differ-from-model', cleanGen.name), 'anti-vacuity: wrong layer not caught');
  }
  { // 3. the jar loses a texture / the atlas loses a slot / a slot points at layer 0 / a slot points at another tile
    const t = cleanGen.tex[0], saved = itemAtlas.index[t];
    delete itemAtlas.index[t]; brk(fresh(audit(ctx), 'texture-not-in-atlas', cleanGen.name), 'anti-vacuity: dropped atlas slot not caught');
    const badSlot = Object.values(itemAtlas.index).length; itemAtlas.index[t] = badSlot; itemAtlas.tiles = 1;
    mulTile.set(itemAtlas.cols + ':' + badSlot + ':true', CHECKER); brk(fresh(audit(ctx), 'atlas-slot-is-missing-texture', cleanGen.name), 'anti-vacuity: checker slot not caught');
    const other = Object.values(itemAtlas.index).find((s) => s !== saved && s !== 0 && !tileOf(itemAtlas, s).equals(tileOf(itemAtlas, saved)));
    itemAtlas.index[t] = other; brk(fresh(audit(ctx), 'atlas-region-pixels-differ', cleanGen.name), 'anti-vacuity: slot pointing at another tile not caught');
    itemAtlas.index[t] = saved;
  }
  { // 4. a block loses its atlas slot; a model goes missing
    const t = cleanBlk.tex[0], saved = blockAtlas.index[t];
    delete blockAtlas.index[t]; brk(fresh(audit(ctx), 'texture-not-in-atlas', cleanBlk.name), 'anti-vacuity: block slot drop not caught');
    blockAtlas.index[t] = saved;
    const c = { roster: { items: roster.items, blocks: roster.blocks.map((b) => b === cleanBlk ? { ...b, missingModels: ['block/nope'] } : b) }, items: itemsReg };
    brk(fresh(audit(c), 'blockstate-model-missing-in-jar', cleanBlk.name), 'anti-vacuity: missing block model not caught');
  }
  { // 5. an item the registry forgot
    const c = clone(ctx); c.items = c.items.filter((i) => i.name !== cleanGen.name);
    brk(fresh(audit(c), 'jar-item-not-in-registry', cleanGen.name), 'anti-vacuity: missing registry item not caught');
  }
} else { ok(false, 'anti-vacuity: no clean entry to break (' + !!cleanGen + '/' + !!cleanBlk + ')'); }
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); console.log(' assertions passed .... ' + pass + '\n failures ........... ' + fails.length + '\n ' + breaks + ' breaks caught'); process.exit(1); }
console.log(' assertions passed .... ' + pass + '\n failures ........... 0\n ' + breaks + ' breaks caught');
