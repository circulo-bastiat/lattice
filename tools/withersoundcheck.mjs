#!/usr/bin/env node
// withersoundcheck.mjs — #947: WitherEntity world events 1022 (break block), 1023 (spawn), 1024 (shoot).
// ambient/hurt/death are the generic mob-voice path (golden mob-sounds tsv); this check owns the three events.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js',
  '07zzi_ghast.js', '07zzm_wither.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const Wi = MCL.Wither, EL = MCL.EntityList;
let fails = 0, pass = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };

// 1. every event id resolves to a real SoundEvents registration (and the three voices are in the golden table)
const se = join(MCLITE_ROOT, '.decomp/net/minecraft/sound/SoundEvents.java');
if (existsSync(se)) {
  const src = readFileSync(se, 'utf8');
  for (const id of [1022, 1023, 1024]) ok(src.includes('register("' + Wi.EVENT_SOUND[id] + '")'), 'event ' + id + ' -> real sound ' + Wi.EVENT_SOUND[id]);
}
const tsv = readFileSync(join(MCLITE_ROOT, 'tools/golden/mob-sounds-1.18.2.tsv'), 'utf8').split('\n').find(l => l.startsWith('wither\t'));
for (const v of ['ambient', 'hurt', 'death']) ok(tsv.includes('entity.wither.' + v), 'golden voice ' + v);

function run() {
  const played = [];
  MCL.Sound = MCL.Sound || {};
  MCL.Sound.play = (id, o) => { played.push([id, o]); return true; };
  MCL.Sound.listenerNow = () => ({ x: 0, y: 0, z: 0 });
  const e = { type: 'wither', x: 10.3, y: 70, z: 5.5, health: 100, maxHealth: 300, age: 1, silent: false, dead: false };
  Wi.shootSkullAt(e, 0, 0, 70, 0);
  const shoot = played.slice();
  played.length = 0;
  Wi.playEvent(e, 1023);
  const spawn = played.slice();
  played.length = 0;
  // 1023 on invuln expiry only
  Wi.setInvulTimer && Wi.setInvulTimer(e, 2);
  Wi.tickInvuln(e); const mid = played.length;
  Wi.tickInvuln(e); const end = played.slice();
  played.length = 0;
  // 1022 only if a block broke
  e.blockBreakingCooldown = 1; Wi.tickBlockBreaking(e); const noBlock = played.length;
  const W = MCL.World, CH = MCL.CH;
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const stone = MCL.States.stateOf('stone');
  W.setBlock(10, 71, 5, stone);
  e.blockBreakingCooldown = 1; Wi.tickBlockBreaking(e); const broke = played.map(p => p[0]);
  played.length = 0;
  const s = e.silent; e.silent = true; Wi.shootSkullAt(e, 0, 0, 70, 0); const silent = played.length; e.silent = s;
  played.length = 0;
  e.silent = true; Wi.setInvulTimer && Wi.setInvulTimer(e, 1); Wi.tickInvuln(e); const silentSpawn = played.length; e.silent = s;
  return { silentSpawn, shoot, spawn, mid, end, noBlock, silent, broke };
}
function verdict() {
  const r = run();
  return r.shoot.length >= 1 && r.shoot[0][0] === 'entity.wither.shoot' && r.shoot[0][1].volume === 2.0 && r.shoot[0][1].source === 'hostile' &&
    r.spawn.length === 1 && r.spawn[0][0] === 'entity.wither.spawn' && r.spawn[0][1].volume === 1.0 &&
    Math.hypot(r.spawn[0][1].x, r.spawn[0][1].y - 0, r.spawn[0][1].z) < 2.001 &&
    r.mid === 0 && r.end.some(p => p[0] === 'entity.wither.spawn') && r.noBlock === 0 && r.broke.includes('entity.wither.break_block') && r.silent === 0 && r.silentSpawn === 0;
}
ok(verdict(), 'shoot 1024 (vol 2, hostile), spawn 1023 at expiry only, 1022 only on a break, silent mutes shoot');
const saved = Object.assign({}, Wi.EVENT_SOUND);
Wi.EVENT_SOUND[1024] = 'x'; if (!verdict()) breaks++; Wi.EVENT_SOUND[1024] = saved[1024];
Wi.EVENT_SOUND[1023] = 'x'; if (!verdict()) breaks++; Wi.EVENT_SOUND[1023] = saved[1023];
const pe = Wi.playEvent; Wi.playEvent = () => false; if (!verdict()) breaks++; Wi.playEvent = pe;
ok(breaks === 3, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
