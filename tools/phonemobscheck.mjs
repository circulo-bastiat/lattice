#!/usr/bin/env node
// phonemobscheck.mjs - #7809: the phone's Mobs tab (phone-web/mobs.js + its wiring in app.js) against the REAL tools/mobproof/matrix.json (91 rows).
// Breaks: a mob missing from the list, two dimensions swapped, an unknown state shown as done, a proven count that is not the file's, a sign-off column that ignores the ledger,
// a filter that does nothing, the default order reversed, no cache / wrong API path in app.js.
let N = 0;
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const T = dirname(fileURLToPath(import.meta.url)), P = join(T, 'phone-web'), rd = (f) => readFileSync(join(P, f), 'utf8');
const SRC = { mobs: rd('mobs.js'), app: rd('app.js'), ui: rd('ui.js') };
const REAL = JSON.parse(readFileSync(existsSync(join(T, 'mobproof', 'matrix.json')) ? join(T, 'mobproof', 'matrix.json') : join(P, 'qa', 'fixtures', 'matrix.json'), 'utf8'));
const DIMS = ['model', 'texture', 'animation', 'drops', 'spawn', 'lockstep', 'goals'];
const proofSrc = readFileSync(join(T, 'mobproof.mjs'), 'utf8');
function run(S) {
  const f = []; const ok = (c, m) => { N++; if (!c) f.push(m); };
  const tmp = mkdtempSync(join(tmpdir(), 'pmc-')); writeFileSync(join(tmp, 'ui.js'), S.ui); writeFileSync(join(tmp, 'mobs.js'), S.mobs);
  const req = createRequire(join(tmp, 'x.js')); let Mobs;
  try { globalThis.UI = req('./ui.js'); Mobs = req('./mobs.js'); } catch (e) { rmSync(tmp, { recursive: true, force: true }); return ['modules do not load: ' + e.message]; }
  try {
    // the real file as it is today
    const real = Mobs.model(REAL, {});
    ok(real.length === REAL.roster && real.length === Object.keys(REAL.rows).length, `list has ${real.length} mobs, the file says ${REAL.roster}`);
    for (const m of Object.keys(REAL.rows)) ok(real.some((r) => r.name === m), `mob ${m} missing from the list`);
    ok(Mobs.summary(real).proven === REAL.proven, 'proven count differs from the file');
    ok(Mobs.humanize('evoker_fangs') === 'Evoker fangs', 'humanize');
    ok(real.every((m) => m.cells.length === 8 && m.cells[7].dim === Mobs.SIGN && m.cells[7].st === 'missing'), 'sign-off column is not "not started" for everyone without a ledger');
    ok(!real.some((m) => m.cat === 'other' && !['armor_stand', 'end_crystal', 'leash_knot', 'llama_decor', 'player', 'player_slim'].includes(m.name)), 'category table lost a roster mob');
    for (const c of Mobs.CATS.filter((c) => c !== 'other')) ok(real.some((m) => m.cat === c), `no mob in category ${c}`);
    // a fixture with a different state in every dimension, one unknown state, a green mob and a ledger
    const rows = {
      zeta: { model: 'green', texture: 'red', animation: 'missing', drops: 'green', spawn: 'green', lockstep: 'missing', goals: 'partial', proven: false },
      alpha: Object.fromEntries(DIMS.map((d) => [d, 'green']).concat([['proven', true]])),
      beta: Object.fromEntries(DIMS.map((d) => [d, 'missing']).concat([['proven', false]])),
      gamma: { model: 'missing', texture: 'green', animation: 'missing', drops: 'missing', spawn: 'missing', lockstep: 'missing', goals: 'missing', proven: false },
    };
    const L = Mobs.model({ roster: 4, proven: 1, rows }, { alpha: true, zeta: true }), by = Object.fromEntries(L.map((m) => [m.name, m]));
    ok(by.zeta.cells.map((c) => c.st).join() === 'done,red,missing,done,done,missing,unknown,done', 'zeta cells ' + by.zeta.cells.map((c) => c.st));
    ok(by.zeta.cells[0].dim === 'model' && by.zeta.cells[1].dim === 'texture' && by.zeta.cells[3].dim === 'drops', 'dimension order');
    ok(by.zeta.done === 4, 'unknown state counted as done: ' + by.zeta.done);
    ok(by.alpha.proven && by.alpha.done === 8 && !by.beta.signed && by.alpha.signed, 'ledger / proven flags');
    const s = Mobs.summary(L);
    ok(s.proven === 1 && s.signed === 2 && s.per.drops === 2 && s.per.texture === 2 && s.per.signoff === 2, 'summary ' + JSON.stringify(s));
    ok(Mobs.filter(L).map((m) => m.name).join() === 'beta,gamma,zeta,alpha', 'default order least audited first: ' + Mobs.filter(L).map((m) => m.name));
    ok(Mobs.filter(L, { red: true }).map((m) => m.name).join() === 'zeta', 'red only');
    ok(Mobs.filter(L, { needs: true }).length === 3, 'needs work');
    ok(Mobs.filter(L, { dim: 'texture' }).map((m) => m.name).join() === 'beta,zeta', 'dimension filter');
    ok(Mobs.filter(L, { q: 'GAM' }).map((m) => m.name).join() === 'gamma', 'search');
    ok(Mobs.filter(real, { cat: 'boss' }).length === 3, 'category filter (boss)');
    const html = Mobs.view(L, {});
    ok(/Proven 1 \/ 4/.test(html) && /Visually signed off 2 \/ 4/.test(html), 'progress bars');
    ok(html.includes(Mobs.CAPTION) && /drops 2\/4 done/.test(html), 'caption / summary strip');
    ok(/3 of 8/.test(html) === false && /4 of 8/.test(html) && /8 of 8/.test(html), 'n of 8 text');
    const sh = Mobs.sheet(by.zeta);
    ok(/unknown state/.test(sh) && /Open issue/.test(sh) && /#7522/.test(sh) && /mobtexproofcheck/.test(sh), 'sheet');
    ok(/not started/.test(Mobs.sheet(by.beta)), 'sheet: sign-off not started');
    // app.js wiring + state names from the proof tool
    ok(/contents\/tools\/mobproof\/matrix\.json/.test(S.app) && /300e3/.test(S.app) && /#\/mobs/.test(S.app) && /signoff\.json/.test(S.app), 'app.js does not fetch matrix + ledger with a 5 min cache');
    for (const k of Object.keys(Mobs.KNOWN)) ok(new RegExp(`\\b${k}\\b`).test(proofSrc), `state ${k} is not a mobproof.mjs state`);
    ok(/'green'/.test(proofSrc) && /'red'/.test(proofSrc) && /'missing'/.test(proofSrc), 'mobproof.mjs states changed');
  } catch (e) { f.push('threw: ' + e.message); }
  rmSync(tmp, { recursive: true, force: true });
  return f;
}
const base = run(SRC);
if (base.length) { console.log(base.map((x) => '  ✗ ' + x).join('\n')); console.log(`phonemobscheck: FAILED (${base.length})`); process.exit(1); }
const rep = (k, a, b) => () => { if (!SRC[k].includes(a)) throw new Error(`no such text in ${k}: ${a}`); return { ...SRC, [k]: SRC[k].replace(a, b) }; };
const BREAKS = [
  ['a mob dropped from the list', rep('mobs', 'Object.keys(rows).map((name)', 'Object.keys(rows).slice(1).map((name)')],
  ['two dimensions swapped', rep('mobs', "const DIMS = ['model', 'texture',", "const DIMS = ['texture', 'model',")],
  ['unknown state shown as done', rep('mobs', "? KNOWN[s] : 'unknown'", "? KNOWN[s] : 'done'")],
  ['proven count taken from nowhere', rep('mobs', 'proven: list.filter((m) => m.proven).length', 'proven: 0')],
  ['sign-off ignores the ledger', rep('mobs', "L[name] === true ? 'done'", "false ? 'done'")],
  ['signed count ignores ledger', rep('mobs', 'signed: list.filter((m) => m.signed).length', 'signed: 0')],
  ['red filter does nothing', rep('mobs', '(!f.red || m.red)', 'true')],
  ['needs-work filter does nothing', rep('mobs', '(!f.needs || !m.proven)', 'true')],
  ['category filter does nothing', rep('mobs', '(!f.cat || m.cat === f.cat)', 'true')],
  ['dimension filter does nothing', rep('mobs', "(!f.dim || m.cells.find((c) => c.dim === f.dim).st !== 'done')", 'true')],
  ['search ignored', rep('mobs', '(!q || m.name.includes(q))', 'true')],
  ['most audited first', rep('mobs', 'a.done - b.done ||', 'b.done - a.done ||')],
  ['caption dropped', rep('mobs', '<p class="sub">${E(CAPTION)}</p>', '')],
  ['humanize broken', rep('mobs', ".replace(/_/g, ' ')", '')],
  ['boss category lost', rep('mobs', "put('boss', 'ender_dragon wither elder_guardian');", '')],
  ['sheet without the owning issue', rep('mobs', ' Issue #${i[3]}.', '')],
  ['app has no cache', rep('app', '300e3', '0')],
  ['app ignores the ledger', rep('app', 'signoff.json', 'nothing.json')],
  ['app fetches another file', rep('app', 'mobproof/matrix.json', 'mobproof/matrix.md')],
];
let caught = 0, bad = [];
for (const [name, mk] of BREAKS) { let S; try { S = mk(); } catch (e) { bad.push(`${name}: ${e.message}`); continue; } const r = run(S); if (r.length) { caught++; console.log('   ✓ ' + name); } else bad.push(`${name}: not caught`); }
if (bad.length) { console.log(bad.map((x) => '  ✗ ' + x).join('\n')); console.log(`phonemobscheck: ${caught} breaks caught (of ${BREAKS.length}) - FAILED`); process.exit(1); }
console.log(`phonemobscheck: ${N} checks passed, 0 failures, ${caught} breaks caught (of ${BREAKS.length})`);
