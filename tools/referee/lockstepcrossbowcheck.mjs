// lockstep-crossbow -- #6715 (G17-L119): lockstep scenario 'crossbow', 20 salts: load time (25-5q), Multishot fan, Piercing line of cows, firework ammo.
// Reference (independent of src): BowItem.getPullProgress (t=n/20, (t^2+2t)/3, cap 1; <0.1 fires nothing), speed pull*3.0,
// ProjectileEntity.setVelocity (normalize, + nextGaussian*0.0075*1.0 per axis, * speed), isCritical only at pull 1.0,
// Power +0.5*lvl+0.5 on damage 2.0, Punch carried, Flame ignites 100 s, Infinity keeps the ammo, durability 1,
// PersistentProjectileEntity.onEntityHit damage = ceil(clamp(|v| * damage)). Spawn at eye - 0.1 on the release tick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../loadsrc.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };



const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js',
               '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
  blockLightAt: () => 15,
};
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
if (MCL.Entities && MCL.Entities.init) MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Use.init(W);

const Iv = MCL.Inventory, IT = MCL.Items, Use = MCL.Use, EL = MCL.EntityList, Cb = MCL.Combat, ES = MCL.Effects;

ok(Use.ready, 'Use module reports ready');
ok(!!EL.canSpawn('arrow') && !!EL.canSpawn('spectral_arrow'), 'both arrow types are simulatable (D-402 motion table)');

// ── a player stub that is exactly what Use.bowStart/bowRelease/getArrowSlot read ────────────
function player(opts) {
  const inv = Iv.create();
  const o = opts || {};
  return Object.assign({
    inventory: inv,
    slot: 0,
    instabuild: false,
    usingItem: false, useHand: 0, useTicks: 0,
    ex: 0, ey: 64, ez: 0, EYE: 1.62, vx: 0, vy: 0, vz: 0, onGround: true,
    yaw: 0, pitch: 0,
    heldItem() { return Iv.getItem(this.inventory, this.slot); },
    lookVec() { return [0, 0, -1]; },       // fixed, straight -Z — this engine's own convention
    syncHotbar() {},
  }, o);
}
const bow = () => Iv.stack('bow', 1, 0);
const mob = (x, z) => { const e = EL.spawn('turtle', x, 64, z || 0); e.maxHealth = e.health = 1000; return e; };



