#!/usr/bin/env node
// lockstep-structurespawns -- #6937 (G17-L197): lockstep scenario 'structurespawns', 20 salts. A player stands in each structure box
// (nether fortress, swamp hut, pillager outpost, ocean monument) over repeated spawn cycles; per tick the spawn list the position
// resolves to (Spawn.spawnList -> Structures.spawnOverride, vs the biome list) is picked with the real weighted pick and a pack size
// rolled, and (type, position, count) is compared exact with an independent transcription of StructureFeatureManager.getMobsAt /
// StructureFeature spawn overrides / NetherFortressFeature.MONSTER_SPAWNS / WeightedRandom (.decomp).
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 400;
const stream = (salt) => { let s = (salt * 2654435761 + 4243) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const BIOME = { monster: [['zombie', 95, 4, 4], ['skeleton', 100, 4, 4]], creature: [['sheep', 12, 4, 4], ['pig', 10, 4, 4]] };
// vanilla override lists: name -> category -> [boxKind, [[type, weight, min, max]...]]
const REF = {
  fortress: { monster: ['piece', [['blaze', 10, 2, 3], ['zombified_piglin', 5, 4, 4], ['wither_skeleton', 8, 5, 5], ['skeleton', 2, 5, 5], ['magma_cube', 3, 4, 4]]] },
  swamp_hut: { monster: ['piece', [['witch', 1, 1, 1]]], creature: ['piece', [['cat', 1, 1, 1]]] },
  pillager_outpost: { monster: ['full', [['pillager', 1, 1, 1]]] },
  monument: { monster: ['full', [['guardian', 1, 2, 4]]] },
};
const NAMES = Object.keys(REF);
const BOX = { x0: 100, x1: 140, y0: 40, y1: 70, z0: 100, z1: 140 }, PIECE = { x0: 100, x1: 110, y0: 40, y1: 50, z0: 100, z1: 110 };

function plan(salt) {
  const r = stream(salt), steps = [];
  for (let t = 0; t < TICKS; t++) {
    const name = NAMES[(t + salt) % 4], cat = r() < 0.7 ? 'monster' : 'creature', inPiece = r() < 0.5;
    const b = inPiece ? PIECE : BOX;
    steps.push({ name, cat, x: b.x0 + Math.floor(r() * (b.x1 - b.x0 + 1)), y: b.y0 + Math.floor(r() * (b.y1 - b.y0 + 1)), z: b.z0 + Math.floor(r() * (b.z1 - b.z0 + 1)), inPiece, a: r(), b: r(), nb: r() < 0.5 });
  }
  return steps;
}
// weighted pick consumes a, pack size consumes b (same draws both sides)
const rollOf = (u, n) => Math.floor(u * n);

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07l_spawn.js'], dom: false });
  const ST = M.Structures; ST.init(M.Gen || {});
  const cur = { start: null };
  ST.ready = true; ST.startsNear = () => (cur.start ? [cur.start] : []);
  M.Biomes = { spawners: () => ({ monster: BIOME.monster.map(([type, weight, minCount, maxCount]) => ({ type, weight, minCount, maxCount })), creature: BIOME.creature.map(([type, weight, minCount, maxCount]) => ({ type, weight, minCount, maxCount })) }) };
  M.World = { getBlock: () => 0 };
  const rows = [];
  for (const s of plan(salt)) {
    const def = ST.defs[s.name], box = BOX;
    cur.start = { def, pieces: [PIECE], x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1, z0: box.z0, z1: box.z1 };
    const list = M.Spawn.spawnList(0, s.cat, s.x, s.y, s.z);
    const e = list && list.length ? M.Spawn.pickWeighted(list, (n) => rollOf(s.a, n)) : null;
    rows.push(snap(s, e, e ? e.minCount + rollOf(s.b, 1 + e.maxCount - e.minCount) : 0));
  }
  return rows;
}
const snap = (s, e, n) => [s.name, s.cat, s.x, s.y, s.z, e ? e.type : '-', n].join('|');

function reference(salt, o = {}) {
  const rows = [];
  for (const s of plan(salt)) {
    let list = BIOME[s.cat], ov = REF[s.name][s.cat];
    if (o.noCat && s.name === 'swamp_hut' && s.cat === 'creature') ov = null;
    if (ov) {
      const hit = ov[0] === 'full' || (s.x >= PIECE.x0 && s.x <= PIECE.x1 && s.y >= PIECE.y0 && s.y <= PIECE.y1 && s.z >= PIECE.z0 && s.z <= PIECE.z1);
      if (hit) list = ov[1].map((e) => (o.w6 && e[0] === 'wither_skeleton' ? [e[0], 6, e[2], e[3]] : e));
    }
    let e = null;
    if (list.length) {
      let tot = 0; for (const x of list) tot += x[1];
      let r = rollOf(s.a, tot);
      for (const x of list) { r -= x[1]; if (r < 0) { e = x; break; } }
    }
    rows.push(snap(s, e && { type: e[0] }, e ? e[2] + rollOf(s.b, 1 + e[3] - e[2]) : 0));
  }
  return rows;
}
function run(o = {}) {
  let bad = 0, first = '', fort = 0, hut = 0, cats = 0;
  for (let salt = 1; salt <= SALTS; salt++) {
    const a = engine(salt, o.patch), b = reference(salt, o);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${salt} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
    if (!o.patch && !o.w6 && !o.noCat) for (const row of b) { if (row.includes('|wither_skeleton|')) fort++; if (row.includes('|witch|')) hut++; if (row.includes('|cat|')) cats++; }
  }
  return { bad, first, fort, hut, cats };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
if (!base.fort || !base.hut || !base.cats) { fails++; console.log('  FAIL vacuous: ' + JSON.stringify(base)); }
const brk = [
  ['fortress wither_skeleton weight 8->6', { w6: true }],
  ['witch-hut cat override removed', { noCat: true }],
  ['engine fortress wither_skeleton weight 8->6', { patch: (f, s) => f === '04r_structures.js' ? s.replace("weight: e.weight | 0,", "weight: (String(e.type) === 'minecraft:wither_skeleton' ? 6 : e.weight | 0),") : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 2 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SALTS} salts, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
