// villagerlockstepcheck.mjs -- #6303 (G17-L55): lockstep scenario 'villager', 20 salts: one villager with a bed, a smithing table and a bell in a 20x20 arena, Sky.dayTime stepped through one full day, a zombie walked in near the villager at a random tick. Per tick: the active Activity (idle/WORK/MEET/REST/PANIC) vs an independent reference of Schedule.VILLAGER_DEFAULT (10 idle, 2000 work, 9000 meet, 11000 idle, 12000 rest; wraps to rest before tick 10) + PanicTask (hostile within 8); at checkpoints the memory modules (home, job_site, meeting_point) must be present once the activity that claims them has run.
// Reference = .decomp Schedule.VILLAGER_DEFAULT / VillagerTaskListProvider (written independently below). OWED: the server-side per-tick trace of the same lane and the path to the bed (needs the Ai movement tick; this lane drives VB.tick only).
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
function lane(salt) {
  const r = stream(salt);
  EL.clear(); Prof.claimed = {};
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) W.setBlock(x, Y + 1, z, 0);
  const pos = () => ({ x: Math.floor(r() * 18) - 9, z: Math.floor(r() * 18) - 9 });
  let bed = pos(), bell = pos(); const job = { x: 1, z: 0 };
  while ((bed.x === 1 && bed.z === 0) || (bed.x === 0 && bed.z === 0)) bed = pos();
  while ((bell.x === 1 && bell.z === 0) || (bell.x === bed.x && bell.z === bed.z)) bell = pos();
  for (const p of [bed, bell, job]) W.setBlock(p.x, Y + 1, p.z, 0);
  W.setBlock(bed.x, Y + 1, bed.z, BED); W.setBlock(bell.x, Y + 1, bell.z, BELL); W.setBlock(job.x, Y + 1, job.z, SR.stateOf('smithing_table'));
  for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick();
  const v = EL.spawn('villager', 0.5, Y + 1, 0.5); v.ai = new Ai.GoalSelector();
  const panicAt = 3000 + Math.floor(r() * 18000), panicLen = 60 + Math.floor(r() * 40);
  let zom = null; const mem = {};
  for (let t = 0; t < 24000; t++) {
    M.Sky = { dayTime: t };
    if (t === panicAt) zom = EL.spawn('zombie', 4.5, Y + 1, 0.5);
    if (t === panicAt + panicLen && zom) { zom.removed = true; zom.dead = true; zom = null; }
    VB.tick(v);
    if (t < panicAt || t >= panicAt + panicLen + 80) {
      const ref = refActivity(t);
      if (v.vbActivity !== ref) return 'salt ' + salt + ' tick ' + t + ' eng ' + v.vbActivity + ' ref ' + ref;
    } else if (t > panicAt + 20 && t < panicAt + panicLen && v.vbActivity !== 'panic') return 'salt ' + salt + ' tick ' + t + ' no panic, eng ' + v.vbActivity;
    if (t === 8999) mem.job = !!v.workstation;
    if (t === 10999) mem.meet = !!v.vbMeeting;
    if (t === 23999) mem.home = !!v.vbHome;
  }
  if (!mem.job || !mem.meet || !mem.home) return 'salt ' + salt + ' memories ' + JSON.stringify(mem);
  return null;
}
const pass = () => salts.map(lane).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
const old = VB.SCHEDULE[1][0]; VB.SCHEDULE[1][0] = 2001;
brk(pass().length > 0, 'work start 2000 -> 2001 caught'); VB.SCHEDULE[1][0] = old;
const m0 = VB.SCHEDULE[2][0]; VB.SCHEDULE[2][0] = 8999;
brk(pass().length > 0, 'meet start 9000 -> 8999 caught'); VB.SCHEDULE[2][0] = m0;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagerlockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
