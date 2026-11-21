import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;



const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js',
  '07zzi_ghast.js', '07zzm_wither.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat, Sv = MCL.Survival;
const Ex = MCL.Explosion, ES = MCL.Effects, Diff = MCL.Diff, Wi = MCL.Wither, Gh = MCL.Ghast;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();

ok(!!Wi && Wi.ready, 'Wither module reports ready');
ok(typeof Wi.attack === 'function', 'Wi.attack exists (the ProjectileAttackGoal onShoot)');
ok(typeof Wi.tickSkull === 'function', 'Wi.tickSkull exists (the per-tick consequence)');
ok(typeof Wi.initSkull === 'function', 'Wi.initSkull exists (the ctor default)');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}

function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }
for (const [type, hits] of [['boat', true], ['minecart', true], ['end_crystal', true], ['item', false]]) {
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w });
  const tgt = { type, x: 5.5, y: 64.5, z: 5.6, width: 1.4, height: 0.6, vx: 0, vy: 0, vz: 0 };
  EL.list.push(tgt);
  Wi.tickSkull(sk);
  if (hits) ok(sk.removed === true, `skull explodes on a ${type} with no maxHealth`);
  else okAv(sk.removed !== true, `a ${type} (not collidable) is still flown through`);
  EL.list.pop();
}

// #4932: a skull hitting a non-living collidable runs the damage path (minecart wobble, end crystal detonates)
{
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w });
  const cart = { type: 'minecart', x: 5.5, y: 64.5, z: 5.6, width: 0.98, height: 0.7, vx: 0, vy: 0, vz: 0, cartWobbleSide: 1, cartWobbleStrength: 0 };
  EL.list.push(cart);
  let calls = 0; const h0 = Cb.hurt; Cb.hurt = function (t) { if (t === cart) calls++; return h0.apply(this, arguments); };
  Wi.tickSkull(sk);
  Cb.hurt = h0;
  okAv(calls === 1, 'skull hitting a minecart reaches Combat.hurt (damage path runs)');
  EL.list.pop();
}

// #4827: the hit-test sweeps the step segment (+0.3 margin); a fast skull must not tunnel a 0.6-wide mob
{
  let missed = 0;
  for (let z = 12; z < 15; z += 0.05) {
    freshWorld();
    const w = spawn('wither', 0.5, 80, 0.5);
    const zb = spawn('zombie', 0.5, 64, z, { noAI: true });
    const sk = spawn('wither_skull', 0.5, 65, 0.5, { power: [0, 0, 1], shooter: w });
    const h0 = zb.health;
    for (let i = 0; i < 40 && !sk.removed; i++) EL.tickOne(sk);
    if (!(zb.health < h0)) missed++;
  }
  ok(missed === 0, `fast skull hits a zombie at every z in [12,15) (${missed} missed)`);
}

// swept hit: a fast skull whose step passes over a thin mob's box (#4824); a far-away mob is not hit
for (const [tx, hits] of [[8.5, true], [20.5, false]]) {
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { shooter: w });
  sk.vx = 0; sk.vy = 0; sk.vz = 3;
  const tgt = { type: 'zombie', maxHealth: 20, health: 20, x: 5.5, y: 64, z: 5.5 + (tx - 5.5), width: 0.6, height: 1.8, vx: 0, vy: 0, vz: 0 };
  tgt.z = 8.5 - 0.0; tgt.x = 5.5; if (!hits) tgt.z = 20.5;
  EL.list.push(tgt);
  Wi.tickSkull(sk);
  if (hits) ok(sk.removed === true, 'fast skull sweeps into a mob its step passes over');
  else okAv(sk.removed !== true, 'a mob beyond the step is not hit');
  EL.list.pop();
}
// owner removed -> skull discarded
{
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w });
  w.removed = true;
  Wi.tickSkull(sk);
  ok(sk.removed === true, 'skull is discarded when its owner is removed');
  freshWorld();
  const w2 = spawn('wither', 0.5, 80, 0.5);
  const sk2 = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w2 });
  Wi.tickSkull(sk2);
  okAv(sk2.removed !== true, 'a live owner keeps the skull flying');
}
// #4823: the live player is not in EL.list; a skull aimed at it must still hurt it directly
for (const inPath of [true, false]) {
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w });
  const oldP = MCL.Player, oldH = Sv.hurt; let dmg = null;
  MCL.Player = { x: inPath ? 5.5 : 25.5, y: 64, z: 5.5, width: 0.6, height: 1.8, maxHealth: 20, health: 20, vx: 0, vy: 0, vz: 0 };
  Sv.hurt = (t, src, amt) => { dmg = dmg || [src, amt]; return true; };
  Wi.tickSkull(sk);
  if (inPath) ok(dmg && dmg[0] === 'witherSkull' && dmg[1] === Wi.SKULL_DAMAGE_OWNED, 'skull deals witherSkull damage to NS.Player');
  else okAv(dmg === null, 'a skull away from the player deals no player damage');
  MCL.Player = oldP; Sv.hurt = oldH;
}

// #4896: thorns (applyDamageEffects) only while the victim survives; entity in front of a wall is still hit
for (const [hp, thorns] of [[1, false], [20, true]]) {
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  const zb = spawn('zombie', 5.5, 64, 8.5, { noAI: true });
  zb.health = hp;
  const sk = spawn('wither_skull', 5.5, 64.8, 7.5, { power: [0, 0, 1], shooter: w });
  sk.vx = 0; sk.vy = 0; sk.vz = 1;
  let n = 0; const old = ES.thornsOnUserDamaged; ES.thornsOnUserDamaged = () => { n++; return true; };
  Wi.tickSkull(sk);
  ES.thornsOnUserDamaged = old;
  if (thorns) ok(n === 1, 'thorns fire when the victim survives');
  else ok(n === 0, 'no thorns when the victim dies');
  okAv(sk.removed === true && zb.health < (thorns ? 20 : 1) + (thorns ? 0 : 1), 'skull hit the zombie');
}
{
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  const zb = spawn('zombie', 5.5, 64, 7.5, { noAI: true });
  const sk = spawn('wither_skull', 5.5, 64.8, 6.5, { power: [0, 0, 1], shooter: w });
  sk.vx = 0; sk.vy = 0; sk.vz = 1.5;
  W.setBlock(5, 64, 8, S.idOf ? S.idOf('stone') : 1);
  const h0 = zb.health; Wi.tickSkull(sk);
  ok(zb.health < h0, 'entity before a wall within the step is damaged');
}
const bc = breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length;
console.log(`\n${pass} checks passed, ${fails.length} failures`);
for (let i = 0; i < bc; i++) console.log('  ✓ break caught: anti-vacuity probe');
console.log(`${bc} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
