// villagerschedulelockstepcheck.mjs -- #8650: lockstep scenario villagerschedule, 20 salts x 72000 ticks: per-tick activity + change ticks of adult/baby/farmer villagers vs an independent Schedule.VILLAGER_DEFAULT/BABY reference (.decomp Schedule.java); a baby holds no meeting/job ticket.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '07zv3_vbpanic.js', '07zv4_vbidle.js', '07zv5_vbbreed.js', '07zv6_vbgather.js', '07zv7_vbbell.js', '07zv7_vbgifts.js', '07zv8_vbhidehome.js', '07zv8_vbhold.js', '07zv9_vbdoors.js'];
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
for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
const bedState = () => { const b = R.id.red_bed; for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, R.PROP.part) === R.PVAL.head && SR.propValue(s, R.PROP.occupied) === R.PVAL['false']) return s; };
const bellId = R.id.bell, BELL = R.realFirst[bellId] + R.defaultState[bellId], BED = bedState();
// independent reference: Schedule.VILLAGER_DEFAULT / VILLAGER_BABY keyframes (.decomp Schedule.java)
const REF = { a: [[10, 'idle'], [2000, 'work'], [9000, 'meet'], [11000, 'idle'], [12000, 'rest']], b: [[10, 'idle'], [3000, 'play'], [6000, 'idle'], [10000, 'play'], [12000, 'rest']] };
const refAct = (k, t) => { const d = t % 24000, s = REF[k]; let a = d < s[0][0] ? s[s.length - 1][1] : s[0][1]; for (const r of s) if (r[0] <= d) a = r[1]; return a; };
const N = 72000;
function lane(salt) {
  const r = stream(salt);
  EL.clear(); Prof.claimed = {};
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) W.setBlock(x, Y + 1, z, 0);
  W.setBlock(-3, Y + 1, -3, BED); W.setBlock(3, Y + 1, 3, BED); W.setBlock(0, Y + 1, 2, BELL);
  W.setBlock(4, Y + 1, -3, R.realFirst[R.id.composter] + R.defaultState[R.id.composter]);
  for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick();
  const vs = [];
  for (let i = 0; i < 3; i++) {
    const v = EL.spawn('villager', -2 + r() * 4, Y + 1, -2 + r() * 4); v.ai = new Ai.GoalSelector();
    if (i === 1) v.isBaby = true; if (i === 2) { v.profession = 'farmer'; }
    vs.push(v);
  }
  const prev = vs.map(() => null), changes = vs.map(() => []), refCh = vs.map(() => []), refPrev = vs.map(() => null);
  const t0 = Math.floor(r() * 24000);
  for (let n = 0; n < N; n++) {
    const t = t0 + n;
    M.Sky = { dayTime: t, raining: Math.floor(t / 6000) % 2 === 1 };
    for (let i = 0; i < 3; i++) {
      const v = vs[i], k = v.isBaby ? 'b' : 'a';
      VB.tick(v);
      const want = refAct(k, t), got = v.vbActivity;
      if (got !== want) return 'salt ' + salt + ' villager ' + i + ' tick ' + t + ' activity ' + got + ' want ' + want;
      if (got !== prev[i]) { changes[i].push(t); prev[i] = got; }
      if (want !== refPrev[i]) { refCh[i].push(t); refPrev[i] = want; }
      if (k === 'b' && (v.vbMeeting || v.workstation)) return 'salt ' + salt + ' baby holds meeting/job ticket at ' + t;
      if (n % 97 === 0 && want === 'rest' && t % 24000 > 12500 && !v.vbHome && !v.vbSleeping && vs[i].vbHomeTried) return 'salt ' + salt + ' rest without home';
    }
  }
  for (let i = 0; i < 3; i++) if (changes[i].join() !== refCh[i].join()) return 'salt ' + salt + ' villager ' + i + ' change ticks differ';
  return null;
}
const pass = () => salts.map(lane).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
const old = VB.SCHEDULE[4][0]; VB.SCHEDULE[4][0] = 11000;
brk(pass().length > 0, 'REST keyframe 12000 -> 11000 caught'); VB.SCHEDULE[4][0] = old;
const ob = VB.SCHEDULE_BABY[3][0]; VB.SCHEDULE_BABY[3][0] = 9000;
brk(pass().length > 0, 'baby PLAY keyframe 10000 -> 9000 caught'); VB.SCHEDULE_BABY[3][0] = ob;
ok(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagerschedulelockstepcheck: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
