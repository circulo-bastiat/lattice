#!/usr/bin/env node
// lockstep-spawnvariants -- #7913 (G18c-L1): lockstep scenario 'spawnvariants', 20 salts x 200 spawns per mob. Each mob is spawned through the engine's real EL.spawn
// (no pack data = an egg/command spawn, vanilla initialize with null EntityData) with a recorded random stream; the variant that comes out is compared with the vanilla
// rule written out independently from .decomp: SheepEntity.generateDefaultColor (nextInt(100) 5/5/5/3 black/gray/light_gray/brown, else nextInt(500)==0 pink, else white),
// ParrotEntity.initialize nextInt(5), AxolotlEntity.initialize (AxolotlData of TWO getRandomNatural rolls, then nextInt(2) picks), LlamaEntity.initialize nextInt(4) variant,
// HorseEntity.initialize (Util.getRandom(HorseColor 7), then HorseMarking 5). The draw count is compared where nothing else draws (sheep, parrot, axolotl).
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';
const SALTS = 20, N = 200;
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07m_breed.js', '07w_passive.js', '07zm_axolotl.js', '07r_mount.js'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const ni = (r, n) => Math.floor(r * n);
const SHEEP = (u, v) => { const k = ni(u, 100); return k < 5 ? 'black' : k < 10 ? 'gray' : k < 15 ? 'light_gray' : k < 18 ? 'brown' : (ni(v(), 500) === 0 ? 'pink' : 'white'); };

function run(patch) {
  const M = loadEngine({ patch, extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(1); M.EntityList.init();
  const EL = M.EntityList;
  let draws = [], snap = [];
  for (const t of ['sheep', 'parrot', 'axolotl', 'llama', 'horse']) { const f = EL.DEFAULTS[t]; EL.DEFAULTS[t] = function () { draws.length = 0; const r = f.apply(this, arguments); snap = draws.slice(); return r; }; }
  let bad = 0, first = '', n = 0;
  const hist = {};
  for (let salt = 1; salt <= SALTS; salt++) {
    for (const type of ['sheep', 'parrot', 'axolotl', 'llama', 'horse']) {
      const st = stream(salt * 31 + type.length);
      for (let i = 0; i < N; i++) {
        draws = []; EL.random = () => { const v = st(); draws.push(v); return v; };
        EL.list.length = 0;
        const e = EL.spawn(type, 0.5, 64, 0.5, {});
        if (!e) { bad++; first = first || type + ' not spawned'; continue; }
        const d = snap; let ref, got, used = null, k = 0;
        const nx = () => d[k++];
        if (type === 'sheep') { ref = SHEEP(nx(), nx); got = e.woolColor; used = k; }
        else if (type === 'parrot') { ref = ni(nx(), 5); got = e.parrotVariant; used = k; }
        else if (type === 'axolotl') { const a = ni(nx(), 4), b = ni(nx(), 4); ref = [a, b][ni(nx(), 2)]; got = e.axolotlVariant; used = k; }
        else if (type === 'llama') { ref = ni(d[d.length - 1], 4); got = e.variant; }
        else { ref = ni(d[d.length - 2], 7) + ',' + ni(d[d.length - 1], 5); const c = M.Mount.horseColor(e), m = M.Mount.horseMarking(e); got = c + ',' + m; }
        n++; hist[type + ':' + got] = (hist[type + ':' + got] | 0) + 1;
        if (ref !== got || (used !== null && used !== d.length)) { bad++; first = first || `${type} salt ${salt} #${i}: got ${got} (${d.length} draws) want ${ref} (${used})`; }
      }
    }
  }
  return { bad, first, n, hist };
}

const base = run(null);
let ok = base.bad === 0, caught = 0;
if (!ok) console.log('BASE DIVERGES: ' + base.first);
const R = (file, a, b) => (f, s) => {
  if (f !== file) return s;
  if (!s.includes(a)) throw new Error('break text not found: ' + a);
  return s.replace(a, b);
};
const P = (a, b) => R('07w_passive.js', a, b);
const breaks = [
  ['sheep: brown 18 -> 17', P('if (r < 18) return', 'if (r < 17) return')],
  ['sheep: two weights swapped (black/gray)', P("if (r < 5) return 'black';\n    if (r < 10) return 'gray';", "if (r < 5) return 'gray';\n    if (r < 10) return 'black';")],
  ['sheep: pink 1/500 -> 1/400', P('* 500) === 0', '* 400) === 0')],
  ['axolotl: natural variants include blue', R('07zm_axolotl.js', 'Ax.NATURAL_VARIANTS = [0, 1, 2, 3]', 'Ax.NATURAL_VARIANTS = [0, 1, 2, 4]')],
  ['llama: variant count 4 -> 3', R('07r_mount.js', 'Mnt.LLAMA_VARIANT_COUNT = 4', 'Mnt.LLAMA_VARIANT_COUNT = 3')],
  ['horse: marking count 5 -> 4', R('07r_mount.js', 'Mnt.HORSE_MARKING_COUNT = 5', 'Mnt.HORSE_MARKING_COUNT = 4')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`spawnvariants: ${caught} breaks caught, ${base.bad} divergences over ${base.n} spawns${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
