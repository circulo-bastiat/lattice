#!/usr/bin/env node
// entitycollidecheck.mjs -- #5346: boats and minecarts are solid to other entities (isCollidable box feed
// into the movement sweep, Ph.clipE). A player lands on a boat, is stopped by a cart's side, and is not
// blocked by the boat it rides (isConnectedThroughVehicle).
import { loadEngine, initRegistry } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
import { readFileSync } from 'node:fs';
const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(new URL('../assets/entities.json', import.meta.url), 'utf8')) });
M.Entities.init(); M.EntityList.init();
const W = M.World, CH = M.CH, STONE = M.States.stateOf('stone') | 0;
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 8, z, STONE);
const F = 9;   // floor top
const Ph = M.Physics, EL = M.EntityList;
const dim = (t) => M.Entities.dimensions(t);

function scenario(type, mode) {
  EL.list = [];
  const o = { type, x: 0.5, y: F, z: 0.5, dead: false, removed: false };
  EL.list.push(o);
  const p = { type: 'player', x: 0.5, y: F + 6, z: 0.5, vx: 0, vy: 0, vz: 0, onGround: false };
  const pd = dim('player'); p.width = pd.width; p.height = pd.height;
  if (mode === 'ride') { p.vehicle = o; }
  if (mode === 'walk') { p.x = -2; p.y = F; p.z = 0.5; p.onGround = true; }
  return { o, p };
}
function drop(type, mode) {
  const { o, p } = scenario(type, mode);
  for (let i = 0; i < 40; i++) Ph.move(p, 0, -0.5, 0);
  return { o, p };
}
function walk(type, mode) {
  const { o, p } = scenario(type, 'walk');
  for (let i = 0; i < 20; i++) Ph.move(p, 0.2, 0, 0);
  return { o, p };
}
function run() {
  for (const t of ['boat', 'minecart', 'chest_minecart']) {
    const h = dim(t).height;
    const a = drop(t);
    ok(Math.abs(a.p.y - (F + h)) < 1e-6, t + ': player lands at y+height (got ' + a.p.y + ')');
    const w = walk(t);
    if (dim(t).height > 0.6) ok(w.p.x < 0.5 - dim(t).width / 2, t + ': walking player is stopped by the side (x=' + w.p.x + ')');
    else ok(true, 'boat: step-up not asserted');
    const r = drop(t, 'ride');
    ok(r.p.y < F + 1e-6, t + ': rider is not blocked by own vehicle (y=' + r.p.y + ')');
  }
}
run();
const orig = Ph.solidVehicle, origC = Ph.connectedThroughVehicle;
const counts = () => { const b = pass, f = fails.length; run(); return fails.length > f; };
function caught(m, thunk) { breaks++; const f0 = fails.length, p0 = pass; thunk(); const hit = fails.length > f0; fails.length = f0; pass = p0; ok(hit, 'anti-vacuity: ' + m);  }
caught('filter off (nothing solid)', () => { Ph.solidVehicle = () => false; run(); Ph.solidVehicle = orig; });
caught('own-vehicle exclusion off', () => { Ph.connectedThroughVehicle = () => false; run(); Ph.connectedThroughVehicle = origC; });
console.log('entitycollidecheck: ' + pass + ' checks, ' + breaks + ' breaks caught' + (fails.length ? '\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
