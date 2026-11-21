#!/usr/bin/env node
// structmapcheck.mjs — #11707: 04r_structures.js proven through real entry points:
// GenerationStep (STEP_OF), ConcentricRingsStructurePlacement (ringPositions -> locateStructure),
// RandomSpreadStructurePlacement (region offsets), ConfiguredStructureFeatureTags (STRUCTURE_TAGS),
// ChunkGenerator.locateStructure, StructureAccessor (containsAt), ChunkPos (block>>4), RuinedPortalFeature.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const M = loadEngine({ dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const ST = M.Structures;
const mod = (a, b) => a - ST.floorDiv(a, b) * b;
const sets = Object.fromEntries(ST.sets.map((s) => [s.name, s.placement]));

function run(tag) {
  const bad = [];
  const chk = (c, m) => { if (c) { if (tag === 'real') pass++; } else bad.push(m); };
  // GenerationStep.Decoration
  const st = ST.STEP_OF;
  chk(st.mineshaft === 3 && st.buried_treasure === 3, 'underground_structures step');
  chk(st.stronghold === 5, 'strongholds step');
  chk(st.fortress === 7 && st.nether_fossil === 7, 'underground_decoration step');
  chk(st._default === 4, 'surface_structures default step');
  // ConcentricRings: 128 chunks, ring-1 distance ~ 4*32 chunks (+-1.25*32)
  const rp = ST.ringPositions(sets.strongholds);
  chk(rp.length === 256, 'ring count 128 chunks');
  for (let i = 0; i < 6 && i < rp.length; i += 2) { const d = Math.hypot(rp[i], rp[i + 1]); chk(d > 80 && d < 175, 'first ring distance ' + d); }
  for (const [x, z] of [[0, 0], [5000, -3000]]) {
    const r = ST.locateStructure('#minecraft:eye_of_ender_located', x, z, 100);
    chk(r && r.y === 32 && r.x === (r.cx << 4) + 8 && r.z === (r.cz << 4) + 8, 'ring locate geometry');
    let best = Infinity;
    for (let i = 0; i < rp.length; i += 2) best = Math.min(best, ((rp[i] << 4) + 8 - x) ** 2 + ((rp[i + 1] << 4) + 8 - z) ** 2);
    chk(r && (r.x - x) ** 2 + (r.z - z) ** 2 === best, 'ring locate is nearest');
  }
  // RandomSpread: located start chunk sits in the first spacing-separation chunks of its region
  const cases = [['village', 'villages'], ['ruined_portal', 'ruined_portals'], ['ocean_ruin', 'ocean_ruins'], ['shipwreck', 'shipwrecks']];
  for (const [tg, sn] of cases) {
    const pl = sets[sn], span = pl.spacing - pl.separation;
    for (const o of [[0, 0], [1000, 1000], [-2500, 700]]) {
      const r = ST.locateStructure(tg, o[0], o[1], 60);
      if (!r) { chk(tg === 'ocean_ruin' || tg === 'shipwreck', tg + ' located nothing'); continue; }
      chk(mod(r.cx, pl.spacing) < span && mod(r.cz, pl.spacing) < span, tg + ' start offset outside span');
      chk(r.x >> 4 === r.cx && r.z >> 4 === r.cz, tg + ' ChunkPos block>>4');
    }
  }
  // tags
  const T = ST.STRUCTURE_TAGS;
  chk(T.on_woodland_explorer_maps[0] === 'mansion' && T.on_ocean_explorer_maps[0] === 'monument', 'explorer map tags');
  chk(T.ruined_portal.length === 7 && T.village.length === 5, 'tag sizes');
  const rpR = ST.locateStructure('#minecraft:ruined_portal', 0, 0, 60);
  chk(rpR && ST.STRUCTURE_TAGS.ruined_portal.indexOf(rpR.name) >= 0, 'ruined portal located by tag');
  chk(ST.locateStructure('#minecraft:nonsense', 0, 0, 10) === null, 'unknown tag null');
  // StructureAccessor.containsAt: a piece centre is inside, one far outside is not
  let s = null;
  for (let cz = -120; cz <= 120 && !s; cz += 3) for (let cx = -120; cx <= 120 && !s; cx += 3) for (const q of ST.startsNear(cx, cz)) if (q.pieces && q.def.name.indexOf('ruined_portal') === 0) { s = q; break; }
  chk(!!s, 'a real ruined_portal start');
  if (s) {
    const p = s.pieces[0], x = (p.x0 + p.x1) >> 1, y = (p.y0 + p.y1) >> 1, z = (p.z0 + p.z1) >> 1;
    chk(ST.containsAt(s.def.name, x, y, z), 'containsAt piece centre');
    chk(!ST.containsAt(s.def.name, p.x1 + 1, p.y1 + 400, z), 'containsAt far above');
  }
  return bad;
}
const real = run('real');
for (const b of real) fails.push(b);

// anti-vacuity
const saved = { step: { ...ST.STEP_OF }, tags: JSON.parse(JSON.stringify(ST.STRUCTURE_TAGS)), ring: ST.ringPositions, loc: ST.locateStructure, cont: ST.containsAt };
const origSets = ST.sets.map((s) => s.placement.spacing);
const restore = () => { Object.assign(ST.STEP_OF, saved.step); ST.STRUCTURE_TAGS.village = saved.tags.village; ST.STRUCTURE_TAGS.ruined_portal = saved.tags.ruined_portal; ST.ringPositions = saved.ring; ST.locateStructure = saved.loc; ST.containsAt = saved.cont; };
const brk = {
  'stronghold step wrong': () => { ST.STEP_OF.stronghold = 4; },
  'default step wrong': () => { ST.STEP_OF._default = 5; },
  'village tag shrunk': () => { ST.STRUCTURE_TAGS.village = ST.STRUCTURE_TAGS.village.slice(1); },
  'portal tag emptied': () => { ST.STRUCTURE_TAGS.ruined_portal = []; },
  'rings truncated': () => { const r = saved.ring; ST.ringPositions = (pl) => r(pl).slice(0, 100); },
  'locate offset by one': () => { const l = saved.loc; ST.locateStructure = (...a) => { const r = l(...a); return r && Object.assign({}, r, { x: r.x + 1 }); }; },
  'containsAt always true': () => { ST.containsAt = () => true; }
};
let caught = 0;
for (const [n, f] of Object.entries(brk)) {
  f(); const bad = run('broken'); restore();
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + n); } else fails.push('break not caught: ' + n);
}
console.log(`${caught} breaks caught`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('structmapcheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
