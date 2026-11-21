// lockstep-villagerpoi.mjs -- #8651 (G18f-L16): 20 salts x 3000 ticks, 6 villagers, 3 beds, 2 workstations (lectern, composter), 1 bell; the lectern is broken at tick 600 and a bed at tick 900. Per tick: every POI's ticket count equals the villagers holding it (HOME/JOB cap 1, MEETING cap 32 -- PointOfInterestType.register), no shared bed or workstation, JOB_SITE always has a claim and a profession, the break frees the claim, the memory and the profession (LoseJobOnSiteLossTask), a broken bed leaves the POI storage. OWED: claim ORDER between villagers is not compared (pathing decides it).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const { World: W, CH, States: SR, Poi, Ai, VB, EntityList: EL, Profession: Prof } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
W.init(1); M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init(); Ai.init(); Prof.init(); if (M.Combat && M.Combat.init) M.Combat.init();
for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 63, TICKS = 3000, JOB_BREAK = 600, BED_BREAK = 900, TICKET = { home: 1, meeting: 32, job: 1 };
for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
const R = M.Reg, bedHeads = [];
for (let s = R.realFirst[R.id.red_bed]; s < R.realFirst[R.id.red_bed + 1]; s++) if (SR.propValue(s, R.PROP.part) === R.PVAL.head) bedHeads.push(s);
const BELL = R.realFirst[R.id.bell] + R.defaultState[R.id.bell];
const BEDS = [[4, 4], [-4, 5], [5, -5]], JOBS = [['lectern', 6, 0], ['composter', -6, 1]], BELLPOS = [0, 7];
const P = (x, y, z) => ({ x, y, z });
// independent reference: PointOfInterestType ticketCount (home 1, meeting 32, job sites 1), PointOfInterestStorage.remove on break
function lane(salt) {
  Math.random = stream(salt + 1000); VB.rand = stream(salt + 3000); W.seed64 = BigInt(salt + 1) * 7919n; EL.random = stream(salt + 2000);
  EL.clear(); EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0; Prof.claimed = {};
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) for (let y = 1; y <= 3; y++) W.setBlock(x, Y + y, z, 0);
  BEDS.forEach(([x, z]) => W.setBlock(x, Y + 1, z, bedHeads[0]));
  JOBS.forEach(([n, x, z]) => W.setBlock(x, Y + 1, z, SR.stateOf(n)));
  W.setBlock(BELLPOS[0], Y + 1, BELLPOS[1], BELL);
  Poi.init(); Poi.rescanNow();
  const vs = [];
  for (let i = 0; i < 6; i++) { const v = EL.spawn('villager', 0.5 + (i % 3) - 1, Y + 1, 0.5 + (i >> 1) - 1); v.ai = new Ai.GoalSelector(); v.isBaby = false; v.profession = 'none'; vs.push(v); }
  const tk = (p) => { const e = Poi.get(p); return e ? e.ticket : 0; };
  const sites = [].concat(BEDS.map(([x, z]) => P(x, Y + 1, z)), JOBS.map(([, x, z]) => P(x, Y + 1, z)), [P(BELLPOS[0], Y + 1, BELLPOS[1])]);
  let jobGone = false, bedGone = false, sawMeet = 0, sawHome = 0, sawJob = 0;
  const jobHolderBefore = {};
  for (let t = 0; t < TICKS; t++) {
    M.Sky = { dayTime: 7000 + t };
    if (t === JOB_BREAK) { const p = P(6, Y + 1, 0); vs.forEach((v) => { if (v.workstation && v.workstation.x === 6) jobHolderBefore.id = v.id; }); W.setBlock(6, Y + 1, 0, 0); Prof.releaseAt(6, Y + 1, 0); Poi.rescanNow(); jobGone = true; }
    if (t === BED_BREAK) { W.setBlock(4, Y + 1, 4, 0); Poi.rescanNow(); bedGone = true; }
    for (const v of vs) EL.tickOne(v);
    const tag = 'salt ' + salt + ' tick ' + t + ' ';
    for (const p of sites) {
      const e = Poi.get(p);
      let n = 0;
      for (const v of vs) {
        for (const f of ['vbHome', 'vbMeeting', 'vbPotentialJob']) { const h = v[f]; if (h && h.x === p.x && h.y === p.y && h.z === p.z) n++; }
        const w = v.workstation; if (w && w.x === p.x && w.y === p.y && w.z === p.z) n++;
      }
      if (!e) { if (n && ((p.x === 4 && p.z === 4 && !bedGone) || (p.x === 6 && p.z === 0 && !jobGone))) return tag + 'POI missing with holders'; continue; }
      const cap = TICKET[e.type === Poi.HOME ? 'home' : e.type === Poi.MEETING ? 'meeting' : 'job'];
      if (e.ticket > cap) return tag + e.type + ' ticket ' + e.ticket + ' over cap ' + cap;
      if (e.ticket !== n) return tag + e.type + '@' + p.x + ',' + p.z + ' ticket ' + e.ticket + ' but ' + n + ' holders';
      if (e.type === Poi.MEETING) sawMeet = Math.max(sawMeet, e.ticket);
      if (e.type === Poi.HOME) sawHome = Math.max(sawHome, e.ticket);
    }
    const homes = vs.filter((v) => v.vbHome).map((v) => v.vbHome.x + ',' + v.vbHome.z);
    if (new Set(homes).size !== homes.length) return tag + 'two villagers share a bed';
    const owners = Object.values(Prof.claimed);
    if (new Set(owners).size !== owners.length) return tag + 'one villager claims two workstations';
    for (const v of vs) if (v.workstation) { sawJob++; if (Prof.claimed[v.workstation.x + ',' + v.workstation.y + ',' + v.workstation.z] !== v.id) return tag + 'JOB_SITE without claim'; if (v.profession === 'none') return tag + 'JOB_SITE with no profession'; }
    if (jobGone) {
      if (Prof.claimed['6,' + (Y + 1) + ',0'] !== undefined) return tag + 'claim survived the workstation break';
      for (const v of vs) if (v.workstation && v.workstation.x === 6 && v.workstation.z === 0) return tag + 'JOB_SITE memory survived the break';
      if (jobHolderBefore.id) { const h = EL.byId(jobHolderBefore.id); if (t === JOB_BREAK && h.profession !== 'none') return tag + 'profession not reset on job loss: ' + h.profession; }
    }
    if (bedGone && Poi.get(P(4, Y + 1, 4))) return tag + 'broken bed still a POI';
  }
  if (sawHome < 1) return 'salt ' + salt + ' no bed ever claimed';
  if (sawMeet < 6) return 'salt ' + salt + ' meeting ticket peaked at ' + sawMeet + ' want 6 (cap 32)';
  return null;
}
const pass = () => salts.map(lane).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
const tcf = Poi.TICKET_COUNT, t0 = tcf.meeting;
tcf.meeting = 1; brk(pass().length > 0, 'MEETING ticket count 32 -> 1 caught'); tcf.meeting = t0;
tcf.home = 2; brk(pass().length > 0, 'HOME ticket count 1 -> 2 caught'); tcf.home = 1;
Prof.skip.reset = true; brk(pass().length > 0, 'lost job keeping the profession caught'); Prof.skip.reset = false;
Prof.skip.holder = true; brk(pass().length > 0, 'broken workstation not freeing its holder caught'); Prof.skip.holder = false;
const ra = Prof.releaseAt; Prof.releaseAt = () => null; brk(pass().length > 0, 'workstation break never reaching LoseJobOnSiteLoss caught'); Prof.releaseAt = ra;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`lockstep-villagerpoi: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
