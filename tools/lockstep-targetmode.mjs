#!/usr/bin/env node
// lockstep-targetmode -- #8877: TargetPredicate.test / TrackTargetGoal.shouldContinue against gamemode and state (Ai.NearestAttackableTargetGoal),
// 20 salts. zombie/skeleton/spider/iron_golem(not player made: hostile-to-player golems are not vanilla, so the golem faces the player through
// the same ActiveTargetGoal shape) vs a player in survival/adventure/creative/spectator, plus survival+invulnerable flag (still targeted:
// includeInvulnerable), invisible (range shrinks to max(fr*0.07, 2)), beyond followRange, behind a wall (no acquire; held target dropped after 60).
// Per tick: acquire (reciprocalChance 10 roll, 1/10) or canContinueToUse, against a reference written from TargetPredicate.java/TrackTargetGoal.java.
// Mid-run the player flips to creative: the held target is dropped at once (shouldContinue: includeInvulnerable false).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tp = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/ai/TargetPredicate.java'), 'utf8');
if (!/Math.max\(this.baseMaxDistance \* \$\$2, 2.0\)/.test(tp)) throw new Error('decomp changed');
const MOBS = [['zombie', 35], ['skeleton', 16], ['spider', 16], ['iron_golem', 16]];
const MODES = ['survival', 'adventure', 'creative', 'spectator'];
const CASES = ['plain', 'invulnerable', 'invisible', 'far', 'wall'];

function runAll(patch, salt) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07w_passive.js', '07zv_villagerbrain.js', '07l_spawn.js', '14c_raycast.js', '07v_spell.js', '14e_gamemode.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
  const Ai = M.Ai, W = M.World, EL = M.EntityList, Gm = M.Gamemode, bad = [];
  let s = (salt * 2654435761 + 7) >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  let visible = true; Ai.canSee = () => visible;
  M.Effects = M.Effects || {}; M.Effects.hasStatusEffect = (e, k) => !!e.invis && k === 'invisibility';
  const modeNames = { survival: Gm.SURVIVAL, adventure: Gm.ADVENTURE, creative: Gm.CREATIVE, spectator: Gm.SPECTATOR };
  for (const [mob, fr] of MOBS) for (const mode of MODES) for (const kind of CASES) {
    const tag = `${mob} ${mode} ${kind} salt=${salt}`;
    EL.clear(); const next = []; EL.random = () => (next.length ? next.shift() : rnd());
    const e = EL.spawn(mob, 0.5, 20, 0.5); if (!e) { bad.push(tag + ' no spawn'); continue; }
    e.followRange = 0; e.followBonus = 0; e.target = null;
    const dist = kind === 'far' ? fr + 1 + Math.floor(rnd() * 4) : 3 + Math.floor(rnd() * 3);   // invisible: > 2.45 so out of reach
    const p = { x: 0.5 + dist, y: 20, z: 0.5, health: 20, type: 'player', width: 0.6, height: 1.8 };
    Gm.set(p, modeNames[mode]);
    if (kind === 'invulnerable') p.invulnerable = true;
    if (kind === 'invisible') p.invis = true;
    const wallAt = salt % 2 ? 0 : 5 + Math.floor(rnd() * 40);   // odd salts: wall from the start; even: the player ducks behind it later
    visible = true;
    const g = new Ai.NearestAttackableTargetGoal(e, () => [p], { sight: true, mustSee: true, reciprocalChance: 10, rand: EL.random });
    const canTarget = mode === 'survival' || mode === 'adventure';
    let held = false, unseen = 0, active = false;
    for (let t = 0; t < 140; t++) {
      if (kind === 'wall' && t === wallAt) visible = false;
      if (t === 100 && mode !== 'creative' && mode !== 'spectator') { Gm.set(p, Gm.CREATIVE); }
      const now = t < 100 ? canTarget : false;
      const r = rnd(); next.push(r);
      const range = kind === 'invisible' ? Math.max(fr * 0.07, 2) : fr;
      const d = p.x - e.x;
      let want;
      if (!held) {
        // canStart: nextInt(10)==0, then the predicate: canTarget && range && (respectsVisibility ? canSee)
        want = Math.floor(r * 10) === 0 && now && d <= range && visible;
        if (want) { held = true; unseen = 0; }
        const got = g.canUse(); if (got) g.start(); else next.length = 0;
        if (got !== want) { bad.push(tag + ` tick ${t} canUse ${got} want ${want}`); break; }
        if (got !== (e.target === p)) { bad.push(tag + ` tick ${t} target field`); break; }
      } else {
        next.length = 0;
        want = now && d <= fr;
        if (want && !visible && ++unseen > 60) want = false;
        if (want && visible) unseen = 0;
        const got = g.canContinueToUse();
        if (got !== want) { bad.push(tag + ` tick ${t} canContinue ${got} want ${want}`); break; }
        if (!got) { g.stop(); held = false; if (e.target !== null) { bad.push(tag + ' target kept after stop'); break; } }
      }
    }
  }
  return bad;
}

let fails = 0, breaks = 0;
for (let s = 0; s < 20; s++) { const b = runAll(null, s); if (b.length) { fails++; console.log('  FAIL salt ' + s + ': ' + b.slice(0, 3).join(' | ')); } }
const mut = (name, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== '07k_goals.js') return src; const o = src.replace(f, to); hit = o !== src; return o; };
  let caught = false; for (let s = 0; s < 20 && !caught; s++) caught = runAll(patch, s).length > 0;
  if (!hit) { fails++; console.log('  FAIL mutation did not apply: ' + name); } else if (caught) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('creative players targetable', 'if (t.invulnerableGamemode) return false;\n      if (Gm && Gm.isCreative', 'if (false) return false;\n      if (false && Gm && Gm.isCreative');
mut('unseen limit 60 -> 80', "(opts && opts.maxNoSight) || 60", "(opts && opts.maxNoSight) || 80");
mut('invisible ignored', 'Math.max(fr * Ai.attackScale(c, e), 2)', 'Math.max(fr, 2)');
mut('no sight gate', 'if (sight && !Ai.canSee(e, c)) continue;', '');
console.log(`lockstep-targetmode: ${20 * 80 + 4} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
