#!/usr/bin/env node
// lockstep-targetgiveup -- #7713: TrackTargetGoal drop rules (Ai.NearestAttackableTargetGoal, mustSee) against a reference written from
// TrackTargetGoal.java / ActiveTargetGoal.java, 20 salts. zombie/skeleton/spider/evoker hold a player target; the player hides behind a wall
// for 40, 70 and 310 ticks (drop on the 61st unseen tick, 301st for evoker's maxNoSight 300), or walks beyond followRange (35 zombie,
// 16 spider/skeleton, 12 evoker: dropped at once, no slack). Per tick: target field, canContinueToUse, and the reciprocalChance 10 retarget.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tg = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/ai/goal/TrackTargetGoal.java'), 'utf8');
if (!/maxTimeWithoutVisibility = 60/.test(tg) || !/\+\+this\.timeWithoutVisibility > toGoalTicks\(this\.maxTimeWithoutVisibility\)/.test(tg)) throw new Error('decomp changed');
const MOBS = [['zombie', 35, 60], ['skeleton', 16, 60], ['spider', 16, 60], ['evoker', 12, 300]];

function runAll(patch, salt) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07w_passive.js', '07zv_villagerbrain.js', '07l_spawn.js', '14c_raycast.js', '07v_spell.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
  const Ai = M.Ai, W = M.World, EL = M.EntityList, bad = [];
  let s = (salt * 2654435761 + 11) >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  let visible = true; Ai.canSee = () => visible;   // the wall: only visibility differs, the drop rule is what is under test
  for (const [mob, fr, maxNo] of MOBS) for (const hide of [40, 70, 310]) {
    const tag = `${mob} hide=${hide} salt=${salt}`;
    EL.clear(); const next = []; EL.random = () => (next.length ? next.shift() : rnd());
    const e = EL.spawn(mob, 0.5, 20, 0.5); if (!e) { bad.push(tag + ' no spawn'); continue; }
    e.followRange = 0; e.followBonus = 0;   // drop the zombie's random spawn bonus: the base attribute is the vanilla table value
    if (Math.abs(Ai.followRangeOf(e) - fr) > 1e-9) { bad.push(tag + ` followRange ${Ai.followRangeOf(e)} want ${fr}`); continue; }
    const p = { x: 0.5 + 5 + Math.floor(rnd() * 5), y: 20, z: 0.5, health: 20, gamemode: 'survival', type: 'player', width: 0.6, height: 1.8 };
    const g = new Ai.NearestAttackableTargetGoal(e, () => [p], { sight: true, mustSee: true, reciprocalChance: 10, rand: EL.random, maxNoSight: maxNo === 60 ? undefined : maxNo });
    visible = true; e.target = null;
    next.push(0.5); if (g.canUse()) bad.push(tag + ' acquired on a refused reciprocal roll');
    next.push(0.0); if (!g.canUse() || e.target !== p) { bad.push(tag + ' did not acquire on roll 0'); continue; }
    g.start();
    // flicker: 30 unseen ticks, one seen tick resets the counter, then 40 more unseen are still within 60
    if (maxNo === 60) {
      visible = false; for (let t = 0; t < 30; t++) g.canContinueToUse();
      visible = true; g.canContinueToUse(); visible = false;
      for (let t = 0; t < 40; t++) if (!g.canContinueToUse()) { bad.push(tag + ' counter not reset by a seen tick'); break; }
      g.start();
    }
    visible = false; let unseen = 0, dropped = -1;
    for (let t = 1; t <= hide; t++) {
      unseen++; const want = unseen <= maxNo;   // ++timeWithoutVisibility > maxTimeWithoutVisibility ends it
      const got = g.canContinueToUse();
      if (got !== want) { bad.push(tag + ` tick ${t} canContinue ${got} want ${want}`); break; }
      if (!got) { g.stop(); dropped = t; break; }
      if (e.target !== p) { bad.push(tag + ` tick ${t} target lost early`); break; }
    }
    const wantDrop = hide > maxNo ? maxNo + 1 : -1;
    if (dropped !== wantDrop) bad.push(tag + ` dropped at ${dropped} want ${wantDrop}`);
    if ((dropped >= 0) !== (e.target === null)) bad.push(tag + ' target field disagrees with drop');
    // player reappears: counter resets if still held, otherwise the 1/10 roll gates the retarget
    visible = true;
    if (dropped < 0) { if (!g.canContinueToUse()) bad.push(tag + ' reappeared but dropped'); for (let k = 0; k < 70; k++) if (!g.canContinueToUse()) { bad.push(tag + ' counter did not reset'); break; } }
    else {
      next.push(0.5); if (g.canUse()) bad.push(tag + ' retarget on refused roll');
      next.push(0.11); if (g.canUse()) bad.push(tag + ' retarget on roll 0.11 (nextInt(10)=1)');
      next.push(0.09); if (!g.canUse()) bad.push(tag + ' no retarget on roll 0.09 (nextInt(10)=0)'); e.target = null;
      next.push(0.0); if (!g.canUse() || e.target !== p) bad.push(tag + ' no retarget after reappearing');
    }
    // beyond followRange: dropped at once, exactly at the boundary kept
    g.start(); e.target = p; p.x = e.x + fr;
    if (!g.canContinueToUse()) bad.push(tag + ' dropped exactly at followRange');
    p.x = e.x + fr + 0.5;
    if (g.canContinueToUse()) bad.push(tag + ' kept beyond followRange');
    g.stop(); next.push(0.0); if (g.canUse()) bad.push(tag + ' retargeted beyond followRange');
  }
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
mut('unseen limit 60 -> 80', "(opts && opts.maxNoSight) || 60", "(opts && opts.maxNoSight) || 80");
mut('unseen never resets', 'if (Ai.canSee(e, e.target)) unseen = 0;', 'if (Ai.canSee(e, e.target)) unseen += 0;');
mut('follow range slack 1.5x', 'if (d > Ai.followRangeOf(e)) return false;', 'if (d > Ai.followRangeOf(e) * 1.5) return false;');
mut('reciprocal 10 -> 20', "Math.ceil(recip / 2)) !== 0", 'Math.ceil(recip)) !== 0');
console.log(`lockstep-targetgiveup: ${20 + 4} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
