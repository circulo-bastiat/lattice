#!/usr/bin/env node
// lockstep-caravan -- #6890 (G17-L173): lockstep scenario caravan, 20 salts. Three llamas, one leashed to a player, 1200 ticks.
// Reference = LlamaEntity.follow/stopFollowing + FormCaravanGoal (.decomp: canStart nearest following-unfollowed then leashed-unfollowed within
// expand(9,4,9), dist^2<4 refuses, canFollow depth>8 refuses; shouldContinue: dist^2>676 ramps speed *1.2 (cap 3.0) for 40 ticks) +
// LlamaEntity.getStrength 1..5 / getInventoryColumns = strength / inventory 2+3*columns, replayed on one java.util.Random stream.
// The follow SPEED is read from the roster source (Ai.ROSTER.llama: FormCaravanGoal(e, 2.1)).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const SPEED_SRC = /new Ai\.FormCaravanGoal\(e, ([0-9.]+)\)/;
const mk = (src) => {
  const NS = { Mount: {}, EntityList: { list: [] } };
  new Function('MCL', read('07r_mount.js'))(NS); new Function('MCL', src)(NS);
  NS.Mount.isLeashed = (e) => !!e.leashHolder;
  return NS;
};
const TICKS = 1200;

function engine(salt, goalsSrc, llSrc) {
  const NS = mk(llSrc), Ll = NS.Llama, Mnt = NS.Mount, r = stream(salt), out = [];
  const speed = +SPEED_SRC.exec(goalsSrc)[1];
  const ls = [0, 1, 2].map((i) => ({ type: 'llama', x: i * (salt % 2 ? 1.2 : 5) - 5, y: 64, z: 0, width: 0.9, height: 1.87, strength: 0, leashHolder: i === 0 ? { kind: 'player' } : null }));
  const heads = ls.map((l) => (Mnt.setStrength(l, 1 + Math.floor(r() * 5)), 0));
  NS.EntityList.list = ls;
  let cur = speed, counter = 0;
  for (let t = 0; t < TICKS; t++) {
    ls[0].x += (salt % 4 > 1 ? 1.5 : 0.2) * (r() < 0.5 ? 1 : 0.5);   // the player drags the head llama
    for (const l of ls.slice(1)) {
      if (!l.llamaFollowing) { if (Ll.canStartCaravan(l)) { cur = speed; counter = 0; } continue; }
      const d = l.llamaFollowing, dx = d.x - l.x, d2 = dx * dx + (d.y - l.y) ** 2 + (d.z - l.z) ** 2;
      if (d2 > 676 && cur <= 3.0) { cur *= Ll.CARAVAN_SPEED_RAMP; counter = 40; } else if (d2 > 676 && counter === 0) { Ll.stopFollowing(l); continue; } else if (counter > 0) counter--;
      if (Math.sqrt(d2) > 2) l.x += Math.min(cur * 0.1, Math.sqrt(d2) - 2) * Math.sign(dx);
    }
    out.push(JSON.stringify([ls.map((l) => l.x.toFixed(6)), ls.map((l) => l.llamaFollowing ? ls.indexOf(l.llamaFollowing) : -1), ls.map((l) => l.llamaFollower ? ls.indexOf(l.llamaFollower) : -1), cur, ls.map((l) => [Mnt.getStrength(l), Mnt.inventoryColumns(l), 2 + 3 * Mnt.inventoryColumns(l)])]));
  }
  return out;
}
function reference(salt) {
  const r = stream(salt), out = [], x = [0, 1, 2].map((i) => i * (salt % 2 ? 1.2 : 5) - 5), st = [0, 1, 2].map(() => 1 + Math.floor(r() * 5));
  const fol = [-1, -1, -1], flr = [-1, -1, -1];
  let cur = 2.1, counter = 0;
  for (let t = 0; t < TICKS; t++) {
    x[0] += (salt % 4 > 1 ? 1.5 : 0.2) * (r() < 0.5 ? 1 : 0.5);
    for (let i = 1; i < 3; i++) {
      if (fol[i] < 0) {
        let best = -1, bd = Infinity;
        for (let o = 0; o < 3; o++) { if (o === i || Math.abs(x[o] - x[i]) >= 9 + 0.9) continue; if (fol[o] >= 0 && flr[o] < 0) { const d = (x[o] - x[i]) ** 2; if (d < bd) { bd = d; best = o; } } }
        if (best < 0) for (let o = 0; o < 3; o++) { if (o === i || Math.abs(x[o] - x[i]) >= 9.9) continue; if (o === 0 && flr[o] < 0) { const d = (x[o] - x[i]) ** 2; if (d < bd) { bd = d; best = o; } } }
        if (best >= 0 && bd >= 4) { let ok = best === 0, h = best, dep = 1; while (!ok && dep <= 8 && fol[h] >= 0) { if (fol[h] === 0) ok = true; h = fol[h]; dep++; } if (ok) { fol[i] = best; flr[best] = i; cur = 2.1; counter = 0; } }
        continue;
      }
      const dx = x[fol[i]] - x[i], d2 = dx * dx;
      if (d2 > 676 && cur <= 3.0) { cur *= 1.2; counter = 40; } else if (d2 > 676 && counter === 0) { flr[fol[i]] = -1; fol[i] = -1; continue; } else if (counter > 0) counter--;
      if (Math.sqrt(d2) > 2) x[i] += Math.min(cur * 0.1, Math.sqrt(d2) - 2) * Math.sign(dx);
    }
    out.push(JSON.stringify([x.map((v) => v.toFixed(6)), fol.slice(), flr.slice(), cur, st.map((s) => [s, s, 2 + 3 * s])]));
  }
  return out;
}
const G = read('07k_goals.js'), L = read('07ze_llama.js');
function run(g, l) {
  let bad = null, follows = 0;
  for (let s = 0; s < 20 && !bad; s++) {
    const a = engine(s, g, l), b = reference(s);
    for (let t = 0; t < TICKS; t++) { if (a[t] !== b[t]) { bad = `salt ${s} tick ${t}: engine ${a[t]} != ref ${b[t]}`; break; } }
    if (JSON.parse(a[TICKS - 1])[1].some((v) => v >= 0)) follows++;
  }
  return { bad, follows };
}
let fails = 0, breaks = 0;
const base = run(G, L);
if (base.bad) { fails++; console.log('  FAIL ' + base.bad.slice(0, 600)); }
if (!base.follows) { fails++; console.log('  FAIL vacuous: no llama ever followed'); }
const mut = (name, g, l) => { const r = run(g, l); if (r.bad) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); } };
mut('caravan follow speed 2.1 -> 2.0', G.replace('FormCaravanGoal(e, 2.1)', 'FormCaravanGoal(e, 2.0)'), L);
mut('min distance 4.0 -> 1.0', G, L.replace('CARAVAN_MIN_DIST_SQ = 4.0', 'CARAVAN_MIN_DIST_SQ = 1.0'));
mut('speed ramp 1.2 -> 1.1', G, L.replace('CARAVAN_SPEED_RAMP = 1.2', 'CARAVAN_SPEED_RAMP = 1.1'));
mut('chain depth cap 8 -> 0', G, L.replace('depth > 8', 'depth > 0'));
console.log(`lockstep-caravan: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${base.follows} salts formed a caravan)`);
process.exit(fails ? 1 : 0);
