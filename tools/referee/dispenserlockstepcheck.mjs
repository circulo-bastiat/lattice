// dispenserlockstepcheck.mjs -- #6610 (G17-L84): lockstep scenario 'dispenser': a dispenser, facing varied over salts, loaded with each projectile item.
// Reference = .decomp DispenserBlock.getOutputLocation (centre + 0.7*facing), ProjectileDispenserBehavior.dispenseSilently -> ProjectileEntity.setVelocity(dx, dy+0.1F, dz, force 1.1F, variation 6.0F):
// normalize, + nextGaussian()*0.0075F*variation per axis, * force; splash potion force*1.25F, variation*0.5F; fire charge (DispenserBehavior:318-324) pos + 0.3F*facing, accel = nextGaussian()*0.05 + facing;
// BoatDispenserBehavior pos = centre + facing*1.125F (+1.0 over water in front); DispenserBlockEntity.chooseNonEmptySlot = reservoir nextInt(n++)==0.
// The random is a real java.util.Random (48-bit LCG + polar nextGaussian) written here, independent of the engine's U.polarGaussian.
// KNOWN DIVERGENCE (named, not hidden): the engine's slot draw is `rnd()*n < 1` (one nextDouble = 2 LCG steps), vanilla's is nextInt(n) (1 step), so the slot lane
// compares the DISTRIBUTION (every non-empty slot chosen, uniformly, over 20 seeds); the velocity lanes use a one-stack dispenser and feed the engine's slot draw from a side stream.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '07f_redstone.js', '07h_entities.js',
  '07i_entitylist.js', '07z_potion.js', '07zzd_throw.js', '07zzt_boat.js', '07zzh_blaze.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const S = M.States, B = M.Behave, BE = M.BlockEntities, Inv = M.Inventory, EL = M.EntityList;
const cells = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(key(x, y, z), s); return true; }, getLight: () => 15 << 4, blockLightAt: () => 15, clear() {} };
M.World = w; B.init(w); BE.init(); if (M.Redstone) M.Redstone.init(); M.Entities.init(); EL.init();
M.Physics.shapeAt = () => null;

// ---- java.util.Random ----
class JRandom {
  constructor(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); this.haveG = false; }
  next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); let v = Number(this.s >> BigInt(48 - bits)); if (v >= 2 ** (bits - 1) && bits === 32) v -= 2 ** 32; return v; }
  nextInt(bound) {
    let r = this.next(31); const m = bound - 1;
    if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n);
    for (let u = r; u - (r = u % bound) + m >= 2 ** 31; u = this.next(31));
    return r;
  }
  nextDouble() { return (this.next(26) * 134217728 + this.next(27)) * 2 ** -53; }
  nextGaussian() {
    if (this.haveG) { this.haveG = false; return this.nextG; }
    let v1, v2, s;
    do { v1 = 2 * this.nextDouble() - 1; v2 = 2 * this.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s); this.nextG = v2 * m; this.haveG = true; return v1 * m;
  }
}
const f = Math.fround;
const FACES = [['down', 0, -1, 0], ['up', 0, 1, 0], ['north', 0, 0, -1], ['south', 0, 0, 1], ['west', -1, 0, 0], ['east', 1, 0, 0]];
const ITEMS = [  // item, entity type, kind
  ['arrow', 'arrow', 'proj', 1.1, 6], ['snowball', 'snowball', 'proj', 1.1, 6], ['egg', 'egg', 'proj', 1.1, 6],
  ['splash_potion', 'potion', 'proj', f(f(1.1) * 1.25), f(6 * 0.5)], ['fire_charge', 'small_fireball', 'fire'], ['oak_boat', 'boat', 'boat']];
const O = { x: 10, y: 5, z: 10 };

