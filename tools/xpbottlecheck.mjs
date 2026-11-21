import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');


console.log('xpbottlecheck — #5080: experience_bottle throwable');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js', '14d_survival.js',
               '07q_effects.js', '07m_breed.js', '07z_potion.js', '14j_combat.js', '14l_use.js',
               '07zzd_throw.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js',
               // struck s117 -- sound (S.entitySound) and the egg/pearl particle bursts
               // (Px.spawnEggBurst/Px.spawnPearlBurst) both need their own module loaded to
               // exercise anything beyond the `if (NS.Sound && ...)`/`if (NS.Particle && ...)`
               // no-op guards `Th.use`/`Th.tickEgg`/`Th.tickPearl` already fall back to.
               '02j_sounds.js', '07zx_particle.js', '07zz_xporb.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = { getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
            setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
            blockLightAt: () => 15 };
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Breed.init();
MCL.Use.init(W);
MCL.Commands = { rules: {}, ruleGet(name) { return (name in this.rules) ? this.rules[name] : 'true'; } };


MCL.Xp.init();
const Iv = MCL.Inventory, EL = MCL.EntityList, Th = MCL.Throw, Xp = MCL.Xp;
const stk = (n) => Iv.stack('experience_bottle', n, 0);
function player(o) {
  return Object.assign({ inventory: Iv.create(), slot: 0, instabuild: false, ex: 0, ey: 64, ez: 0, EYE: 1.62,
    vx: 0, vy: 0, vz: 0, onGround: true, yaw: 0, pitch: 0, lookVec() { return [0, 0, -1]; }, syncHotbar() {} }, o || {});
}
const realGrav = () => EL.motionFor('experience_bottle');
const orbTotal = () => EL.list.filter((o) => o.type === 'experience_orb').reduce((a, o) => a + o.value * (o.pickingCount || 1), 0);

// returns {xp, left, gravity, drag, thrown}; rolls = the two nextInt draws as [0..1) values
function run(opts) {
  opts = opts || {};
  EL.clear();
  const P = player({ instabuild: !!opts.creative });
  Iv.setItem(P.inventory, 0, stk(3));
  const ok1 = Th.use(P, Iv.getItem(P.inventory, 0));
  const e = EL.list.find((o) => o.type === 'experience_bottle');
  const r = { thrown: ok1 && !!e, left: (Iv.getItem(P.inventory, 0) || { n: 0 }).n };
  if (!e) return r;
  r.gravity = e.gravity; r.drag = e.drag;
  const q = opts.rolls.slice(); EL.random = () => (q.length ? q.shift() : 0.5);
  e.x = 0; e.y = 10; e.z = 0; e.vx = e.vy = e.vz = 0; e.onGround = true;
  Th.tickBottle(e);
  EL.random = undefined;
  r.removed = !!e.removed; r.xp = orbTotal();
  return r;
}
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const g = realGrav();
ok(g && g[0] === 0.07 && g[1] === 0.99, 'motionFor experience_bottle = [0.07, 0.99] (got ' + JSON.stringify(g) + ')');
ok(!('experience_bottle' in EL.OWED_STAGE) && EL.canSpawn('experience_bottle'), 'no longer owed; spawns');
let r = run({ rolls: [0, 0] });
ok(r.thrown && Math.fround(r.gravity) === Math.fround(0.07) && r.drag === 0.99, `entity gravity 0.07 / drag 0.99 (${r.gravity}/${r.drag})`);
ok(r.left === 2, 'stack 3 -> 2'); ok(r.removed && r.xp === 3, 'rolls 0,0 -> 3 XP, bottle discarded');
r = run({ rolls: [0.99, 0.99] }); ok(r.xp === 11, 'rolls max -> 11 XP (' + r.xp + ')');
r = run({ rolls: [0.99, 0] }); ok(r.xp === 7, 'rolls 4,0 -> 7 XP (' + r.xp + ')');
r = run({ rolls: [0, 0.99] }); ok(r.xp === 7, 'rolls 0,4 -> 7 XP (' + r.xp + ')');
r = run({ creative: true, rolls: [0.5, 0.5] }); ok(r.left === 3, 'creative: stack unchanged');
{ // the spawned entity's per-tick gravity (EL.tickOne does `e.vy -= e.gravity`) is 0.07, not 0.03/0.05
  EL.clear(); const e = EL.spawn('experience_bottle', 0, 40, 0, { vx: 0, vy: 0, vz: 0 });
  ok(Math.fround(e.gravity) === Math.fround(0.07) && e.gravity !== 0.03 && e.gravity !== 0.05, 'spawned gravity ' + e.gravity);
}
// range sweep: every roll pair lands in [3,11]
{ let lo = 99, hi = 0; for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) { const x = run({ rolls: [(a + .1) / 5, (b + .1) / 5] }).xp; lo = Math.min(lo, x); hi = Math.max(hi, x); }
  ok(lo === 3 && hi === 11, `sweep range [${lo},${hi}] = [3,11]`); }

// anti-vacuity
{ const saved = EL.motionFor;
  EL.motionFor = (t) => (t === 'experience_bottle' ? [0.03, 0.99] : saved(t));
  const b = run({ rolls: [0, 0] });
  okAv(Math.fround(b.gravity) !== Math.fround(0.07), 'gravity 0.03 is caught by the 0.07 assertion');
  EL.motionFor = saved; }
{ const saved = Th.tickBottle;
  Th.tickBottle = function (e) { const rr = EL.random; let n = 0; EL.random = () => (n++ === 1 ? 0 : rr()); const q = saved(e); EL.random = rr; return q; };
  const b = run({ rolls: [0.99, 0.99] });
  okAv(b.xp !== 11, 'skipping the second nextInt is caught (xp ' + b.xp + ')');
  Th.tickBottle = saved; }
okAv(run({ rolls: [0.5, 0.5] }).xp === 3 + 2 + 2, 'baseline restored after the breaks');

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity)`);
fails.forEach((f) => console.log('FAIL ' + f));
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
