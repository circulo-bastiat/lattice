// riptide lockstep check -- #6731 (G17-L134): lockstep scenario 'riptide'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14e_gamemode.js', '14i_hand.js',
  '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = { getBlock: () => 0, setBlock: () => true, blockLightAt: () => 15 };
M.World = W; M.Behave.init(W); M.BlockEntities.init(); M.Behave.clearSchedule();
if (M.Redstone && M.Redstone.init) M.Redstone.init();
M.Entities.init(); M.EntityList.init(); M.Combat.init(); M.Use.init(W);
const { Inventory: Iv, Use, EntityList: EL } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// Reference = .decomp TridentItem.onStoppedUsing riptide branch: f7 = 3.0F * ((1 + level) / 4.0F) times the look vector,
// 20 riptide ticks, on-ground nudge move(0, 1.1999999, 0), durability 1, stack kept; LivingEntity.tickRiptide: count down,
// a mob in the box ends it (v * -0.2); dry land (no water/rain) = no use at all.
const K = { f: 3.0 };
function lane(salt, level, wet, hitMob) {
  EL.list.length = 0;
  const r = stream(salt); Math.random = r; EL.random = r;
  const yaw = r() * 6.28, pit = (r() - 0.5) * 1.2;
  const look = [-Math.sin(yaw) * Math.cos(pit), -Math.sin(pit), Math.cos(yaw) * Math.cos(pit)];
  const ground = r() < 0.5;
  const P = { inventory: Iv.create(), slot: 0, instabuild: false, usingItem: false, useHand: 0, useTicks: 0, x: 0, y: 64, z: 0, ex: 0, ey: 64, ez: 0, EYE: 1.62,
    vx: 0, vy: 0, vz: 0, onGround: ground, inWater: wet === 'water', lookVec() { return look; }, syncHotbar() {}, heldItem() { return Iv.getItem(this.inventory, this.slot); } };
  M.Behave.hasRain = () => wet === 'rain';
  Iv.setItem(P.inventory, 0, Iv.stack('trident', 1, 5, { Enchantments: [{ id: 'minecraft:riptide', lvl: level }] }));
  const started = Use.tridentStart(P, Iv.getItem(P.inventory, 0));
  const wetOk = wet !== 'dry';
  ok(started === wetOk, `start ${wet} L${level}`);
  let mob = null;
  if (hitMob) { mob = EL.spawn('cow', 0, 64, 0); mob.persistent = true; }
  if (started) { P.useTicks = 10 + salt; Use.bowRelease(P); }
  const st = { v: wetOk ? look.map((c) => c * K.f * ((1 + level) / 4)) : [0, 0, 0], rt: wetOk ? 20 : 0, d: wetOk ? 6 : 5 };
  const R = [], E = [];
  const hpBefore = mob ? mob.health : 0;
  for (let t = 0; t < 22; t++) {
    if (t > 0) { Use.tickRiptide(P); if (st.rt > 0) st.rt--; if (mob && t === 1) { /* hit processed in tick */ } }
    if (mob && t === 1) { st.rt = 0; st.v = st.v.map((c) => c * -0.2); }
    R.push(serverRow(t, { Motion: st.v, Health: mob ? mob.health : 0, HurtTime: st.rt }));
    E.push(engineRow(t, { vx: P.vx, vy: P.vy, vz: P.vz, health: mob ? mob.health : 0, hurtTime: P.riptideTicks | 0 }));
    if (!mob && wetOk && t < 19) ok((P.riptideTicks | 0) === 20 - t, `ticks ${t}`);
  }
  const it = Iv.getItem(P.inventory, 0);
  ok(it && it.i && it.d === st.d, `durability ${wet} L${level}: ${it && it.d} vs ${st.d}`);
  if (mob && wetOk) ok(mob.health < hpBefore, 'mob damaged');
  if (wetOk && ground && !hitMob) ok(Math.abs(P.ey - 65.1999999) < 1e-6 || !ground, 'ground hop');
  return { d: compareTraces(R, E, { fields: ['vel', 'health', 'hurtTime'], tol: { vel: 1e-6, health: 0, hurtTime: 0 } }) };
}
let cases = 0;
for (const level of [1, 2, 3]) for (const wet of ['water', 'rain', 'dry']) for (const hit of [false, true]) {
  if (hit && wet === 'dry') continue;
  const rs = salts.map((s) => lane(s, level, wet, hit)); cases++;
  const bad = rs.filter((x) => x.d);
  ok(!bad.length, `L${level} ${wet}${hit ? ' hit' : ''}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
K.f = 2.9;
brk(!!lane(0, 3, 'water', false).d, 'launch factor 3.0 -> 2.9 caught');
K.f = 3.0;
const sv = Use.touchingWaterOrRain; Use.touchingWaterOrRain = () => true;
const before = fails; lane(0, 3, 'dry', false); const caught = fails > before; fails = before;
brk(caught, 'dry-land gate removed caught'); Use.touchingWaterOrRain = sv;
console.log(`riptidelockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
