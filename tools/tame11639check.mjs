#!/usr/bin/env node
// tame11639check.mjs — #11639: proves 07n_tame.js's MooshroomEntityRenderer skin picker and LeadItem.attachHeldMobsToBlock + reachability, SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07n_tame.js'], dom: false, patch: patch ? (f, s) => (f === '07n_tame.js' ? patch(s) : s) : undefined });
  const Tm = MCL.Tame, o = {};
  o.red = Tm.skinKey({ type: 'mooshroom', mooshroomType: 'red' }) === null && Tm.skinKey({ type: 'mooshroom' }) === null;
  o.brown = Tm.skinKey({ type: 'mooshroom', mooshroomType: 'brown' }) === 'mooshroom_brown';
  const mk = (x, y, z, h) => ({ x, y, z, removed: false, leashHolder: h });
  const P = () => ({ kind: 'player' });
  const near = mk(12, 64, 10, P()), far = mk(30, 64, 10, P()), other = mk(10, 64, 10, null);
  const high = mk(10, 80, 10, P()), edge = mk(17, 64, 10, P()), past = mk(17.5, 64, 10, P());
  MCL.EntityList = { ready: true, list: [near, far, other, edge, past, high] };
  const any = Tm.attachHeldMobsToBlock(10, 64, 10);
  o.moved = any === true && near.leashHolder.kind === 'knot' && edge.leashHolder.kind === 'knot';
  o.shared = near.leashHolder.knot === edge.leashHolder.knot && Tm.knots.length === 1;
  o.skip = high.leashHolder.kind === 'player' && far.leashHolder.kind === 'player' && past.leashHolder.kind === 'player' && other.leashHolder === null;
  o.knotpos = near.leashHolder.knot.x === 10.5 && near.leashHolder.knot.y === 64.375;
  MCL.EntityList = { ready: true, list: [mk(10, 64, 10, P())] };
  const again = Tm.attachHeldMobsToBlock(10, 64, 10);
  o.reuse = again === true && Tm.knots.length === 1;
  MCL.EntityList = { ready: true, list: [mk(10, 64, 10, null)] };
  o.none = Tm.attachHeldMobsToBlock(10, 64, 10) === false;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/TmL\.attachHeldMobsToBlock\(x, y, z\)/.test(rd('14l_use.js')), 'reach: useOnBlock lead calls attachHeldMobsToBlock');
ok(/Tm\.skinKey\(e\)/.test(rd('07j_entityrender.js')), 'reach: renderer uses Tame.skinKey');
const BR = [
  ['brown', "e.mooshroomType === 'brown' ? 'mooshroom_brown' : null", "null", ['brown']],
  ['red', "'mooshroom_brown' : null", "'mooshroom_brown' : 'mooshroom'", ['red']],
  ['radius', 'Tm.FENCE_RADIUS = 7;', 'Tm.FENCE_RADIUS = 5;', ['moved']],
  ['radius2', 'Tm.FENCE_RADIUS = 7;', 'Tm.FENCE_RADIUS = 9;', ['skip']],
  ['player', 'if (e.removed || !Tm.holderIsPlayer(e)) continue;\n      // `new Box', 'if (e.removed) continue;\n      // `new Box', ['skip']],
  ['yaxis', '|| Math.abs(e.y - by) > R || Math.abs(e.z - bz) > R) continue;\n      if (!knot)', '|| Math.abs(e.z - bz) > R) continue;\n      if (!knot)', ['skip']],
  ['assign', "e.leashHolder = { kind: 'knot', knot: knot };\n      any = true;\n    }\n    return any;", "any = true;\n    }\n    return any;", ['moved']],
  ['ret', 'return any;\n  };\n\n  /** `LeashKnotEntity.interact`', 'return true;\n  };\n\n  /** `LeashKnotEntity.interact`', ['none']],
  ['reuse', 'k.bx === bx && k.by === by && k.bz === bz) return k;', 'false) return k;', ['reuse']],
  ['kpos', 'x: bx + 0.5, y: by + 0.375', 'x: bx, y: by + 0.375', ['knotpos']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`tame11639check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
