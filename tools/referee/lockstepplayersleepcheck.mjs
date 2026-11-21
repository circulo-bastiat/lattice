// lockstep-playersleep -- #6864 (G17-L163): lockstep scenario 'playersleep', 20 salts: one scripted player uses a bed at a random time of day, with / without a zombie
// inside (or just outside) the 8x5x8 box, sometimes creative, sometimes too far, sometimes raining/thundering. Reference = .decomp ServerPlayerEntity.trySleep order
// (dead/asleep silent -> too far -> obstructed -> setSpawnPoint -> day -> monsters unless creative), PlayerEntity.tick sleepTimer (+1, cap 100), ServerWorld.tick sleep skip
// (one player: asleep with timer>=100 -> time to next day start, rain+thunder cleared, wake with timer 0), wake position = BedBlock.findWakeUpPosition first around-bed candidate (head + side offset d1=(-1,0), y of the bed cell).
// Per tick: sleeping, sleepTimer, world time, raining/thundering, the failed-sleep message, spawn point and (after waking) position are compared.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '07za_explosion.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
  '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14e_gamemode.js', '09b_sky.js',
  '07zq_snowgolem.js', '14f_inventory.js', '14j_combat.js', '14_player.js', '14l_use.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07k_goals.js',
  '07zv_villagerbrain.js', '07zz1_phantom.js', '14m_sleep.js', '10_camera.js', '10_gfx.js', '14i_hand.js', '14k_hand3d.js'], dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'),
  monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8'))[1]) });
M.Entities.init();
const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, EL = M.EntityList, Sky = M.Sky, Sleep = M.Sleep;
W.init(1); M.Behave.init(W); if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init(); EL.init(); M.Ai.init(); M.Use.init(W); Sleep.init(W);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const bedState = (part) => { const b = R.id.red_bed, P_ = R.PROP, V = R.PVAL; for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, P_.part) === V[part] && SR.propValue(s, P_.facing) === V.south && SR.propValue(s, P_.occupied) === V['false']) return s; };
const HEAD = bedState('head'), FOOT = bedState('foot'), STONE = SR.stateOf('stone');
const BY = 64, BZ = 0;
let msgs = [];
M.Hud = { say(m) { msgs.push(m); } };
const MSG = { far: 'You are too far away to sleep', day: 'You can only sleep at night and during thunderstorms', mon: 'You may not rest now; there are monsters nearby' };

function lane(salt) {
  const r = stream(salt);
  for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) { W.setBlock(x, BY - 1, z, STONE); W.setBlock(x, BY, z, 0); W.setBlock(x, BY + 1, z, 0); }
  W.setBlock(0, BY, BZ, FOOT); W.setBlock(0, BY, BZ + 1, HEAD);
  EL.list.length = 0; EL.nextId = 1; msgs = [];
  const night = r() < 0.6, t0 = night ? Math.floor(14000 + r() * 7000) : Math.floor(1000 + r() * 10000);
  const raining = r() < 0.5, thunder = raining && r() < 0.5, creative = r() < 0.2, far = r() < 0.15;
  const mon = r() < 0.5, monIn = mon && r() < 0.7;
  if (mon) { const d = monIn ? 1 + r() * 5 : 9 + r() * 3; EL.spawn('zombie', 0.5 + d, BY, BZ + 1.5); }
  Sky.dayTime = t0; Sky.weather = Sky.newWeather();
  if (raining) { Sky.weather.raining = true; Sky.weather.rainLevel = 1; Sky.weather.rainTime = 5000; }
  if (thunder) { Sky.weather.thundering = true; Sky.weather.thunderTime = 5000; }
  const P = { x: far ? 20 : 0.5, y: BY, z: far ? 20 : BZ + 0.5, px: 0, py: 0, pz: 0, ex: 0, ey: 0, ez: 0, vx: 0, vy: 0, vz: 0, yaw: 0, sleeping: false, sleepPos: null, sleepTimer: 0,
    spawnPoint: null, dead: false, mode: creative ? 1 : 0 };
  // reference
  const ref = { sleeping: false, timer: 0, time: t0, rain: raining, thunder, spawn: null, msg: null, wake: null };
  if (far) ref.msg = MSG.far;
  else {
    ref.spawn = '0,' + BY + ',' + (BZ + 1);
    if (night) { if (!creative && monIn) ref.msg = MSG.mon; else ref.sleeping = true; } else ref.msg = MSG.day;
  }
  M.Use.blockUse(P, 0, BY, BZ + 1, HEAD, null);
  const cmp = (t) => {
    const sp = P.spawnPoint ? P.spawnPoint.x + ',' + P.spawnPoint.y + ',' + P.spawnPoint.z : null;
    const w = Sky.weather;
    const got = [P.sleeping, P.sleepTimer || 0, Math.floor(Sky.dayTime), !!w.raining, !!w.thundering, sp, msgs.filter((m) => m !== 'Respawn point set')[0] || null].join('|');
    const exp = [ref.sleeping, ref.timer, ref.time, ref.rain, ref.thunder, ref.spawn, ref.msg].join('|');
    if (got !== exp) return `t${t}: ${got} vs ${exp}`;
    if (ref.wake && (P.x !== ref.wake[0] || P.y !== ref.wake[1] || P.z !== ref.wake[2])) return `t${t}: wake pos ${P.x},${P.y},${P.z}`;
    return null;
  };
  let e = cmp(0); if (e) return e;
  for (let t = 1; t <= 130; t++) {
    Sky.dayTime++; ref.time++;
    Sleep.tick(P);
    if (ref.sleeping) {
      ref.timer = Math.min(100, ref.timer + 1);
      if (ref.timer >= 100) { ref.time = ref.time - (ref.time % 24000) + 24000; ref.rain = false; ref.thunder = false; ref.sleeping = false; ref.timer = 0; ref.wake = [-0.5, BY, BZ + 1.5]; }
    }
    e = cmp(t); if (e) return e;
  }
  return null;
}
let slept = 0, refused = 0, skipped = 0;
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r, `playersleep salt ${s}: ${r}`); }
// coverage: replay with the engine to count outcomes
for (let s = 0; s < 20; s++) { lane(s); if (Sky.dayTime >= 24000 && Sky.dayTime < 24200) skipped++; if (msgs.some((m) => /monsters|only sleep|too far/.test(m))) refused++; else slept++; }
ok(skipped > 3 && refused > 3 && slept > 3, `salts exercise sleep, refusal and night skip (${slept}/${refused}/${skipped})`);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const any = () => { for (let s = 0; s < 20; s++) if (lane(s)) return true; return false; };
{ const o = Sleep.tick; Sleep.tick = (P) => { if (P.sleeping && P.sleepTimer === 98) { P.sleepTimer = 99; Sleep.wake(P, true); return; } o(P); }; brk(any(), 'wake at timer 99'); Sleep.tick = o; }
{ const o = Sleep.use; Sleep.use = (P, x, y, z, st) => { const d = Sky.isDay; Sky.isDay = () => false; try { return o(P, x, y, z, st); } finally { Sky.isDay = d; } }; brk(any(), 'daytime sleep allowed'); Sleep.use = o; }
{ const o = Sleep.tick; Sleep.tick = (P) => { const wt = Sky.weather, ra = wt.raining, th = wt.thundering, s = P.sleeping; o(P); if (s && !P.sleeping) { wt.raining = ra; wt.thundering = th; } }; brk(any(), 'weather not cleared on wake'); Sleep.tick = o; }
console.log(`lockstep-playersleep: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
