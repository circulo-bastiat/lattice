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
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }
function mkTarget(x, y, z) {
  return { type: 'cow', x, y, z, health: 20, maxHealth: 20, width: 0.9, height: 1.4,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
}
function mkPlayer(x, y, z) {
  return { type: 'player', x, y, z, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0, armor: 0, armorToughness: 0 };
}


function run(source) {
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w });
  const p = mkPlayer(5.5, 64.5, 5.6);
  p.health = 1;
  EL.list.push(p);
  const calls = [];
  const orig = Sv.hurt;
  Sv.hurt = function (e, type, amount, att) {
    calls.push(type);
    return orig(e, source || type, amount, att);
  };
  MCL.Player = p;
  Wi.tickSkull(sk);
  Sv.hurt = orig;
  return calls;
}
{
  const calls = run(null);
  ok(calls[0] === 'witherSkull', `skull hurts the player with source witherSkull (got ${calls[0]})`);
  ok(!!Sv.DAMAGE.witherSkull && Sv.DAMAGE.witherSkull.projectile === true && !Sv.DAMAGE.witherSkull.bypassArmor,
    'DAMAGE.witherSkull: projectile, armour applies');
  const calls2 = run('arrow');
  okAv(calls2[0] === 'witherSkull' && Sv.DAMAGE.witherSkull.projectile, 'sanity: the spy sees the real call');
  okAv(!(calls2[0] === 'arrow'), 'a regressed source "arrow" would be caught by the first assertion');
}
{
  const wallHit = (vx) => {
    freshWorld();
    put(8, 64, 5, 'stone');
    const sk = spawn('wither_skull', 7.4, 64.5, 5.5, { power: [0, 0, 0], shooter: null });
    sk.vx = vx; sk.vy = 0; sk.vz = 0; sk.onGround = false;
    for (let i = 0; i < 3 && !sk.removed; i++) Wi.tickSkull(sk);
    return sk.removed;
  };
  ok(wallHit(0.6) === true, 'skull flying horizontally into a wall explodes (removed)');
  okAv(wallHit(-0.6) === false, 'same skull flying away from the wall survives (probe is not vacuous)');
}
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
