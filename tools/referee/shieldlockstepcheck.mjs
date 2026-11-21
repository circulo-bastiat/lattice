// shieldlockstepcheck.mjs -- #6609 (G17-L83): lockstep scenario 'shield', 20 salts: raise delay, 90-degree arc, durability, axe disable, knockback.
// Reference = .decomp LivingEntity.isBlocking (:3001, maxUse - timeLeft >= 5), blockedByShield (:1233, bypassesArmor / piercing arrow excluded, normalize(self - source)
// with y zeroed . look < 0), PlayerEntity.damageShield (:884, amount >= 3 -> 1 + floor(amount) durability), disableShield (:1259, 0.25 + 0.75 axe vs nextFloat, 100-tick cooldown).
// Per salt a sneaking player raises a shield at tick 0 and is hit every tick 0..9 from a salted angle by a zombie (3), an arrow (6), an explosion with no position
// and a piercing arrow; the reference steps blocked/damage/durability independently from the same inputs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14j_combat.js', '14l_use.js'], dom: false, initReg: true });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const Use = M.Use, Iv = M.Inventory, IT = M.Items;
const SHIELD = IT.byName ? IT.byName('shield') : null;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
function shieldId() { for (let i = 0; i < 4000; i++) if (IT.nameOf(i) === 'shield') return i; throw new Error('no shield'); }
function mkPlayer(yaw) {
  const P = { x: 0, y: 0, z: 0, yaw, slot: 0, inventory: null, usingItem: false, shieldCooldown: 0, sneaking: true };
  P.inventory = Iv.create ? Iv.create() : Iv.make();
  Iv.setItem(P.inventory, 0, { i: shieldId(), n: 1, d: 0 });
  return P;
}
const SRCS = [{ n: 'zombie', amt: 3, src: {}, melee: true }, { n: 'arrow', amt: 6, src: { projectile: true } }, { n: 'pierce', amt: 6, src: {}, nopos: true },
  { n: 'explosion', amt: 10, src: { bypassArmor: true } }];
function ref(P, t, dot, s) { // vanilla verdict for this hit
  const blocking = t >= 5 && !s.nopos && !(s.src && s.src.bypassArmor);
  return blocking && dot < 0;
}
function lane(salt) {
  const r = stream(salt), yaw = r() * Math.PI * 2, P = mkPlayer(yaw), log = [];
  let dur = 0;
  Use.shieldStart(P, Iv.getItem(P.inventory, 0));
  for (let t = 0; t < 10; t++) {
    const s = SRCS[t % SRCS.length], ang = r() * Math.PI * 2, A = { x: Math.sin(ang) * 3, z: -Math.cos(ang) * 3, type: 'zombie' };
    const fx = Math.sin(yaw), fz = -Math.cos(yaw), dot = -(A.x * fx + A.z * fz) / 3;
    const want = ref(P, t, dot, s);
    const got = s.nopos ? false : Use.blockedByShield(P, s.src, A);
    log.push([t, want, got]);
    if (want !== got) return { bad: `tick ${t} ${s.n}: want ${want} got ${got}`, log };
    if (want) { const before = Iv.getItem(P.inventory, 0).d | 0; Use.damageShield(P, s.amt); dur = s.amt >= 3 ? 1 + Math.floor(s.amt) : 0;
      if (((Iv.getItem(P.inventory, 0) || { d: before + dur }).d | 0) !== before + dur) return { bad: `tick ${t} durability`, log }; }
    P.useTicks = t + 1 > 5 ? t + 1 : t + 1;
  }
  // axe hit: disable chance 1.0 (0.25 + 0.75) -> 100-tick cooldown, cannot re-raise
  Use.shieldStart(P, Iv.getItem(P.inventory, 0));
  P.usingItem = true; P.useKind = 'shield'; P.useTicks = 9;
  Use.disableShield(P, true, () => 0.999);
  if (P.shieldCooldown !== 100 || Use.isBlocking(P)) return { bad: 'axe disable: cooldown ' + P.shieldCooldown, log };
  for (let i = 0; i < 99; i++) Use.tickShieldCooldown(P);
  if (Use.shieldStart(P, Iv.getItem(P.inventory, 0))) return { bad: 'raise allowed at cooldown 1', log };
  Use.tickShieldCooldown(P);
  if (!Use.shieldStart(P, Iv.getItem(P.inventory, 0))) return { bad: 'raise refused at cooldown 0', log };
  return { log };
}
const res = Array.from({ length: 20 }, (_, i) => lane(i));
ok(res.every((r) => !r.bad), 'shield lane: ' + res.filter((r) => r.bad).map((r) => r.bad).slice(0, 3));
ok(res.some((r) => r.log.some((l) => l[1])) && res.some((r) => r.log.some((l) => !l[1])), 'both blocked and unblocked hits occur');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const w0 = Use.SHIELD_WARMUP_TICKS; Use.SHIELD_WARMUP_TICKS = 4;
brk(res.map((_, i) => lane(i)).some((r) => r.bad), 'raise delay 5 -> 4'); Use.SHIELD_WARMUP_TICKS = w0;
const b0 = Use.blockedByShield; Use.blockedByShield = (P, s, a) => b0(P, s, { x: -a.x, z: -a.z });
brk(Array.from({ length: 20 }, (_, i) => lane(i)).some((r) => r.bad), 'arc sign flip'); Use.blockedByShield = b0;
const d0 = Use.SHIELD_DISABLE_COOLDOWN; Use.SHIELD_DISABLE_COOLDOWN = 60;
brk(lane(0).bad !== undefined, 'disable cooldown 100 -> 60'); Use.SHIELD_DISABLE_COOLDOWN = d0;
console.log(`shieldlockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