// vanilla reference for one shot: { pos, vel } (vel = projectile velocity, or fireball accel)
function reference(item, face, J) {
  const [, dx, dy, dz] = FACES[face], c = [O.x + 0.5, O.y + 0.5, O.z + 0.5];
  if (item[2] === 'boat') return { pos: [c[0] + f(dx * f(1.125)), c[1] + f(dy * f(1.125)) + 1.0, c[2] + f(dz * f(1.125))] };
  if (item[2] === 'fire') {
    const g = [J.nextGaussian() * 0.05 + dx, J.nextGaussian() * 0.05 + dy, J.nextGaussian() * 0.05 + dz];
    return { pos: [c[0] + 0.7 * dx + f(dx * f(0.3)), c[1] + 0.7 * dy + f(dy * f(0.3)), c[2] + 0.7 * dz + f(dz * f(0.3))], vel: g.map((a) => a / Math.hypot(...g) * 0.1) };   // ExplosiveProjectileEntity ctor: accel / |accel| * 0.1
  }
  const y = f(dy + f(0.1)), len = Math.hypot(dx, y, dz), k = f(0.0075) * item[4];
  const v = [dx / len + J.nextGaussian() * k, y / len + J.nextGaussian() * k, dz / len + J.nextGaussian() * k].map((a) => a * item[3]);
  return { pos: [c[0] + 0.7 * dx, c[1] + 0.7 * dy, c[2] + 0.7 * dz], vel: v };
}
function engineShot(item, face, seed, slotsFilled) {
  EL.init(); cells.clear();
  const [fname, dx, dy, dz] = FACES[face];
  cells.set(key(O.x, O.y, O.z), B.setProp(S.stateOf('dispenser'), 'facing', fname));
  if (item[2] === 'boat') cells.set(key(O.x + dx, O.y + dy, O.z + dz), S.stateOf('water'));
  const e = BE.get(O.x, O.y, O.z) || BE.create(O.x, O.y, O.z, 'dispenser');
  for (let i = 0; i < 9; i++) e.items[i] = null;
  e.items[slotsFilled[0]] = Inv.stack(item[0], 4);
  const J = new JRandom(seed), side = new JRandom(seed + 999);
  let calls = 0; const rnd = () => (calls++ < slotsFilled.length ? side.nextDouble() : J.nextDouble());   // slot draws on the side stream (see header)
  BE.dispenseFrom(e, rnd);
  const ent = EL.list.find((q) => q.type === item[1] && !q.removed);
  return { ent, left: e.items[slotsFilled[0]] ? e.items[slotsFilled[0]].n : 0 };
}
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
let fails = 0, breaks = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
function lane(item, face, seed) {
  const R = reference(item, face, new JRandom(seed)), { ent, left } = engineShot(item, face, seed, [seed % 9]);
  if (!ent) return 'no ' + item[1] + ' spawned';
  if (left !== 3) return 'stack not decremented: ' + left;
  for (let i = 0; i < 3; i++) if (!near(R.pos[i], [ent.x, ent.y, ent.z][i], 1e-5)) return `pos[${i}] ${R.pos[i]} vs ${[ent.x, ent.y, ent.z][i]}`;
  if (R.vel) {
    const v = item[2] === 'fire' ? [ent.powerX, ent.powerY, ent.powerZ] : [ent.vx, ent.vy, ent.vz];
        for (let i = 0; i < 3; i++) if (!near(R.vel[i], v[i], item[2] === 'fire' ? 1e-6 : 1e-5)) return `vel[${i}] ${R.vel[i]} vs ${v[i]}`;
  }
  return null;
}
const salts = Array.from({ length: 20 }, (_, i) => i + 1);
function allLanes() {
  const bad = [];
  for (const it of ITEMS) for (const s of salts) { const face = it[2] === 'boat' ? 2 + (s % 4) : s % 6; const d = lane(it, face, s); if (d) bad.push(`${it[0]} salt ${s} face ${face}: ${d}`); }
  return bad;
}
const bad = allLanes();
ok(!bad.length, 'projectile lanes: ' + bad.slice(0, 3).join(' | '));
for (const it of ITEMS) ok(salts.every((s) => !lane(it, it[2] === 'boat' ? 2 + (s % 4) : s % 6, s)), it[0] + ' matches the reference over 20 seeds');
// slot choice: vanilla chooseNonEmptySlot vs engine, 4 non-empty of 9, 20 seeds x 200 shots: both reach every non-empty slot, roughly uniform
function slotHist(pick) { const h = {}; for (const s of salts) { const J = new JRandom(s); for (let t = 0; t < 200; t++) { const p = pick(J); h[p] = (h[p] || 0) + 1; } } return h; }
const FILL = [0, 3, 4, 8];
const vanillaPick = (J) => { let r = -1, n = 1; for (const i of FILL) if (J.nextInt(n++) === 0) r = i; return r; };
const enginePick = (J) => { const e = { items: Array(9).fill(null) }; for (const i of FILL) e.items[i] = Inv.stack('arrow', 1); return BE.dispenserRandomSlot(e, () => J.nextDouble()); };
const hv = slotHist(vanillaPick), he = slotHist(enginePick), N = salts.length * 200;
ok(FILL.every((i) => he[i] > 0) && Object.keys(he).length === 4, 'engine reaches exactly the non-empty slots: ' + JSON.stringify(he));
ok(FILL.every((i) => Math.abs(he[i] / N - 0.25) < 0.03 && Math.abs(hv[i] / N - 0.25) < 0.03), 'slot choice uniform (0.25 each): engine ' + JSON.stringify(he) + ' vanilla ' + JSON.stringify(hv));
ok(BE.dispenserRandomSlot({ items: Array(9).fill(null) }, Math.random) === -1, 'empty dispenser picks -1');
// the engine must really use the supplied rng for the slot (not Math.random)
const e1 = { items: Array(9).fill(null).map((_, i) => (FILL.includes(i) ? Inv.stack('arrow', 1) : null)) };
const rr = Math.random; Math.random = () => { throw new Error('Math.random used'); };
let used = false; try { BE.dispenserRandomSlot(e1, () => { used = true; return 0.9; }); } catch (_) { /* reported below */ }
Math.random = rr; ok(used, 'slot choice draws from the supplied rng');

const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const tv = M.Potion.throwVelocity;   // the force/variation are captured when the behaviours are built, so inject the fault where they are consumed
M.Potion.throwVelocity = (dx, dy, dz, power, unc, r) => tv(dx, dy, dz, Math.abs(power - 1.1) < 1e-9 ? 1.0 : power, unc, r);
brk(allLanes().length > 0, 'projectile power 1.1 -> 1.0'); M.Potion.throwVelocity = tv;
const origSlot = BE.dispenserRandomSlot;
BE.dispenserRandomSlot = function (e, rnd) { return origSlot(e, Math.random); };
let used2 = false; try { BE.dispenserRandomSlot(e1, () => { used2 = true; return 0.9; }); } catch (_) { /* n/a */ }
brk(!used2, 'slot rng replaced by Math.random'); BE.dispenserRandomSlot = origSlot;
M.Potion.throwVelocity = (dx, dy, dz, power, unc, r) => tv(dx, dy, dz, power, unc === 6 ? 3 : unc, r);
brk(allLanes().length > 0, 'uncertainty 6.0 -> 3.0'); M.Potion.throwVelocity = tv;
console.log(`dispenserlockstepcheck: ${asserts + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
