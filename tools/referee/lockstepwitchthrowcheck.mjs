// lockstep-witchthrow -- #6861 (G17-L160): witch throws splash potions at a standing player, 20 salts.
// Reference (independent of src, from WitchEntity.attack in .decomp): aim = target pos + velocity - witch pos, dy = eyeY - 1.1 - witchY;
// d = hypot(dx,dz); choice chain: d>=8 & !slowness -> slowness; hp>=8 & !poison -> poison; d<=3 & !weakness & nextFloat<0.25 -> weakness;
// else harming. setVelocity(dx, dy + d*0.2, dz, 0.75, 8.0) = normalize + gaussian*0.0075*8, * 0.75. Spawn at witch eye (1.62) - 0.1.
// Cooldown: ProjectileAttackGoal(1.0, 60, 60, 10): first shot after 60 ticks, then every 60.
import { loadEngine } from '../loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const MCL = loadEngine({ extra: ['02f_tags.js', '07q_effects.js', '07z_potion.js', '07k_goals.js'], dom: false });
const Po = MCL.Potion || MCL.Po, ES = MCL.Effects;

// seeded uniform stream; each consumer gets its own identical copy
function stream(seed) { let s = seed >>> 0 || 1; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; return f; }
function refGauss(r) {
  if (r.haveG) { r.haveG = false; return r.nextG; }
  let a, b, q;
  do { a = 2 * r() - 1; b = 2 * r() - 1; q = a * a + b * b; } while (q >= 1 || q === 0);
  const m = Math.sqrt(-2 * Math.log(q) / q); r.nextG = b * m; r.haveG = true; return a * m;
}
function refChoose(d, hp, has, r) {
  if (d >= 8 && !has.slowness) return 'slowness';
  if (hp >= 8 && !has.poison) return 'poison';
  if (d <= 3 && !has.weakness && r() < 0.25) return 'weakness';
  return 'harming';
}
const mkPlayer = (x, hp, slow, poison, weak) => {
  const p = { type: 'player', x, y: 64, z: 0, vx: 0, vy: 0, vz: 0, health: hp, height: 1.8, eyeHeight: 1.62, effects: [] };
  if (slow) ES.addStatusEffect(p, 'slowness', 600, 0); if (poison) ES.addStatusEffect(p, 'poison', 600, 0); if (weak) ES.addStatusEffect(p, 'weakness', 600, 0);
  return p;
};
function run() {
  let bad = 0, cases = 0;
  const bump = (m) => { bad++; if (bad < 25 && VERBOSE !== null) console.log('  FAIL ' + m); };
  for (let salt = 1; salt <= 20; salt++) for (const d of [2, 4, 8, 12]) for (const hp of [20, 6]) for (const fx of [0, 1, 2, 3]) {
    cases++;
    const slow = !!(fx & 1), poison = !!(fx & 2);
    const tag = `salt ${salt} d=${d} hp=${hp} fx=${fx}`;
    const tx = d + (salt % 5) * 0.1, vx = (salt % 3 - 1) * 0.05;
    const P = mkPlayer(tx, hp, slow, poison, false); P.vx = vx;
    const W = { type: 'witch', x: 0, y: 64, z: 0, height: 1.95, witchDrinking: false };
    const got = []; const spawn = (t, x, y, z, o) => { const e = Object.assign({ type: t, x, y, z }, o); got.push(e); return e; };
    const sounds = []; MCL.Sound = { play: (id, o) => sounds.push([id, o.pitch, o.volume]) };
    const ra = stream(salt * 7919), rb = stream(salt * 7919);
    const e = Po.witchThrow(W, P, spawn, ra);
    if (!e || got.length !== 1) { bump(tag + ' no potion'); continue; }
    const dx = tx + vx, dz = 0, dy0 = 64 + 1.62 - 1.1 - 64, d2 = Math.hypot(dx, dz);
    const want = refChoose(d2, hp, { slowness: slow, poison }, rb);
    if (e.potionId !== want) bump(tag + ` potion ${e.potionId} want ${want}`);
    const dy = dy0 + d2 * 0.2, len = Math.hypot(dx, dy, dz);
    const g = [refGauss(rb) * 0.06, refGauss(rb) * 0.06, refGauss(rb) * 0.06];
    const wv = [(dx / len + g[0]) * 0.75, (dy / len + g[1]) * 0.75, (dz / len + g[2]) * 0.75];
    ['vx', 'vy', 'vz'].forEach((k, i) => { if (Math.abs(e[k] - wv[i]) > 1e-9) bump(tag + ` ${k} ${e[k]} want ${wv[i]}`); });
    if (Math.abs(e.y - (64 + 1.62 - 0.1)) > 1e-9 || e.x !== 0 || e.z !== 0) bump(tag + ` spawn ${e.x},${e.y},${e.z}`);
    const pitch = 0.8 + rb() * 0.4;
    if (sounds.length !== 1 || sounds[0][0] !== 'entity.witch.throw' || Math.abs(sounds[0][1] - pitch) > 1e-9) bump(tag + ' sound ' + JSON.stringify(sounds));
    W.witchDrinking = true;
    if (Po.witchThrow(W, P, spawn, stream(1)) !== null) bump(tag + ' threw while drinking');
  }
  return { bad, cases };
}
// cooldown: ProjectileAttackGoal re-arms at floor(f*(max-min)+min) = 60 with min==max
function cooldown() {
  const Ai = MCL.Ai; let bad = 0;
  if (!Ai || !Ai.ProjectileAttackGoal) { console.log('  FAIL no Ai.ProjectileAttackGoal'); return 1; }
  const w = { x: 0, y: 64, z: 0, yaw: 0, height: 1.95 }, t = { x: 6, y: 64, z: 0, height: 1.8 }; w.target = t;
  const shots = []; const orig = Ai.canSee, fp = Ai.findPath; Ai.canSee = () => true; Ai.findPath = () => null;   // pathing is not under test
  const g = new Ai.ProjectileAttackGoal(w, 1.0, 60, 60, 10.0, () => shots.push(tick));
  let tick = 0; g.start();
  for (tick = 1; tick <= 200; tick++) g.tick();
  Ai.canSee = orig; Ai.findPath = fp;
  const want = [61, 121, 181];
  if (JSON.stringify(shots) !== JSON.stringify(want)) { bad++; console.log('  FAIL cooldown shots ' + JSON.stringify(shots) + ' want ' + JSON.stringify(want)); }
  return bad;
}
const base = run(); const cd = cooldown();
console.log(`lockstep-witchthrow: ${base.cases} cases (20 salts x 4 distances x 2 health x 4 effect sets), ${base.bad + cd} divergences`);
let nfail = base.bad + cd, nbreaks = 0;
function mut(name, apply, undo) {
  apply(); const q = console.log; console.log = () => {}; const r = run().bad; console.log = q; undo();
  if (r > 0) { nbreaks++; console.log('   ✓ break caught: ' + name); } else { nfail++; console.log('  NOT CAUGHT: ' + name); }
}
const orig = Po.witchChoosePotion;
const wrap = (f) => () => { Po.witchChoosePotion = f; };
mut('swap poison/slowness thresholds', wrap((w, t, r) => {
  const d = Math.hypot(t.x + (t.vx || 0) - w.x, t.z + (t.vz || 0) - w.z);
  if (d >= 8 && !ES.hasStatusEffect(t, 'poison')) return 'poison';
  if (t.health >= 8 && !ES.hasStatusEffect(t, 'slowness')) return 'slowness';
  return orig(w, t, r);
}), () => { Po.witchChoosePotion = orig; });
mut('health threshold 8 -> 4', wrap((w, t, r) => { const h = t.health; t.health = h >= 4 && h < 8 ? 8 : h; const o = orig(w, t, r); t.health = h; return o; }), () => { Po.witchChoosePotion = orig; });
const p0 = Po.THROW_POWER, a0 = Po.THROW_ARC;
mut('throw power', () => { Po.THROW_POWER = 0.7; }, () => { Po.THROW_POWER = p0; });
mut('lob arc', () => { Po.THROW_ARC = 0.1; }, () => { Po.THROW_ARC = a0; });
console.log(`lockstep-witchthrow: ${base.cases} assertions, ${nfail} failures, ${nbreaks} breaks caught`);
process.exit(nfail ? 1 : 0);
