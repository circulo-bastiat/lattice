// lockstep-poi -- #6906 (G17-L189): lockstep scenario 'poi', 20 salts: a villager beside a composter, a lectern and a bed; the composter broken at tick 600; a second villager arrives.
// Reference = an independent re-statement of the decomp rules: AcquireDirectly claim (first free job block, ticket 1 per job site, claimed-by owner), LoseJobOnSiteLossTask (profession none only when level<=1 and no trade xp; else kept, site forgotten),
// PointOfInterestType.ticketCount (job site 1, bed 1). Per tick: free tickets of the three POIs, owner of each job block, both villagers' profession/level/workstation.
// OWED: the 12000-tick unemployed timer is not in the engine (this engine claims by adjacency, Prof.OWED); it is not compared here.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '14b_physics.js', '07zu_poi.js', '07o_profession.js'] });
const { Poi, World: W, Section: S, CH, Reg: R, States: SR, Profession: Prof } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const bedHead = (() => { const b = R.id.red_bed; for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, R.PROP.part) === R.PVAL.head) return s; })();
const ents = new Map();
M.EntityList = { byId: (id) => ents.get(id) };
const P = { comp: { x: 6, y: 64, z: 5 }, lect: { x: 4, y: 64, z: 5 }, bed: { x: 5, y: 64, z: 8 } };
const PROF = { composter: 'farmer', lectern: 'librarian' };
const ORDER = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const k = (p) => p.x + ',' + p.y + ',' + p.z;
function lane(salt, fault) {
  const r = stream(salt), level = 1 + Math.floor(r() * 3), xp = r() < .5 ? 0 : 5, brk = 600;
  Prof.init(); Poi.init(); Poi.live = true; ents.clear();
  Prof.NEIGHBOURS = ORDER.map((a) => a.slice());
  if (fault) Prof.NEIGHBOURS = [[2, 0], [-1, 0]];   // claim radius changed
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) { W.setBlock(x, 63, z, SR.stateOf('stone')); for (let y = 64; y < 67; y++) W.setBlock(x, y, z, 0); }
  W.setBlock(P.comp.x, 64, P.comp.z, SR.stateOf('composter')); W.setBlock(P.lect.x, 64, P.lect.z, SR.stateOf('lectern')); W.setBlock(P.bed.x, 64, P.bed.z, bedHead);
  Poi.rescanNow();
  const A = { id: 1, type: 'villager', x: 5.5, y: 64, z: 5.5, profession: 'none', villagerLevel: level, tradeXp: xp };
  const B = { id: 2, type: 'villager', x: 5.5, y: 64, z: 5.5, profession: 'none', villagerLevel: 1, tradeXp: 0 };
  ents.set(1, A);
  // reference state
  const rf = { owner: {}, tk: {}, A: { p: 'none', ws: null }, B: null, broken: false };
  rf.tk[k(P.comp)] = 0; rf.tk[k(P.lect)] = 0; rf.tk[k(P.bed)] = 0;
  const refClaim = (v, id) => {
    if (v.p !== 'none') return;
    for (const [dx, dz] of ORDER) {
      const nx = 5 + dx, nz = 5 + dz, key = nx + ',64,' + nz;
      const name = key === k(P.comp) && !rf.broken ? 'composter' : key === k(P.lect) ? 'lectern' : null;
      if (!name) continue;
      if (rf.owner[key] !== undefined && rf.owner[key] !== id) continue;
      rf.owner[key] = id; rf.tk[key] = 1; v.p = PROF[name]; v.ws = key; return;
    }
  };
  const engClaim = (e) => { if (Prof.tryClaim(e)) Poi.reserveTicket(e.workstation); };
  for (let t = 0; t < 700; t++) {
    if (t === brk) {
      W.setBlock(P.comp.x, 64, P.comp.z, 0); Prof.releaseAt(P.comp.x, 64, P.comp.z);
      const key = k(P.comp); rf.broken = true; delete rf.owner[key]; delete rf.tk[key];
      if (rf.A.ws === key) { rf.A.ws = null; if (rf.A.p !== 'none' && level <= 1 && !(xp > 0)) rf.A.p = 'none'; }
    }
    if (t === brk + 1) { ents.set(2, B); rf.B = { p: 'none', ws: null }; }
    engClaim(A); refClaim(rf.A, 1);
    if (rf.B) { engClaim(B); refClaim(rf.B, 2); }
    const tick = (p) => { const e = Poi.get(p); return e ? Poi.hasSpace(p) ? 1 : 0 : -1; };
    const eng = [tick(P.comp), tick(P.lect), tick(P.bed), Prof.claimed[k(P.comp)], Prof.claimed[k(P.lect)], A.profession, A.villagerLevel, A.workstation ? k(A.workstation) : null, B.profession, B.workstation ? k(B.workstation) : null].join();
    const free = (p) => rf.broken && p === P.comp ? -1 : rf.tk[k(p)] ? 0 : 1;
    const ref = [free(P.comp), free(P.lect), free(P.bed), rf.owner[k(P.comp)], rf.owner[k(P.lect)], rf.A.p, level, rf.A.ws, rf.B ? rf.B.p : 'none', rf.B ? rf.B.ws : null].join();
    if (eng !== ref) return `tick ${t} ${eng} vs ref ${ref}`;
  }
  return null;
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r, `poi salt ${s}: ${r}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const r = lane(1, true); brk(!!r, `claim radius changed: ${r}`); }
{ Prof.skip.reset = true; const r = lane(6); brk(!!r, `lost-job reset skipped: ${r}`); Prof.skip.reset = false; }
console.log(`lockstep-poi: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