const jr = (seed) => new MCL.JRandom(BigInt(seed));
function refGauss(r) {
  if (r.spare !== undefined) { const s = r.spare; r.spare = undefined; return s; }
  let v1, v2, s;
  do { v1 = 2 * r.nextDouble() - 1; v2 = 2 * r.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s); r.spare = v2 * m; return v1 * m;
}
const cow = (x, z) => { const e = EL.spawn('cow', x, 64.4, z); e.maxHealth = e.health = 1000; return e; };
const VARIANTS = [
  { name: 'plain', q: 0, ench: [] }, { name: 'qc2', q: 2, ench: [{ id: 'minecraft:quick_charge', lvl: 2 }] },
  { name: 'multishot', q: 0, ms: true, ench: [{ id: 'minecraft:multishot', lvl: 1 }] },
  { name: 'pierce3', q: 0, pi: 3, ench: [{ id: 'minecraft:piercing', lvl: 3 }] },
];
function run() {
  let bad = 0, cases = 0;
  Use.random = jr(6715);
  const bump = (m) => { bad++; if (bad < 25) console.log('  FAIL ' + m); };
  const hasSnd = !!(MCL.Sound && MCL.Sound.play);
  for (let salt = 1; salt <= 20; salt++) for (const v of VARIANTS) for (const fw of [false, true]) {
    cases++;
    const tag = `salt ${salt} ${v.name}${fw ? ' firework' : ''}`;
    EL.list.length = 0;
    const P = player({ ey: 64 + (salt % 3) * 0.1, ex: 0.5, ez: 0.5, creative: false });
    const look = [0, 0, -1]; P.lookVec = () => look;
    const cb = v.ench.length ? Iv.stack('crossbow', 1, 0, { Enchantments: v.ench }) : Iv.stack('crossbow', 1, 0);
    Iv.setItem(P.inventory, P.slot, cb);
    const AS = fw ? Iv.OFFHAND : 5; Iv.setItem(P.inventory, AS, fw ? Iv.stack('firework_rocket', 5) : Iv.stack('arrow', 5));
    const pt = 25 - 5 * v.q;
    // too early: 1 tick short -> nothing loads
    Use.crossbowStart(P, cb); P.useTicks = pt - 1; Use.holdStop(P);
    if (Use.crossbowIsCharged(cb)) bump(tag + ' charged one tick early');
    Use.crossbowStart(P, cb); P.useTicks = pt; Use.holdStop(P);
    if (!Use.crossbowIsCharged(cb)) { bump(tag + ' not charged at ' + pt); continue; }
    const nproj = v.ms ? 3 : 1;
    if (Use.crossbowProjectiles(cb).length !== nproj) bump(tag + ' loaded ' + Use.crossbowProjectiles(cb).length);
    const left = Iv.getItem(P.inventory, AS);
    if ((left ? left.n : 0) !== 4) bump(tag + ' ammo ' + (left && left.n));
    // fire
    const cows = [cow(0.5, -4), cow(0.5, -7), cow(0.5, -10)];
    const n0 = EL.list.length;
    Use.crossbowStart(P, cb);
    if (Use.crossbowIsCharged(cb)) bump(tag + ' still charged after shot');
    const shots = EL.list.slice(n0);
    if (shots.length !== nproj) { bump(tag + ' spawned ' + shots.length); continue; }
    const speed = fw ? 1.6 : 3.15;
    const angs = [0, -10, 10];
    shots.forEach((a, k) => {
      const th = angs[k] * Math.PI / 180;
      const want = [Math.sin(th) * speed, 0, -Math.cos(th) * speed];
      // gaussian jitter 0.0075 per axis (|g| < 5 sigma), speed carried
      ['vx', 'vy', 'vz'].forEach((key, i) => {
        if (Math.abs(Math.abs(a[key]) - Math.abs(want[i])) > 0.0075 * 5 * speed) bump(tag + ` shot ${k} ${key} ${a[key]} want ${want[i]}`);
      });
      if (k === 1 && !(a.vx > 0.1) && !(a.vx < -0.1)) bump(tag + ' no lateral split');
      if (k === 1 && k === 2 && Math.sign(a.vx) === Math.sign(shots[1].vx)) bump(tag + ' same side');
      if (fw) { if (a.type !== 'firework_rocket') bump(tag + ' type ' + a.type); }
      else {
        if (!a.shotFromCrossbow) bump(tag + ' shotFromCrossbow');
        if ((a.pierceLevel | 0) !== (v.pi | 0)) bump(tag + ` pierceLevel ${a.pierceLevel}`);
        const wantPick = k === 0 ? Cb.PICKUP_ALLOWED : Cb.PICKUP_CREATIVE_ONLY;
        if (a.pickupType !== wantPick) bump(tag + ` pickup ${k} ${a.pickupType}`);
      }
    });
    // piercing flight through the line
    if (!fw && !v.ms) {
      const a = shots[0];
      for (let t = 0; t < 30 && !a.removed; t++) Cb.tickArrow(a);
      const hit = cows.filter((c) => c.health < 1000).length;
      const wantHit = v.pi ? 3 : 1;
      if (hit !== wantHit) bump(tag + ` cows hit ${hit} want ${wantHit}`);
      if (v.pi && (a.piercedEntities || []).length !== 3) bump(tag + ' piercedEntities ' + (a.piercedEntities || []).length);
      if (v.pi && a.removed && (a.piercedEntities || []).length < 4) bump(tag + ' removed too early');
    }
  }
  return { bad, cases };
}
const base = run();
console.log(`lockstep-crossbow: ${base.cases} cases (20 salts x 4 variants x 2 ammo), ${base.bad} divergences`);
let nfail = base.bad, nbreaks = 0;
function mut(name, apply, undo) {
  apply(); const q = console.log; console.log = () => {}; const r = run(); console.log = q; undo();
  if (r.bad > 0) { nbreaks++; console.log("   ✓ break caught: " + name); } else { nfail++; console.log('  NOT CAUGHT: ' + name); }
}
const p0 = Use.crossbowPullTime, s0 = Use.CROSSBOW_SPEED;
mut('pull time 25 -> 24', () => { Use.crossbowPullTime = (s) => p0(s) - 1; }, () => { Use.crossbowPullTime = p0; });
mut('speed 3.15', () => { Use.CROSSBOW_SPEED = Math.fround(3.0); }, () => { Use.CROSSBOW_SPEED = s0; });
const sh0 = Use.crossbowShoot;
mut('multishot angle', () => { Use.crossbowShoot = (P, st, pr, pi, cr, sp, dv, an) => sh0(P, st, pr, pi, cr, sp, dv, an * 1.5); }, () => { Use.crossbowShoot = sh0; });
mut('pierce level', () => { Use.crossbowShoot = (P, st, pr, pi, cr, sp, dv, an) => { const a = sh0(P, st, pr, pi, cr, sp, dv, an); if (a && a.pierceLevel) a.pierceLevel -= 1; return a; }; }, () => { Use.crossbowShoot = sh0; });
console.log(`lockstep-crossbow: ${base.cases} assertions, ${nfail} failures, ${nbreaks} breaks caught`);
process.exit(nfail ? 1 : 0);
