#!/usr/bin/env node
// beroster.mjs — #635: the WHOLE jar roster of builtin/entity item models (every bed colour, banner, head, chest...) has the
// jar's third-person / head / ground / fixed display in the runtime tables (bedisplaycheck etc. grade only nine sample names).
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
const jp = join(MCLITE_ROOT, 'jars/1.18.2/1.18.2.jar');
if (!existsSync(jp)) { console.log('beroster: no 1.18.2 jar, skipped'); process.exit(0); }
const jar = new Jar(jp);
const ER = loadEngine({ extra: ['07j_entityrender.js'], dom: false }).EntityRender;
const mdl = (n) => JSON.parse(jar.read('assets/minecraft/models/item/' + n + '.json').toString());
const chain = (n) => { const out = []; let m = mdl(n); out.push(m); while (m.parent && m.parent.replace('minecraft:', '').startsWith('item/')) { m = mdl(m.parent.replace('minecraft:', '').slice(5)); out.push(m); } return out; };
const disp = (c, k) => c.find((m) => m.display && m.display[k])?.display[k];
const isEnt = (c) => c.some((m) => m.parent && m.parent.replace('minecraft:', '') === 'builtin/entity');
const roster = [];
for (const f of jar.names()) {
  const mt = /^assets\/minecraft\/models\/item\/([a-z_]+)\.json$/.exec(f);
  if (!mt || mt[1].startsWith('template_')) continue;
  if (/^trident|^shield_blocking$/.test(mt[1])) continue;   // 3D trident is G10d; shield_blocking is a use-state variant, neither is a block-entity item
  const c = chain(mt[1]); if (isEnt(c)) roster.push([mt[1], c]);
}
const eq = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const VIEWS = {
  thirdperson_righthand: (n) => ER.beThirdFor(n), head: (n) => ER.beHeadFor(n), fixed: (n) => ER.beFixedFor(n),
  ground: (n) => { const g = ER.beGroundFor(n); return { rot: [0, 0, 0], t: [(g.tx || 0) * 16, g.ty * 16, (g.tz || 0) * 16], s: g.scale }; } };
function grade(views, rosterIn) {
  const bad = [];
  for (const [n, c] of rosterIn) for (const k in views) {
    const g = disp(c, k), r = views[k](n);
    let ok;
    if (k === 'ground') ok = g && r && eq(g.translation, r.t) && Math.abs(g.scale[1] - r.s) < 1e-9;
    else ok = (!g && !r) || (g && r && eq(g.rotation, r.rot) && eq(g.translation, r.t) && eq(g.scale, [r.s, r.s, r.s]));
    if (!ok) bad.push(n + ' ' + k + ' jar ' + JSON.stringify(g) + ' runtime ' + JSON.stringify(r));
  }
  return bad;
}

if (roster.length < 40) { console.log('roster too small'); process.exit(1); }
const bad = grade(VIEWS, roster);
if (bad.length) { console.log(bad.join('\n')); process.exit(1); }
let caught = 0;
for (const k of Object.keys(VIEWS)) {
  const mut = { ...VIEWS, [k]: (n) => { const r = VIEWS[k](n); return r && { ...r, s: r.s * 2 }; } };
  if (grade(mut, roster).length) caught++;
  const nul = { ...VIEWS, [k]: () => null };
  if (grade(nul, roster).length) caught++;
}
console.log(roster.length * 4 + ' assertions (' + roster.length + ' items), 0 failures, ' + caught + ' breaks caught');
process.exit(caught === 8 ? 0 : 1);
