// lingeringlockstepcheck.mjs -- #6611 (G17-L85): lockstep scenario 'lingering': a lingering potion's area_effect_cloud (poison, regeneration, instant health) over 2 cows + 2 zombies, 20 salts.
// Reference = .decomp AreaEffectCloudEntity.tick (:150-275) written out independently: age++, discard at age >= wait(10)+duration(600), no work while age < wait, radius += -3/600 (float) and discard < 0.5,
// every 5th age: drop victims whose release age <= age, hit each unvictimised mob within radius (xz distSq <= r*r): victims[mob] = age+20, effects at duration/4 (instant: factor 0.5, undead inverted), radius -= 0.5 per hit.
// Per tick: radius, remaining life, victim count, and per mob health + effects [[id,amp,duration]].
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07y_equip.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '14j_combat.js', '07z_potion.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.World = Object.assign(M.World || {}, { get: () => 0, getBlock: () => 0, getLight: () => 0, tickingAt: () => true, setBlock: () => {} });
M.Physics.shapeAt = () => null; M.Physics.solidAt = () => false;
M.EntityList.init();
M.Diff = { get: () => 'normal' }; M.Player = null;
const { Effects: ES, Potion: Po } = M;
const ids = ES.IDS;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const TICKS = 330, salts = Array.from({ length: 20 }, (_, i) => i);
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const POT = { poison: ['poison', 900, 0], regeneration: ['regeneration', 900, 0], healing: ['instant_health', 0, 0] };
const POTID = { poison: 'poison', regeneration: 'regeneration', healing: 'healing' };
const MOBS = [['cow', 10, false], ['cow', 10, false], ['zombie', 20, true], ['zombie', 20, true]];
const params = (salt, pot) => { const r = stream(salt * 11 + pot.length); return { wait: 10, mobs: MOBS.map(() => ({ x: 0.3 + r() * 2.6, z: (r() - 0.5) * 0.4, hp0: 2 + Math.floor(r() * 5) })) }; };
const F32 = Math.fround, GROW = F32(-3 / 600);
let REAPPLY = 20, SHRINK_BAD = false;
function reference(pot, p) {
  const [eff, dur, amp] = POT[pot], rows = [];
  let radius = 3, age = 0, gone = false;
  const m = p.mobs.map((q, i) => ({ hp: q.hp0, max: MOBS[i][1], und: MOBS[i][2], x: q.x, z: q.z, fx: null, vic: undefined }));
  for (let t = 0; t < TICKS; t++) {
    age++;
    if (!gone) {
      if (age >= 10 + 600) gone = true;
      else if (age >= 10) {
        radius = F32(radius + GROW);
        if (radius < 0.5) gone = true;
        else if (age % 5 === 0) {
          for (const q of m) if (q.vic !== undefined && age >= q.vic) q.vic = undefined;
          for (const q of m) {
            if (gone || q.vic !== undefined || q.hp <= 0) continue;
            if (q.x * q.x + q.z * q.z > radius * radius) continue;
            q.vic = age + 20;
            if (eff === 'instant_health') { const heal = !q.und; const a = Math.floor(0.5 * (heal ? 4 << amp : 6 << amp) + 0.5); q.hp = heal ? Math.min(q.max, q.hp + a) : q.hp - a; }
            else if (!(q.und && (eff === 'poison' || eff === 'regeneration'))) { const d = Math.floor(dur / 4); if (!q.fx || q.fx.left < d || q.fx.amp < amp) q.fx = { id: ids[eff], amp, left: d }; }
            radius = F32(radius - 0.5);
            if (radius < 0.5) gone = true;
          }
        }
      }
    }
    for (const q of m) {
      if (!q.fx) continue;
      if (eff === 'poison' && q.fx.left % 25 === 0 && q.hp > 1) q.hp -= 1;
      if (eff === 'regeneration' && q.fx.left % 50 === 0 && q.hp < q.max) q.hp += 1;
      if (--q.fx.left <= 0) q.fx = null;
    }
    rows.push({ r: gone ? 0 : radius, life: gone ? 0 : 610 - age, vic: m.filter((q) => q.vic !== undefined).length, hp: m.map((q) => Math.max(q.hp, 0)), fx: m.map((q) => (q.fx ? [[q.fx.id, q.fx.amp, q.fx.left]] : [])) });
  }
  return rows;
}
function engine(pot, p) {
  M.EntityList.list.length = 0;
  const mk = (i) => ({ id: 900 + i, type: MOBS[i][0], x: p.mobs[i].x, y: 0, z: p.mobs[i].z, height: 1.5, width: 0.6, health: p.mobs[i].hp0, maxHealth: MOBS[i][1], dead: false, equip: {}, effects: {}, noAi: true });
  const mobs = MOBS.map((_, i) => mk(i));
  const c = Po.applyLingeringPotion({ x: 0, y: 0, z: 0, potionId: POTID[pot], shooter: null });
  if (SHRINK_BAD) c.radiusGrowth = 0;
  M.EntityList.list.push(...mobs);
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    M.EntityList.tickOne(c);
    for (const e of mobs) { if (e.invulnerableTime > 0) e.invulnerableTime--; ES.tick(e); }
    const gone = c.removed;
    rows.push({ r: gone ? 0 : c.radius, life: gone ? 0 : c.waitTime + c.duration - c.age, vic: Object.keys(c.affected || {}).length, hp: mobs.map((e) => Math.max(e.health, 0)), fx: mobs.map((e) => Object.keys(e.effects).map((k) => [ids[k], e.effects[k].amplifier, e.effects[k].duration])) });
  }
  return rows;
}
const diff = (R, E) => {
  for (let t = 0; t < TICKS; t++) {
    const a = R[t], b = E[t];
    if (Math.abs(a.r - b.r) > 1e-4) return { tick: t, field: 'radius ' + a.r + ' vs ' + b.r };
    if (a.life !== b.life) return { tick: t, field: 'life' };
    if (a.vic !== b.vic) return { tick: t, field: 'victims ' + a.vic + ' vs ' + b.vic };
    if (JSON.stringify(a.hp) !== JSON.stringify(b.hp)) return { tick: t, field: 'health ' + a.hp + ' vs ' + b.hp };
    if (JSON.stringify(a.fx) !== JSON.stringify(b.fx)) return { tick: t, field: 'effects ' + JSON.stringify(a.fx) + ' vs ' + JSON.stringify(b.fx) };
  }
  return null;
};
const run = (pot, salt) => { const p = params(salt, pot), R = reference(pot, p); return { d: diff(R, engine(pot, p)), R }; };
const dirty = (pot) => salts.some((s) => run(pot, s).d);
let hit = 0, shrunk = 0, reapplied = 0;
for (const pot of Object.keys(POT)) {
  const res = salts.map((s) => ({ s, r: run(pot, s) })), bad = res.filter((x) => x.r.d);
  ok(!bad.length, `${pot}: ${bad.slice(0, 2).map((x) => `salt ${x.s} tick ${x.r.d.tick} ${x.r.d.field}`)}`);
  for (const x of res) {
    if (x.r.R.some((q) => q.vic > 0)) hit++;
    if (x.r.R.some((q) => q.r > 0 && q.r < 2.9)) shrunk++;
    if (pot !== 'healing' && x.r.R.some((q, t) => t && q.fx.some((f, i) => f.length && x.r.R[t - 1].fx[i].length && f[0][2] > x.r.R[t - 1].fx[i][0][2]))) reapplied++;
  }
}
ok(hit >= 55, 'clouds reach victims in nearly every lane (not vacuous): ' + hit);
ok(shrunk >= 55, 'radius shrinks while victims are held: ' + shrunk);
ok(reapplied >= 1, 'reapplication after the 20-tick delay seen: ' + reapplied);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
SHRINK_BAD = true; brk(dirty('poison'), 'radius shrink removed reported'); SHRINK_BAD = false;
{ const o = Po.LINGERING_REAPPLY; Po.LINGERING_REAPPLY = 10; brk(dirty('poison'), 'reapplication delay 20 -> 10 reported'); Po.LINGERING_REAPPLY = o; }
{ const o = ES.addStatusEffect; ES.addStatusEffect = (e, id, dur, ...r) => o(e, id, dur * 4, ...r); brk(dirty('regeneration'), 'duration/4 -> full duration reported'); ES.addStatusEffect = o; }
console.log(`lingeringlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
