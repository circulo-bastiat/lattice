#!/usr/bin/env node
// trample.mjs — #309: FarmlandBlock.onLandedUpon through the real landing path (Ph.landed).
import { loadEngine } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '07_world.js', '07b_behaviour.js', '14b_physics.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const W = MCL.World, S = MCL.States, R = MCL.Reg, B = MCL.Behave, Ph = MCL.Physics || MCL.Ph;
const CH = MCL.CH;
W.init(1); B.init(W);
const c = W.makeChunk(0, 0); c.state = CH.GENERATED; W.chunks.set(W.key(0, 0), c);
let grief = 'true';
MCL.Commands = { ruleGet: () => grief };
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const farm = S.stateOf('farmland'), dirt = S.stateOf('dirt');
const lcg = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
function trials(mk, fall, n, seed) {
  const rnd = lcg(seed); let hits = 0;
  for (let i = 0; i < n; i++) {
    W.setBlock(8, 60, 8, farm);
    const e = Object.assign(mk(), { x: 8.5, y: 61, z: 8.5, rand: rnd });
    Ph.landed(e, fall, -0.5);
    if (S.block[W.getBlock(8, 60, 8)] === R.id.dirt) hits++;
  }
  return hits;
}
const mkPlayer = () => { const e = { type: 'player', living: true, maxHealth: 20, width: 0.6, height: 1.8 }; return e; };
const mkZombie = () => ({ type: 'zombie', living: true, maxHealth: 20, width: 0.6, height: 1.95 });
const mkChicken = () => ({ type: 'chicken', living: true, maxHealth: 4, width: 0.4, height: 0.7 });
const mkBaby = () => ({ type: 'zombie', living: true, maxHealth: 20, width: 0.3, height: 0.975 });
const mkItem = () => ({ type: 'item', living: false, width: 0.25, height: 0.25 });
function scenario() {
  const out = {};
  out.jump = trials(mkPlayer, 1.25, 200, 1);          // p = .75 per trial
  out.walk = trials(mkPlayer, 0, 200, 2);
  out.tiny = trials(mkPlayer, 0.5, 200, 3);
  out.chicken = trials(mkChicken, 3, 100, 4);
  out.baby = trials(mkBaby, 3, 100, 5);
  out.item = trials(mkItem, 3, 100, 6);
  out.zombie = trials(mkZombie, 3, 100, 7);
  grief = 'false';
  out.zombieNoGrief = trials(mkZombie, 3, 100, 8);
  out.playerNoGrief = trials(mkPlayer, 3, 100, 9);
  grief = 'true';
  return out;
}
console.log('trample — #309, FarmlandBlock.onLandedUpon');
const r = scenario();
ok(r.jump > 100 && r.jump < 190, 'jump onto farmland reverts some (' + r.jump + '/200)');
ok(r.walk === 0, 'walking (fall 0) never reverts');
ok(r.tiny === 0, 'fall 0.5 never reverts');
ok(r.chicken === 0 && r.baby === 0, 'chicken and baby never revert');
ok(r.item === 0, 'non-living never reverts');
ok(r.zombie === 100, 'zombie with mobGriefing reverts at fall 3');
ok(r.zombieNoGrief === 0, 'mobGriefing=false stops a zombie');
ok(r.playerNoGrief === 100, 'mobGriefing=false does not stop a player');
{ W.setBlock(8, 60, 8, farm); const e = Object.assign(mkPlayer(), { x: 8.5, y: 60.9, z: 8.5, rand: () => 0 }); Ph.landed(e, 3, -1); ok(e.y >= 61, 'lander pushed up out of the cell'); }

function caught(name, patch, undo) {
  patch(); const rr = scenario(); undo();
  const bad = rr.walk > 0 || rr.chicken > 0 || rr.baby > 0 || rr.zombieNoGrief > 0 || rr.tiny > 0;
  if (bad) { breaks++; console.log('  ✓ caught: ' + name); } else fails.push('break not caught: ' + name);
}
const orig = B.farmlandTrample;
caught('fall-distance term removed', () => { B.farmlandTrample = (e, x, y, z, d, r) => orig(e, x, y, z, 100, r); }, () => { B.farmlandTrample = orig; });
caught('size term removed', () => { B.farmlandTrample = (e, x, y, z, d, r) => orig(Object.assign({}, e, { width: 1, height: 1 }), x, y, z, d, r); }, () => { B.farmlandTrample = orig; });
caught('mobGriefing ignored', () => { B.farmlandTrample = (e, x, y, z, d, r) => orig(Object.assign({}, e, { type: 'player' }), x, y, z, d, r); }, () => { B.farmlandTrample = orig; });

console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
