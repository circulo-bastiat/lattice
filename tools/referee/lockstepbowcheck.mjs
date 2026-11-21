// lockstep-bow -- #6714 (G17-L118): lockstep scenario 'bow', 20 salts: a scripted player draws 5/10/20/30 ticks and releases.
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
function refGauss(r) {   // independent Marsaglia polar with cached spare (java.util.Random.nextGaussian)
  if (r.spare !== undefined) { const s = r.spare; r.spare = undefined; return s; }
  let v1, v2, s;
  do { v1 = 2 * r.nextDouble() - 1; v2 = 2 * r.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s); r.spare = v2 * m; return v1 * m;
}
const refPull = (n) => { const t = n / 20; return Math.min((t * t + t * 2) / 3, 1); };
const VARIANTS = [
  { name: 'plain', ench: [] }, { name: 'power3', ench: [{ id: 'minecraft:power', lvl: 3 }] },
  { name: 'punch2', ench: [{ id: 'minecraft:punch', lvl: 2 }] }, { name: 'flame', ench: [{ id: 'minecraft:flame', lvl: 1 }] },
  { name: 'infinity', ench: [{ id: 'minecraft:infinity', lvl: 1 }] },
];
function run() {
  let bad = 0, cases = 0;
  // one persistent player Random per run (vanilla Entity.random carries its cached gaussian spare across shots; 1200 draws = even, so none is left over)
  Use.random = jr(6714); const ref = jr(6714);
  const bump = (m) => { bad++; if (bad < 25) console.log('  FAIL ' + m); };
  for (let salt = 1; salt <= 20; salt++) for (const n of [5, 10, 20, 30]) for (const v of VARIANTS) {
    cases++;
    const tag = `salt ${salt} n=${n} ${v.name}`;
    MCL.EntityList.list.length = 0;
    const P = player({ ey: 64 + salt * 0.37, ex: salt * 0.5, ez: -salt * 0.25, yaw: 0 });
    const look = (() => { const a = salt * 0.11, c = Math.cos(a * 0.3); return [Math.sin(a) * c, -Math.sin(a * 0.3), -Math.cos(a) * c]; })();
    P.lookVec = () => look;
    const b = v.ench.length ? Iv.stack('bow', 1, 0, { Enchantments: v.ench }) : bow();
    Iv.setItem(P.inventory, P.slot, b); Iv.setItem(P.inventory, 5, Iv.stack('arrow', 7));
    Use.bowStart(P, b); P.useTicks = n;
    const fired = Use.bowRelease(P);
    const pull = refPull(n);
    if (fired !== (pull >= 0.1)) { bump(tag + ` fired ${fired} want ${pull >= 0.1}`); continue; }
    const a = EL.list[EL.list.length - 1];
    if (!a || a.type !== 'arrow') { bump(tag + ' no arrow'); continue; }
    const sp = pull * 3.0, g = [refGauss(ref) * 0.0075, refGauss(ref) * 0.0075, refGauss(ref) * 0.0075];
    const want = [(look[0] + g[0]) * sp, (look[1] + g[1]) * sp, (look[2] + g[2]) * sp];
    ['vx', 'vy', 'vz'].forEach((k, i) => { if (Math.abs(a[k] - want[i]) > 1e-6) bump(tag + ` ${k} ${a[k]} want ${want[i]}`); });
    if (Math.abs(a.x - P.ex) > 1e-9 || Math.abs(a.y - (P.ey + 1.62 - 0.1)) > 1e-6 || Math.abs(a.z - P.ez) > 1e-9) bump(tag + ` spawn pos ${a.x},${a.y},${a.z}`);
    if (!!a.critical !== (pull === 1)) bump(tag + ` critical ${a.critical}`);
    const lv = (id) => (v.ench.find((e) => e.id === 'minecraft:' + id) || { lvl: 0 }).lvl;
    const dmg = 2 + (lv('power') > 0 ? lv('power') * 0.5 + 0.5 : 0);
    if (a.arrowDamage !== dmg) bump(tag + ` arrowDamage ${a.arrowDamage} want ${dmg}`);
    if ((a.punch | 0) !== lv('punch')) bump(tag + ` punch ${a.punch}`);
    if (!!a.isOnFire !== (lv('flame') > 0)) bump(tag + ` flame ${a.isOnFire}`);
    const hit = Math.ceil(Math.fround(Math.sqrt(want[0] ** 2 + want[1] ** 2 + want[2] ** 2)) * dmg);
    if (Cb.arrowHitDamage(a) !== hit) bump(tag + ` hit damage ${Cb.arrowHitDamage(a)} want ${hit}`);
    if (MCL.Sound && MCL.Sound.play) ref.nextDouble();   // BowItem.onStoppedUsing's shoot-sound pitch draw follows the three gaussians
    const left = Iv.getItem(P.inventory, 5);
    if ((left ? left.n : 0) !== (lv('infinity') ? 7 : 6)) bump(tag + ` ammo ${left && left.n}`);
    const bs = Iv.getItem(P.inventory, P.slot);
    if (!bs || (bs.d | 0) !== 1) bump(tag + ` durability ${bs && bs.d}`);
  }
  return { bad, cases };
}
const base = run();
console.log(`lockstep-bow: ${base.cases} cases (20 salts x 4 draws x 5 variants), ${base.bad} divergences`);
let nfail = base.bad, nbreaks = 0;
const origQuiet = console.log;
function mut(name, apply, undo) {
  apply(); const q = console.log; console.log = () => {}; const r = run(); console.log = q; undo();
  if (r.bad > 0) { nbreaks++; console.log("   ✓ break caught: " + name); } else { nfail++; console.log('  NOT CAUGHT: ' + name); }
}
const s0 = Cb.ARROW_GAUSS_SCALE, b0 = Use.BOW_SPEED, p0 = Use.bowPullProgress;
mut('jitter 0.0075', () => { Cb.ARROW_GAUSS_SCALE = 0.0076; }, () => { Cb.ARROW_GAUSS_SCALE = s0; });
mut('speed 3.0', () => { Use.BOW_SPEED = 2.9; }, () => { Use.BOW_SPEED = b0; });
mut('pull curve', () => { Use.bowPullProgress = (t) => Math.min(t / 20, 1); }, () => { Use.bowPullProgress = p0; });
const c0 = Cb.ARROW_BASE_DAMAGE;
mut('base damage', () => { Cb.ARROW_BASE_DAMAGE = 3; }, () => { Cb.ARROW_BASE_DAMAGE = c0; });
console.log(`lockstep-bow: ${base.cases} assertions, ${nfail} failures, ${nbreaks} breaks caught`);
process.exit(nfail ? 1 : 0);
