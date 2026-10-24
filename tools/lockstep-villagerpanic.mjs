// lockstep-villagerpanic.mjs -- #7948 (G18f-L11): 20 salts x 7 scenarios (zombie 6/12, pillager 12, vindicator 9/12 away; hit by a player; hit by a skeleton) over 500 ticks. Per tick: PANIC activity vs an independent reference (VillagerHostilesSensor per-type danger distance on a 20-tick cadence, HURT_BY 40-tick decay, StopPanickingTask 6-block attacker clause), the panic walk speed multiplier 1.5, HURT_BY forgotten at the end of panic, and flee targets never toward the hostile. OWED: golem summon on alert (needs 3 recently-slept villagers) is not compared. Vanilla distances are from .decomp VillagerHostilesSensor (8/15/10), not the issue's 24/12 figures.
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
const Y = 63, TICKS = 500, REMOVE = 200, HIT = 300;
for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
// independent reference: VillagerHostilesSensor.SQUARED_DISTANCES_FOR_DANGER (plain distances), HurtBy 40-tick decay, 20-tick sensor cadence
const DANGER = { zombie: 8, pillager: 15, vindicator: 10 }, PANIC_SPEED = 1.5, HURT_TICKS = 40, STOP = 6, SENSE = 20;
// kind: [hostile type, distance] or [null, 0, attacker type]
const KINDS = [['zombie', 6], ['zombie', 12], ['pillager', 12], ['vindicator', 9], ['vindicator', 12], [null, 0, 'player'], [null, 0, 'skeleton']];
function lane(salt, kind) {
  const [htype, hd, atype] = kind, ang = salt * 0.7;
  Math.random = stream(salt + 1000); VB.rand = stream(salt + 3000); W.seed64 = BigInt(salt + 1) * 7919n; EL.random = stream(salt + 2000);
  EL.clear(); EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0; Prof.claimed = {};
  for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) for (let y = 1; y <= 3; y++) W.setBlock(x, Y + y, z, 0);
  const v = EL.spawn('villager', 0.5, Y + 1, 0.5); v.ai = new Ai.GoalSelector(); v.isBaby = false; v.profession = 'none';
  let h = null; const hostile = htype && (h = EL.spawn(htype, 0.5 + Math.cos(ang) * hd, Y + 1, 0.5 + Math.sin(ang) * hd));
  if (h) { h.ai = null; h.tickFrozen = true; }
  let att = null, panicPrev = false, hitT = -1, cache = null, dangerSeen = 0;
  const tickH = () => { if (h && !h.removed) { h.x = 0.5 + Math.cos(ang) * hd; h.z = 0.5 + Math.sin(ang) * hd; h.y = Y + 1; h.vx = h.vy = h.vz = 0; } };
  const dist = (a) => Math.hypot(a.x - v.x, a.y - v.y, a.z - v.z);
  for (let t = 0; t < TICKS; t++) {
    M.Sky = { dayTime: 1000 + t };
    if (t === REMOVE && h) { EL.remove ? EL.remove(h) : (h.removed = true); h.removed = true; h.dead = true; }
    if (t === HIT && atype) { att = EL.spawn(atype, v.x + 3, Y + 1, v.z); att.ai = null; M.Combat.notifyHurt(v, att); hitT = t; }
    const gone = h && (h.removed || h.dead);
    const preH = h && !gone ? dist(h) : Infinity, preA = att && !att.removed && !att.dead ? dist(att) : Infinity;
    EL.tickOne(v); tickH();
    const tag = 'salt ' + salt + ' ' + (htype || atype) + '@' + hd + ' tick ' + t + ' ';
    // HURT_BY / NEAREST_HOSTILE references (sensor cadence: first run at tick 0 then every 20)
    if (t % SENSE === 0) { cache = h && !gone && preH <= DANGER[htype] ? h : null; }
    const hurt = hitT >= 0 && t - hitT <= HURT_TICKS - 1;
    const byNear = preA <= STOP;
    const want = panicPrev ? (hurt || !!cache || byNear) : (hurt || !!cache);
    const got = v.vbActivity === 'panic';
    if (got !== want) return tag + 'PANIC ' + got + ' want ' + want + (cache ? ' hostile' : '') + (hurt ? ' hurt' : '');
    if (hitT >= 0 && !hurt && !want && (v.vbHurtTick !== undefined || v.lastHurtByEntity)) return tag + 'HURT_BY not forgotten at panic end';
    const wt = v.vbWalkTarget;
    if (got && wt && wt.speedMul !== undefined && wt.speedMul !== PANIC_SPEED) return tag + 'panic speed ' + wt.speedMul;
    if (got && wt && wt.speedMul === PANIC_SPEED && wt.range === VBP_FLEE() && h && cache && !gone && !att) {
      const dt = Math.hypot(wt.x - h.x, wt.z - h.z); if (dt + 0.01 < Math.hypot(v.x - h.x, v.z - h.z)) return tag + 'flee target toward the hostile';
    }
    dangerSeen += got ? 1 : 0; panicPrev = got;
  }
  if (htype && hd <= DANGER[htype] && dangerSeen < 1) return 'salt ' + salt + ' ' + htype + ' never panicked long enough';
  if (atype && dangerSeen < 40) return 'salt ' + salt + ' ' + atype + ' hit never panicked';
  return null;
}
function VBP_FLEE() { return M.VBPanic.FLEE_RANGE; }
const pass = () => salts.flatMap((s) => KINDS.map((k) => lane(s, k))).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
const P = M.VBPanic;
const d0 = Object.assign({}, P.HOSTILE_DANGER_DIST);
P.HOSTILE_DANGER_DIST.zombie = 16; P.HOSTILE_DANGER_DIST.pillager = 24; brk(pass().length > 0, 'hostile range 8 -> 16 caught'); P.HOSTILE_DANGER_DIST = d0;
P.HURT_DECAY_TICKS = 20; brk(pass().length > 0, 'HURT_BY decay 40 -> 20 caught'); P.HURT_DECAY_TICKS = 40;
P.PANIC_SPEED_MUL = 1.0; brk(pass().length > 0, 'panic speed 1.5 -> 1.0 caught'); P.PANIC_SPEED_MUL = 1.5;
P.SENSE_INTERVAL = 10; brk(pass().length > 0, 'sensor cadence 20 -> 10 caught'); P.SENSE_INTERVAL = 20;
P.STOP_MAX_DIST = 2; brk(pass().length > 0, 'stop distance 6 -> 2 caught'); P.STOP_MAX_DIST = 6;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`lockstep-villagerpanic: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
