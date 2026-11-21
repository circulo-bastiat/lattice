#!/usr/bin/env node
// lockstep-schooling -- #7078 (G17-L215): lockstep scenario schooling, 20 salts. 6 salmon in a 12x12x6 arena (one at 8.5 blocks, inside
// the expand(8) box only because of both half-widths). Reference = SchoolingFishEntity + FollowGroupLeaderGoal (.decomp) fed the SAME pinned
// stream as the engine. Per tick, per fish in list order: canStart/shouldContinue/stop and the leader index, groupSize, hasFollowers.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dec = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/ai/goal/FollowGroupLeaderGoal.java'), 'utf8');
if (!/200 \+ \$\$0\.getRandom\(\)\.nextInt\(200\) % 20/.test(dec) || !/expand\(8\.0, 8\.0, 8\.0\)/.test(dec)) throw new Error('FollowGroupLeaderGoal changed in the decomp');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 700, N = 6, MAX = 5, W = 0.7, H = 0.4;
const pos = (salt) => { const r = stream(salt + 999); const p = [{ x: 0, y: 2, z: 0 }, { x: 8.5, y: 2, z: 0 }]; for (let i = 2; i < N; i++) p.push({ x: r() * 12 - 6, y: 1 + r() * 5, z: r() * 12 - 6 }); return p; };
const snap = (fs) => fs.map((f) => `${f.leader ? fs.indexOf(f.leader) : -1}/${f.size}/${fs.some((o) => o.leader === f) ? 1 : 0}`).join(' ');

function reference(salt) {
  const rnd = stream(salt), P = pos(salt);
  const fs = P.map((p) => ({ ...p, leader: null, size: 1, delay: 0, run: false, move: 0 }));
  const rint = (n) => Math.floor(rnd() * n);
  const delay = () => 200 + rint(200) % 20;
  for (const f of fs) f.delay = delay();
  const has = (f) => f.leader !== null;
  const near = (f) => fs.filter((o) => Math.abs(o.x - f.x) < 8 + W && Math.abs(o.y - f.y) < 8 + H && Math.abs(o.z - f.z) < 8 + W);
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    for (const f of fs) {
      if (!f.run) {
        let can;
        if (f.size > 1) can = false;
        else if (has(f)) can = true;
        else if (f.delay > 0) { f.delay--; can = false; }
        else {
          f.delay = delay();
          const list = near(f).filter((o) => (o.size > 1 && o.size < MAX) || !has(o));
          const l = list.find((o) => o.size > 1 && o.size < MAX) || f;
          list.filter((o) => !has(o)).slice(0, MAX - l.size).filter((o) => o !== l).forEach((o) => { o.leader = l; l.size++; });
          can = has(f);
        }
        if (can) { f.run = true; f.move = 0; }
      } else if (!(has(f) && (f.leader.x - f.x) ** 2 + (f.leader.y - f.y) ** 2 + (f.leader.z - f.z) ** 2 <= 121)) {
        f.run = false; if (f.leader) { f.leader.size--; f.leader = null; }
        continue;
      }
      if (f.run && --f.move <= 0) f.move = 10;
    }
    for (const f of fs) if (f.size > 1 && rint(200) === 1 && near(f).length <= 1) f.size = 1;
    rows.push(snap(fs));
  }
  return rows;
}
function engine(patch, salt) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07zj_fish.js'] });
  const rnd = stream(salt); M.Fish.random = rnd;
  const fs = pos(salt).map((p) => ({ type: 'salmon', ...p, width: W, height: H, removed: false, dead: false }));
  M.EntityList.list = fs;
  const gs = fs.map((e) => new M.Fish.FollowGroupLeaderGoal(e)), run = fs.map(() => false), rows = [];
  const view = () => fs.map((f) => ({ leader: f.fishLeader || null, size: f.fishGroupSize || 1 }));
  for (let t = 0; t < TICKS; t++) {
    fs.forEach((e, i) => {
      const g = gs[i];
      if (!run[i]) { if (g.canUse()) { run[i] = true; g.start(); } }
      else if (!g.canContinueToUse()) { run[i] = false; g.stop(); return; }
      if (run[i]) { M.Ai.findPath = () => null; g.tick(); }
    });
    fs.forEach((e) => M.Fish.schoolTick(e));
    const v = view().map((x, i) => ({ ...x, leader: x.leader ? fs.indexOf(x.leader) : -1 }));
    rows.push(v.map((x, i) => `${x.leader}/${x.size}/${v.some((o) => o.leader === i) ? 1 : 0}`).join(' '));
  }
  return rows;
}
function run(patch) {
  const bad = []; let groups = 0;
  for (let salt = 0; salt < 20; salt++) {
    const R = reference(salt), E = engine(patch, salt);
    for (let t = 0; t < TICKS; t++) {
      if (/ [2-9]\//.test(' ' + R[t])) groups++;
      if (R[t] !== E[t]) { bad.push(`salt ${salt} tick ${t}: ref [${R[t]}] engine [${E[t]}]`); break; }
    }
  }
  return { bad, groups };
}
let fails = 0, breaks = 0;
const base = run(null);
if (base.bad.length) { fails++; console.log('  FAIL ' + base.bad.slice(0, 3).join(' | ')); }
if (!base.groups) { fails++; console.log('  FAIL vacuous: no group ever formed'); }
const mut = (name, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== '07zj_fish.js') return src; const o = src.replace(f, to); hit = hit || o !== src; return o; };
  const r = run(patch);
  if (!hit) { fails++; console.log('  FAIL mutation did not apply: ' + name); } else if (r.bad.length) { breaks++; console.log('   ✓ break caught: ' + name + ' -> ' + r.bad[0].split(':')[0]); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('group max size 5 -> 6', "'salmon' ? 5 : 8", "'salmon' ? 6 : 8");
mut('recheck interval 200 -> 100', 'return 200 + rint(200) % 20', 'return 100 + rint(200) % 20');
mut('search box back to 8.25', 'hw = 8 + ((e.width || 0.5) + (o.width || 0.5)) / 2', 'hw = 8.25');
console.log(`lockstep-schooling: ${20 * TICKS + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${base.groups} grouped ticks over 20 salts)`);
process.exit(fails ? 1 : 0);
