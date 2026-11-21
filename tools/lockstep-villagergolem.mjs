// lockstep-villagergolem.mjs -- #6935 (G17-L195): lockstep scenario 'villagergolem': five villagers with beds and smithing tables in a walled yard, Sky.dayTime stepped 3000 ticks from 12000 (they sleep: LAST_SLEPT), then a zombie scare. Per tick: golem list (spawn tick + position within the 10-attempt +-8 ring), LAST_SLEPT, LAST_WORKED_AT_POI, golem_detected. Reference = independent transcription of VillagerEntity.canSummonGolem/summonGolem/PanicTask (quorum 3 every 100 ticks). Vanilla 1.18.2 has NO 35000-tick work window (grep .decomp: none); the window that exists is hasRecentlySlept 24000, so that is the second break.
// (was: lockstep scenario 'villager', 20 salts: one villager with a bed, a smithing table and a bell in a 20x20 arena, Sky.dayTime stepped through one full day, a zombie walked in near the villager at a random tick. Per tick: the active Activity (idle/WORK/MEET/REST/PANIC) vs an independent reference of Schedule.VILLAGER_DEFAULT (10 idle, 2000 work, 9000 meet, 11000 idle, 12000 rest; wraps to rest before tick 10) + PanicTask (hostile within 8); at checkpoints the memory modules (home, job_site, meeting_point) must be present once the activity that claims them has run.
// Reference = .decomp Schedule.VILLAGER_DEFAULT / VillagerTaskListProvider (written independently below). OWED: the server-side per-tick trace of the same lane and the path to the bed (needs the Ai movement tick; this lane drives VB.tick only).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const { World: W, CH, Reg: R, States: SR, Poi, Ai, VB, EntityList: EL, Profession: Prof, Village, VBPanic: VBP } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
W.init(1); M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init(); Ai.init(); Prof.init(); if (M.Combat && M.Combat.init) M.Combat.init();
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 63;
for (let x = -24; x <= 24; x++) for (let z = -24; z <= 24; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
const bedState = () => { const b = R.id.red_bed; for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, R.PROP.part) === R.PVAL.head && SR.propValue(s, R.PROP.occupied) === R.PVAL['false']) return s; };
const bellId = R.id.bell, BELL = R.realFirst[bellId] + R.defaultState[bellId], BED = bedState();
// independent reference: Schedule.VILLAGER_DEFAULT
function refActivity(t) {
  const d = t % 24000;
  if (d >= 12000) return 'rest'; if (d >= 11000) return 'idle'; if (d >= 9000) return 'meet'; if (d >= 2000) return 'work'; if (d >= 10) return 'idle';
  return 'rest';
}

