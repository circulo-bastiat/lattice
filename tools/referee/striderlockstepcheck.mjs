// striderlockstepcheck.mjs -- #6680 (G17-L109): lockstep scenario 'strider': a saddled strider ridden (warped fungus on a stick) from a 7x7 lava lake onto a netherrack bank; 20 salts.
// Reference = .decomp StriderEntity.tick (cold = !(feet/landing block lava || in lava)), getSpeed/getSaddledSpeed (0.66 / 0.23 / 0.55 multipliers), ItemSteerable.travel boost hump
// (speed + speed*1.15*sin(boostedTime/boostTime*PI), boost time 140+nextInt(841), expired when boostedTime > boostTime), canBeSaddled (alive && !baby), lava slab walk (stands at top of a 0.5 lava source).
// The reference derives cold from the lake GEOMETRY at the engine's observed x (independent of Physics block reads); its RNG is a java.util.Random run beside the engine's.
// Per tick: cold, mobSpeed, boosted, boostedTime; plus y on lava (4.5). Position integration itself is the physics lane's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['07zq_snowgolem.js', '14j_combat.js', '02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07r_mount.js', '07w_passive.js', '07s_raid.js', '07y_equip.js', '07zk_undead.js', '07zzj_strider.js', '07zw_mobnbt.js',
  '14l_use.js', '14_player.js', '07j_entityrender.js', '09c_weather.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init(); M.Breed.init(); M.Mount.init(); M.Passive.init(); M.Equip.init();
if (M.Undead && M.Undead.init) M.Undead.init();
if (M.Raid.init) M.Raid.init();
M.Strider.init();
M.Ai.ROSTER.strider = function () { return { tick: function () {} }; };
if (M.MobNbt.init) M.MobNbt.init();
M.Use.init(M.World);
const EL = M.EntityList, St = M.Strider, W = M.World, R = M.Reg, Iv = M.Inventory, Ph = M.Physics;
{ const realCtx = EL.aiCtx; EL.aiCtx = function (e) { var c = realCtx(e); c.players = function () { return []; }; return c; }; }
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
// lake x 0..6, z 0..6 (lava y 2..4 over stone y 1); netherrack bank x 7..20 (top y 4)
for (let x = -2; x <= 20; x++) for (let z = -2; z <= 9; z++) {
  W.setBlock(x, 1, z, def('stone'));
  if (x >= 0 && x <= 6 && z >= 0 && z <= 6) { W.setBlock(x, 2, z, def('lava')); W.setBlock(x, 3, z, def('lava')); W.setBlock(x, 4, z, def('lava')); }
  else { for (let y = 2; y <= 3; y++) W.setBlock(x, y, z, def('netherrack')); }
}
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i), TICKS = 400, BOOST_AT = 15;
const ATTR = M.Entities.attrsOf('strider').speed;
const P = M.Player;
const inLake = (x, z) => x >= 0 && x < 7 && z >= 0 && z < 7;

function reference(salt, obs) {   // obs[t] = engine's x,z,y at the START of tick t's travel
  const r = new M.JRandom(9000 + salt), tr = [];
  let boosted = false, bt = 0, cur = 0;
  for (let t = 0; t < TICKS; t++) {
    if (t === BOOST_AT) { boosted = true; bt = 0; cur = Math.floor(r.nextDouble() * 841) + 140; }
    const o = obs[t], cold = !inLake(Math.floor(o.x), Math.floor(o.z));
    if (boosted) { const expired = bt > cur; bt++; if (expired) boosted = false; }
    const sp = ATTR * (cold ? 0.23 : 0.55);
    let ms = sp; if (boosted && cur > 0) ms += sp * 1.15 * Math.sin(bt / cur * Math.PI);
    tr.push([cold ? 1 : 0, ms.toFixed(9), boosted ? 1 : 0, bt].join());
  }
  return tr;
}
function engine(salt) {
  const r = new M.JRandom(9000 + salt), tr = [], obs = [];
  P.inventory = Iv.create(); P.hotbar = new Int32Array(9); P.slot = 0; P.instabuild = false; P.vehicle = null;
  Iv.setItem(P.inventory, 0, Iv.stack('warped_fungus_on_a_stick', 1));
  const s = EL.spawn('strider', 1.5, 4.5, 3.5, { noRider: true });
  St.saddle(s); St.mount(s);
  let lavaY = 0;
  for (let t = 0; t < TICKS; t++) {
    obs.push({ x: s.x, y: s.y, z: s.z });
    if (t === BOOST_AT) M.Passive.pigBoost(s, () => r.nextDouble());
    s.riderInput = { yaw: 90, pitch: 0 };
    Ph.updateFluids(s); St.updateCold(s); St.travel(s, Math.random);
    tr.push([St.isCold(s) ? 1 : 0, s.mobSpeed.toFixed(9), s.boosted ? 1 : 0, s.boostedTime || 0].join());
    if (t === 5) lavaY = s.y;
  }
  return { tr, obs, lavaY, endX: s.x };
}
const runs = salts.map((s) => { const b = engine(s); const a = reference(s, b.obs); const i = a.findIndex((v, k) => v !== b.tr[k]); return { a, b, bad: i >= 0 ? 'tick ' + i + ' ' + a[i] + ' vs ' + b.tr[i] : '' }; });
const dirty = () => salts.some((s) => { const b = engine(s); return reference(s, b.obs).some((v, i) => v !== b.tr[i]); });
ok(!runs.some((x) => x.bad), 'divergence: ' + runs.map((x, i) => x.bad && i + ':' + x.bad).filter(Boolean).slice(0, 3));
ok(runs.every((x) => Math.abs(x.b.lavaY - 4.5) < 0.05), 'strider walks on the lava (y 4.5): ' + runs[0].b.lavaY);
ok(runs.every((x) => x.b.endX > 8), 'strider leaves the lake onto the bank (x ' + runs[0].b.endX.toFixed(2) + ')');
ok(runs.every((x) => x.a[0].startsWith('0,') && x.a[TICKS - 1].startsWith('1,')), 'warm on lava, cold on land (not vacuous)');
ok(new Set(runs.map((x) => x.a.join('|'))).size > 3, 'boost lengths vary by seed');
{ const b = EL.spawn('strider', 1.5, 5.2, 3.5, { noRider: true }); b.growAge = -24000; ok(St.canBeSaddled(b) === false, 'baby cannot be saddled'); const a = EL.spawn('strider', 1.5, 5.2, 3.5, { noRider: true }); ok(St.canBeSaddled(a) === true, 'adult can be saddled'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = St.WARM_SADDLED_SPEED; St.WARM_SADDLED_SPEED = 0.7; brk(dirty(), 'saddled warm multiplier 0.55 -> 0.7 caught'); St.WARM_SADDLED_SPEED = o; }
{ const o = St.COLD_SADDLED_SPEED; St.COLD_SADDLED_SPEED = 0.3; brk(dirty(), 'cold multiplier 0.23 -> 0.3 caught'); St.COLD_SADDLED_SPEED = o; }
{ const o = Ph.striderFloat, m = Ph.moveOnLava; Ph.striderFloat = () => {}; Ph.moveOnLava = (e, a, b, c) => Ph.move(e, a, b, c);
  const sunk = salts.slice(0, 3).some((s) => Math.abs(engine(s).lavaY - 4.5) > 0.05); brk(sunk, 'lava-walk disabled caught'); Ph.striderFloat = o; Ph.moveOnLava = m; }
console.log(`striderlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
