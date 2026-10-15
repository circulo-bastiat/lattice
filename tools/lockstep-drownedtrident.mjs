#!/usr/bin/env node
// lockstep-drownedtrident -- #6865 (G17-L164): lockstep scenario drownedtrident, 20 salts.
// Reference = DrownedEntity.initEquipment (nextFloat>0.9, nextInt(16)<10 trident else rod) + DrownedEntity.attack (.decomp: trident at eye-0.1,
// dy = bodyY(1/3)-y + dist*0.2F, setVelocity(1.6F, 14-diff*4): normalize, + gauss*0.0075*div per axis, * 1.6; shoot sound pitch 1/(r*0.4+0.8)),
// NOTE: Eq.* rolls take a () => double, so each nextFloat/nextInt of vanilla is one nextDouble here (same odds, not the same bits; owed to the Eq rnd contract).
// TridentEntity base damage 8, MobEntity DEFAULT_DROP_CHANCE 0.085, replayed draw-for-draw on one java.util.Random stream.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07y_equip.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, Eq = M.Equip, f32 = Math.fround;
const sounds = [];
M.Sound = Object.assign(M.Sound || {}, { entitySound: (ev, x, y, z, v, p) => sounds.push([ev, v, p]) });
const stream = (salt) => { const j = new M.JRandom(salt * 7919 + 17), r = () => j.nextDouble(); r.nextDouble = r; return { j, r }; };
const gauss = (j) => M.U.polarGaussian(j, j.nextDouble);
const DIFF = 2, N = 40, IT = M.Items;
Eq.updateEnchantments = () => {};   // the enchant roll is its own scenario; this one compares the weapon roll and the shell draw
Eq.ready = true; EL.random = stream(999).r;   // spawn-time rolls go to a throwaway stream
const nm = (st) => st ? IT.names[st.i] : null;

function engine(salt) {
  const { j, r } = stream(salt), out = [];
  for (let i = 0; i < N; i++) {
    const e = EL.spawn('drowned', 0.5, 10, 0.5);
    e.equip = []; e.equipDropChance = null;   // spawn already ran its own roll on EL.random; scrub it, then roll on the scripted stream
    Eq.initDrowned(e, r);
    const held = nm(Eq.getEquipped(e, IT.MAINHAND));
    const tgt = { x: 6 + i * 0.25, y: 10, z: 3 - i * 0.125, height: 1.8 };
    sounds.length = 0;
    const t = Cb.mobShootTrident(e, tgt, r);
    out.push(JSON.stringify({ held, drop: Eq.dropChance(e, IT.MAINHAND), shell: nm(Eq.getEquipped(e, IT.OFFHAND)), p: [t.x, t.y, t.z], v: [t.vx, t.vy, t.vz], snd: sounds, dmg: Cb.TRIDENT_BASE_DAMAGE, rem: j.nextDouble() }));
    EL.clear();
  }
  return out;
}
function reference(salt) {
  const { j } = stream(salt), out = [];
  for (let i = 0; i < N; i++) {
    let held = null;
    if (j.nextDouble() > 0.9) held = Math.floor(j.nextDouble() * 16) < 10 ? 'trident' : 'fishing_rod';   // DrownedEntity.initEquipment
    let shell = null;
    if (j.nextDouble() < 0.03) shell = 'nautilus_shell';                                // DrownedEntity.initialize
    const ey = 10 + 1.74 - f32(0.1), ay = ey;   // drowned eye height 1.74 (EntityType dims)
    const tx = 6 + i * 0.25, tz = 3 - i * 0.125;
    const dx = tx - 0.5, dz = tz - 0.5, dy0 = 10 + 1.8 / 3 - ay, dist = Math.sqrt(dx * dx + dz * dz);
    const dy = dy0 + dist * f32(0.2), len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const g = f32(0.0075) * (14 - DIFF * 4), sp = f32(1.6);
    const v = [(dx / len + gauss(j) * g) * sp, (dy / len + gauss(j) * g) * sp, (dz / len + gauss(j) * g) * sp];
    const snd = [['entity.drowned.shoot', 1, 1 / (j.nextDouble() * 0.4 + 0.8)]];
    out.push(JSON.stringify({ held, drop: held ? 0.085 : 0.085, shell, p: [0.5, ay, 0.5], v, snd, dmg: 8, rem: j.nextDouble() }));
  }
  return out;
}
function run() {
  let bad = null, tridents = 0;
  for (let s = 0; s < 20 && !bad; s++) {
    const a = engine(s), b = reference(s);
    for (let i = 0; i < N; i++) { if (a[i] !== b[i]) { bad = `salt ${s} shot ${i}: engine ${a[i]} != ref ${b[i]}`; break; } if (JSON.parse(a[i]).held === 'trident') tridents++; }
  }
  return { bad, tridents };
}
let fails = 0, breaks = 0;
const base = run();
if (base.bad) { fails++; console.log('  FAIL ' + base.bad.slice(0, 600)); }
if (!base.tridents) { fails++; console.log('  FAIL vacuous: no drowned ever rolled a trident'); }
const mut = (name, o, k, v) => {
  const old = o[k]; o[k] = v;
  const r = run(); o[k] = old;
  if (r.bad) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('equip chance 0.9 -> 0.8', Eq, 'DROWNED_WEAPON_CHANCE', 0.8);
mut('trident roll 10 -> 9', Eq, 'DROWNED_TRIDENT_ROLL', 9);
mut('throw speed 1.6 -> 1.5', Cb, 'ARROW_SHOOT_SPEED', f32(1.5));
mut('trident damage 8 -> 9', Cb, 'TRIDENT_BASE_DAMAGE', 9);
mut('held drop chance 0.085 -> 0.1', Eq, 'DEFAULT_DROP_CHANCE', 0.1);
console.log(`lockstep-drownedtrident: ${21 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${base.tridents} tridents over 20 salts)`);
process.exit(fails ? 1 : 0);
