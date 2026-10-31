#!/usr/bin/env node
// lockstep-lookat -- #7711: LookAtEntityGoal / LookAroundGoal / LookControl against the vanilla rules read from .decomp, 20 salts.
// Scripted rolls: start only on a roll < 0.02 within range (3/6/12 blocks, cow 6.0 and default 8.0), lookTime 40+nextInt(40) /
// 20+nextInt(20) (LookAround runs while lookTime >= 0), then the per-tick head yaw step (<=10 deg) and pitch (clamped 40 deg)
// against a reference LookControl written from LookControl.java, then the player walking off.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(ROOT, '.decomp/net/minecraft/entity/ai', f), 'utf8');
if (!/40 \+ .*nextInt\(40\)/.test(rd('goal/LookAtEntityGoal.java')) || !/20 \+ .*nextInt\(20\)/.test(rd('goal/LookAroundGoal.java'))) throw new Error('decomp changed');
const DEG = Math.PI / 180, wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const MOBS = ['cow', 'villager', 'wolf', 'zombie'], DISTS = [3, 6, 12];

function runAll(patch, salt) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07w_passive.js', '07zv_villagerbrain.js', '07l_spawn.js', '14c_raycast.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
  const Ai = M.Ai, W = M.World, EL = M.EntityList, bad = [];
  let s = (salt * 2654435761 + 7) >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  for (const mob of MOBS) for (const d of DISTS) for (const range of [6, 8]) {
    const tag = `${mob} d=${d} range=${range} salt=${salt}`;
    EL.clear(); const next = []; EL.random = () => (next.length ? next.shift() : rnd());
    const e = EL.spawn(mob, 0.5, 20, 0.5); if (!e) { bad.push(tag + ' no spawn'); continue; }
    Ai.tickHead(e);
    const p = { x: 0.5 + d, y: 20 + (d === 3 ? 6 : 0), z: 0.5, health: 20, gamemode: 'survival' };
    const g = new Ai.LookAtPlayerGoal(e, () => [p], range, EL.random);
    // start: the 0.02 roll gates, range decides
    next.push(0.5); if (g.canUse()) bad.push(tag + ' started on roll 0.5');
    const n = Math.floor(rnd() * 40);
    next.push(0.01); const can = g.canUse();
    const eyeD = Math.hypot(d, p.y - 20 - Ai.eyeOf(e));   // TargetPredicate: eye of the mob to the target's FEET
    if (can !== (eyeD <= range)) bad.push(tag + ` canUse ${can} want ${eyeD <= range}`);
    if (!can) continue;
    next.push((n + 0.5) / 40); g.start();
    let ticks = 0, y0 = e.yHeadRot || 0;
    const eyeY = e.y + Ai.eyeOf(e), ty = p.y + Ai.eyeOf(p);
    const wantP = -Math.atan2(ty - eyeY, d);
    let yaw = y0;
    while (g.canContinueToUse() && ticks < 200) {
      g.tick(); Ai.tickHead(e); ticks++;
      const ny = e.yHeadRot, step = Math.abs(wrap(ny - yaw));
      if (step > 10 * DEG + 1e-6) bad.push(tag + ` yaw step ${(step / DEG).toFixed(2)} > 10`);
      yaw = ny;
      const wp = Math.max(-40 * DEG, Math.min(40 * DEG, wantP));
      if (Math.abs((e.xHeadRot || 0) - wp) > 5e-6) { bad.push(tag + ` pitch ${(e.xHeadRot / DEG).toFixed(2)} want ${(wp / DEG).toFixed(2)}`); break; }   // #6964: MathHelper.atan2 is a table (error ~1e-6 rad), not libm
    }
    if (ticks !== 40 + n) bad.push(tag + ` lookTime ${ticks} want ${40 + n}`);
    // head reached the target: after 40+ ticks it must sit on the wanted yaw (vanilla yaw = engine yaw - 180)
    const wy = Ai.wantedHeadYaw(e, p.x, p.z);
    if (Math.abs(wrap(yaw - wy)) > 1e-6) bad.push(tag + ' head not on target');
    const vanY = Math.atan2(p.z - e.z, p.x - e.x) - Math.PI / 2;
    if (Math.abs(wrap(wy - vanY)) > 1e-6 && Math.abs(wrap(wy - vanY - Math.PI)) > 1e-6) bad.push(tag + ' target yaw is not vanilla\'s up to the D-415 offset');
    // player walks off: goal must end the moment he is out of range
    p.x = 0.5 + range + 1;
    if (g.canContinueToUse()) { /* lookTime exhausted already */ bad.push(tag + ' continues after lookTime'); }
    // LookAround
    const la = new Ai.RandomLookAroundGoal(e, EL.random);
    next.push(0.03); if (la.canUse()) bad.push(tag + ' LookAround on 0.03');
    next.push(0.019); if (!la.canUse()) bad.push(tag + ' LookAround missed 0.019');
    const m = Math.floor(rnd() * 20), ang = rnd();
    next.push(ang, (m + 0.5) / 20); la.start();
    let t2 = 0; const ex = e.x, ez = e.z;
    while (la.canContinueToUse() && t2 < 100) { la.tick(); t2++; }
    if (t2 !== 21 + m) bad.push(tag + ` LookAround ran ${t2} want ${21 + m}`);
    const w = e.look.wanted, a = Math.PI * 2 * ang;
    if (!w || Math.abs(w.x - (ex + Math.cos(a))) > 1e-9 || Math.abs(w.z - (ez + Math.sin(a))) > 1e-9) bad.push(tag + ' LookAround direction');
  }
  // LookControl idle: with nothing to look at, head eases to body at 10 deg/tick
  EL.clear(); const e = EL.spawn('cow', 0.5, 20, 0.5); Ai.tickHead(e);
  e.yBodyRot = 0; e.yHeadRot = 100 * DEG;
  let want = 100;
  for (let k = 0; k < 12; k++) { Ai.tickHead(e); want = Math.max(0, want - 10); if (Math.abs(e.yHeadRot / DEG - want) > 1e-6) { bad.push(`idle ease tick ${k}: ${(e.yHeadRot / DEG).toFixed(2)} want ${want}`); break; } }
  return bad;
}

let fails = 0, breaks = 0;
for (let s = 0; s < 20; s++) { const b = runAll(null, s); if (b.length) { fails++; console.log('  FAIL salt ' + s + ': ' + b.slice(0, 3).join(' | ')); } }
const mut = (name, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== '07k_goals.js') return src; const o = src.replace(f, to); hit = o !== src; return o; };
  const caught = runAll(patch, 1).length > 0;
  if (!hit) { fails++; console.log('  FAIL mutation did not apply: ' + name); } else if (caught) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('look-at window 40 -> 50', 'lookTime = 40 + Ai.nextIntOf(e, rand, 40)', 'lookTime = 50 + Ai.nextIntOf(e, rand, 40)');
mut('pitch clamp 40 -> 30', 'Ai.HEAD_MAX_PITCH = 40 * DEG', 'Ai.HEAD_MAX_PITCH = 30 * DEG');
mut('yaw speed 10 -> 15', 'Ai.HEAD_ROT_SPEED = 10 * DEG', 'Ai.HEAD_ROT_SPEED = 15 * DEG');
mut('look-around window 20 -> 30', 'lookTime = 20 + Ai.nextIntOf(e, rand, 20)', 'lookTime = 30 + Ai.nextIntOf(e, rand, 20)');
console.log(`lockstep-lookat: ${20 + 4} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
