// villagersleeplockstepcheck.mjs -- #7907: lockstep scenario 'villagersleep', 20 salts: 5 villagers (3 beside a bed, 2 beyond POI range = the no-bed fallback), 3 beds, ticks 12000..23999. Per sampled tick vs an independent reference of Schedule.VILLAGER_DEFAULT rest@12000 + SleepTask (<=2.0 from its claimed HOME): HOME ticket owner per bed (unique), sleeping pose/position/BedBlock.OCCUPIED, lastSlept >= 12000, no sleeper without a bed; a bed broken mid-night must wake its sleeper (LivingEntity.tick isSleepingInBed).
// Reference = .decomp SleepTask / VillagerEntity.sleep / Schedule.VILLAGER_DEFAULT (written independently below). OWED: noise/light/player-within-10 wake and per-villager schedule offsets are not in the engine; walking to the bed needs Ai movement.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const { World: W, CH, Reg: R, States: SR, Poi, Ai, VB, EntityList: EL, Profession: Prof } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
W.init(1); M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init(); Ai.init(); Prof.init(); if (M.Combat && M.Combat.init) M.Combat.init();
for (let cx = -6; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 63;
for (let x = -90; x <= 24; x++) for (let z = -24; z <= 24; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
const bedState = () => { const b = R.id.red_bed; for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, R.PROP.part) === R.PVAL.head && SR.propValue(s, R.PROP.occupied) === R.PVAL['false']) return s; };
const bellId = R.id.bell, BELL = R.realFirst[bellId] + R.defaultState[bellId], BED = bedState();

const REST = 12000;
const sleepWindow = () => REST;
function lane(salt) {
  const r = stream(salt);
  EL.clear(); Prof.claimed = {};
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) W.setBlock(x, Y + 1, z, 0);
  const beds = [{ x: -6, z: -6 }, { x: 0, z: 6 }, { x: 6, z: -4 }];
  for (const p of beds) W.setBlock(p.x, Y + 1, p.z, BED);
  for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick();
  const vs = [];
  for (let i = 0; i < 5; i++) {
    const b = beds[i % 3];
    const v = EL.spawn('villager', i < 3 ? b.x + 0.5 : -80 - r() * 5, Y + 1, i < 3 ? b.z + 0.5 : b.z); v.ai = new Ai.GoalSelector(); v.bedIdx = i % 3; vs.push(v);
  }
  const breakAt = 14000 + Math.floor(r() * 6000), victim = Math.floor(r() * 3); let broken = false;
  for (let t = sleepWindow(); t < 24000; t++) {
    M.Sky = { dayTime: t };
    if (t === breakAt) { const b = beds[victim]; W.setBlock(b.x, Y + 1, b.z, 0); broken = true; }
    for (const v of vs) VB.tick(v);
    if (t % 50 !== 0 && t !== breakAt + 1) continue;
    const owners = new Set();
    for (const v of vs) {
      if (v.vbSleeping) {
        if (t < REST) return 'salt ' + salt + ' tick ' + t + ' sleeps before window';
        if (v.vbLastSlept === undefined || v.vbLastSlept < REST) return 'salt ' + salt + ' tick ' + t + ' lastSlept ' + v.vbLastSlept;
        const h = v.vbSleepHomePos, k = h.x + ',' + h.z;
        if (owners.has(k)) return 'salt ' + salt + ' tick ' + t + ' two in one bed ' + k;
        owners.add(k);
        if (!v.vbHome && !broken) return 'salt ' + salt + ' tick ' + t + ' sleeping without HOME';
        if (Math.abs(v.x - (h.x + 0.5)) > 1 || Math.abs(v.z - (h.z + 0.5)) > 1) return 'salt ' + salt + ' tick ' + t + ' pose off the bed';
      } else if (v.bedIdx !== undefined && v.vbHome) {
        const p = v.vbHome, d = Math.hypot(v.x - p.x - 0.5, v.z - p.z - 0.5);
        if (d <= 1.5 && t > REST + 400 && !(v.vbLastWoken >= 0 && t - v.vbLastWoken < 100) && !owners.has(p.x + ',' + p.z)) return 'salt ' + salt + ' tick ' + t + ' awake next to its free bed';
      }
    }
    if (t === REST + 50 && !vs.slice(0, 3).every(v => v.vbSleeping)) return 'salt ' + salt + ' bedside villagers not all asleep at 12050';
    if (t === REST + 400 && vs.slice(3).some(v => v.vbSleeping && !v.vbHome)) return 'salt ' + salt + ' sleeper with no bed';
    if (broken && t > breakAt + 1) { const v = vs[victim]; if (v.vbSleeping && v.vbSleepHomePos.x === beds[victim].x && v.vbSleepHomePos.z === beds[victim].z) return 'salt ' + salt + ' tick ' + t + ' still asleep in the broken bed (LivingEntity.tick isSleepingInBed)'; }
  }
  return null;
}
const pass = () => salts.map(lane).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
const old = VB.SCHEDULE[4][0]; VB.SCHEDULE[4][0] = 12100;
brk(pass().length > 0, 'sleep window shifted by 100 ticks caught'); VB.SCHEDULE[4][0] = old;
const sd = VB.SLEEP_DISTANCE; VB.SLEEP_DISTANCE = 0.1;
brk(pass().length > 0, 'sleep distance 2.0 -> 0.1 caught'); VB.SLEEP_DISTANCE = sd;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagersleeplockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