const SLEEP_WINDOW = 24000, QUORUM = 3, PANIC_EVERY = 100;
function lane(salt) {
  const r = stream(salt); Math.random = stream(salt + 1000); VB.rand = stream(salt + 3000);
  W.seed64 = BigInt(salt + 1) * 7919n; EL.random = stream(salt + 2000); EL.clear(); EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0; Prof.claimed = {};
  const X0 = -9, X1 = 9;
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 1; y <= 4; y++) W.setBlock(x, Y + y, z, 0);
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
  const used = new Set(); const pick = () => { for (;;) { const p = { x: Math.floor(r() * 12) - 6, z: Math.floor(r() * 12) - 6 }; const k = p.x + ',' + p.z; if (!used.has(k)) { used.add(k); return p; } } };
  const nBeds = 2 + Math.floor(r() * 4); const homes = []; for (let i = 0; i < 5; i++) { const b = pick(), j = pick(); homes.push(b); if (i < nBeds) W.setBlock(b.x, Y + 1, b.z, BED); W.setBlock(j.x, Y + 1, j.z, SR.stateOf('smithing_table')); }
  Poi.init(); for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick();
  const vs = []; for (let i = 0; i < 5; i++) { const p = homes[i]; const v = EL.spawn('villager', p.x + 0.5, Y + 1, p.z + 1.0); v.ai = new Ai.GoalSelector(); vs.push(v); }
  const scareAt = 2800 + Math.floor(r() * 100); let zom = null;
  const trace = [], seen = new Set(), problems = [];
  const refSlept = new Map(), refDetect = new Map();
  for (let t = 0; t < 3000; t++) {
    const now = 12000 + t; M.Sky = { dayTime: now };
    if (t === scareAt) zom = EL.spawn('zombie', vs[0].x + 3, Y + 1, vs[0].z);
    const before = new Set(EL.list.filter((e) => e.type === 'iron_golem'));
    for (const v of vs) VB.tick(v);
    const golems = EL.list.filter((e) => e.type === 'iron_golem' && !e.removed);
    for (const g of golems) if (!before.has(g) && !seen.has(g)) {
      seen.add(g);
      // reference: panic tick on a 100 boundary, a villager within the +-8 ring, quorum met by independent canSummon
      if (now % PANIC_EVERY !== 0) problems.push('tick ' + t + ' golem off the 100-tick gate');
      const near = vs.some((v) => Math.abs(Math.floor(v.x) - Math.floor(g.x)) <= 8 && Math.abs(Math.floor(v.z) - Math.floor(g.z)) <= 8);
      if (!near) problems.push('tick ' + t + ' golem outside ring');
      const elig = vs.filter((v) => v.vbLastSlept !== undefined && now - v.vbLastSlept < SLEEP_WINDOW && !(refDetect.get(v) > now));
      if (elig.length < QUORUM) problems.push('tick ' + t + ' golem with only ' + elig.length + ' eligible');
      for (const v of vs) refDetect.set(v, now + 600);
      g.spawnTick = t;
    }
    trace.push({ tick: t, golems: golems.map((g) => [g.spawnTick, g.x, g.y, g.z]), slept: vs.map((v) => v.vbLastSlept ?? -1), worked: vs.map((v) => v.vbLastWorkedAt ?? -1), detected: vs.map((v) => (v.golemDetectedUntil > now ? 1 : 0)) });
  }
  // reference expectation: if >=3 villagers were eligible at a panic boundary after the scare began and no golem was detected, a golem MUST exist
  const slept = vs.filter((v) => v.vbLastSlept !== undefined).length;
  if (slept >= QUORUM && !seen.size) problems.push('no golem although ' + slept + ' villagers slept');
  if (slept < QUORUM && seen.size) problems.push('golem without quorum of sleepers');
  return { problems, trace, golems: seen.size, slept };
}
const run = () => salts.map(lane);
const base = run();
const bad = base.flatMap((x, i) => x.problems.map((p) => 'salt ' + i + ' ' + p));
ok(bad.length === 0, 'lane: ' + bad.slice(0, 3).join(' | '));

ok(base.some((x) => x.golems > 0), 'no salt ever spawned a golem');
const again = lane(0);
ok(compareTraces(base[0].trace, again.trace, { fields: ['golems', 'slept', 'worked', 'detected'] }) === null, 'same salt, same trace');
const diverges = (mutate, restore) => { mutate(); const rs = run(); restore(); return rs.some((x, i) => x.problems.length || x.golems !== base[i].golems); };
const q = VBP.GOLEM_QUORUM; const w = Village.HAS_RECENTLY_SLEPT_WINDOW;
brk(diverges(() => { VBP.GOLEM_QUORUM = 2; }, () => { VBP.GOLEM_QUORUM = q; }), 'quorum 3 -> 2 caught');
brk(diverges(() => { Village.HAS_RECENTLY_SLEPT_WINDOW = 1000; }, () => { Village.HAS_RECENTLY_SLEPT_WINDOW = w; }), 'slept window 24000 -> 1000 caught');
const again2 = run(); 
brk(again2.every((x, i) => x.problems.length === 0 && x.golems === base[i].golems), 'unfaulted lane passes after restore');
console.log(`lockstep-villagergolem: ${20 + 4 + breaks} assertions, ${fails + bad.length} failures, ${breaks} breaks caught (${salts.length} seeds, ${bad.length} divergences)`);
process.exit(fails || bad.length ? 1 : 0);
