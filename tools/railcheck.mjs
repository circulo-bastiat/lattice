#!/usr/bin/env node
// railcheck.mjs — #306 (G25): rail shapes against .decomp's AbstractRailBlock / RailPlacementHelper /
// RailBlock / PoweredRailBlock / DetectorRailBlock.
//
//   1. A table of layouts (straight, corner, T-junction, slope, straight-only rails refusing a curve,
//      a straight rail placed INTO a corner) is built in the engine (Behave + Rail through a world whose
//      setBlock calls Behave.changed with the replaced state, as World.setBlock does) and in an
//      independent re-derivation of RailPlacementHelper written here from the Java; both must agree
//      cell for cell, and the named cells must equal the shapes pinned by hand from the Java.
//   2. The powered T-junction: a lever beside a three-way rail flips it south_west / south_east.
//   3. shouldDropRail: a slope whose raised side loses its rim drops; its upper rail leaving does not.
//   4. rotate/mirror: every (rotation|mirror, shape) of all three Java classes, switch fall-through
//      included, parsed from the .decomp source and compared with Rail.rotateShape/mirrorShape.
// Anti-vacuity: the re-derivation with the curve rule broken, with the ascending rule broken and with
// the power order swapped must each disagree with the engine; the drop rule and the parsed tables are
// broken likewise ('<n> breaks caught').
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ break caught: ' + m); else fails.push('anti-vacuity: ' + m); };

console.log('railcheck — #306 (G25), rail shapes: RailPlacementHelper, shouldDropRail, T-junction power, rotate/mirror');
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js'], dom: false });
const R = M.Reg, S = M.States, B = M.Behave, Rail = M.Rail;

// ── the engine's world: a box whose setBlock is World.setBlock's shape (old state -> Behave.changed)
const N = 24, MID = 12;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const world = {
  getBlock: (x, y, z) => cells[idx(x, y, z)],
  setBlock(x, y, z, id) { const old = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, old); return true; },
  blockLightAt: () => 15,
};
B.init(world);
M.Redstone.init();
ok(B.ready && M.Redstone.ready && Rail && Rail.ready, 'Behave, Redstone and Rail are ready');
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
const STONE = def('stone');
const FLOOR = () => { cells.fill(0); for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) cells[idx(x, -1, z)] = STONE; };

// ── the re-derivation, from the Java, over a string world ─────────────────────────────────
// cell: undefined (air) | 'stone' | {k: blockName, sh: shapeName}
function RefWorld(o) {
  const opt = Object.assign({ curves: true, ascend: true, powOrder: true }, o || {});
  const m = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const get = (x, y, z) => m.get(key(x, y, z));
  const isRail = (c) => c && typeof c === 'object';
  const railAt = (p) => isRail(get(...p));
  const set = (p, c) => { if (c === undefined) m.delete(key(...p)); else m.set(key(...p), c); };
  const forbid = (k) => k !== 'rail';
  const off = (p, dx, dy, dz) => [p[0] + dx, p[1] + dy, p[2] + dz];
  const north = (p) => off(p, 0, 0, -1), south = (p) => off(p, 0, 0, 1), west = (p) => off(p, -1, 0, 0), east = (p) => off(p, 1, 0, 0), up = (p) => off(p, 0, 1, 0), down = (p) => off(p, 0, -1, 0);
  class Helper {
    constructor(pos, c) { this.pos = pos; this.c = c; this.nb = []; this.compute(c.sh); }
    compute(sh) {
      const p = this.pos;
      this.nb = ({
        north_south: [north(p), south(p)], east_west: [west(p), east(p)],
        ascending_east: [west(p), up(east(p))], ascending_west: [up(west(p)), east(p)],
        ascending_north: [up(north(p)), south(p)], ascending_south: [north(p), up(south(p))],
        south_east: [east(p), south(p)], south_west: [west(p), south(p)],
        north_west: [west(p), north(p)], north_east: [east(p), north(p)],
      })[sh];
    }
    static at(p) {
      for (const q of [p, up(p), down(p)]) if (railAt(q)) return new Helper(q, get(...q));
      return null;
    }
    isNb(q) { return this.nb.some((n) => n[0] === q[0] && n[2] === q[2]); }
    refresh() { this.nb = this.nb.filter((n) => { const h = Helper.at(n); return h && h.isNb(this.pos); }).map((n) => Helper.at(n).pos); }
    canTake(o) { return this.isNb(o.pos) || this.nb.length !== 2; }
    canConnect(q) { const h = Helper.at(q); if (!h) return false; h.refresh(); return h.canTake(this); }
    ascend(sh) {
      const p = this.pos;
      if (!opt.ascend) return sh;
      if (sh === 'north_south') { if (railAt(up(north(p)))) sh = 'ascending_north'; if (railAt(up(south(p)))) sh = 'ascending_south'; }
      else if (sh === 'east_west') { if (railAt(up(east(p)))) sh = 'ascending_east'; if (railAt(up(west(p)))) sh = 'ascending_west'; }
      return sh;
    }
    take(o) {
      this.nb.push(o.pos);
      const p = this.pos, n = this.isNb(north(p)), s = this.isNb(south(p)), w = this.isNb(west(p)), e = this.isNb(east(p));
      let sh = null;
      if (n || s) sh = 'north_south';
      if (w || e) sh = 'east_west';
      if (!forbid(this.c.k) || !opt.curves) {
        if (s && e && !n && !w) sh = 'south_east';
        if (s && w && !n && !e) sh = 'south_west';
        if (n && w && !s && !e) sh = 'north_west';
        if (n && e && !s && !w) sh = 'north_east';
      }
      sh = this.ascend(sh) || 'north_south';
      this.c = { k: this.c.k, sh }; set(p, this.c);
    }
    update(pow, force) {
      const p = this.pos, n = this.canConnect(north(p)), s = this.canConnect(south(p)), w = this.canConnect(west(p)), e = this.canConnect(east(p));
      let sh = null;
      const ns = n || s, ew = w || e;
      if (ns && !ew) sh = 'north_south';
      if (ew && !ns) sh = 'east_west';
      const se = s && e, sw = s && w, ne = n && e, nw = n && w;
      const curves = !forbid(this.c.k) || !opt.curves;
      if (curves) {
        if (se && !n && !w) sh = 'south_east';
        if (sw && !n && !e) sh = 'south_west';
        if (nw && !s && !e) sh = 'north_west';
        if (ne && !s && !w) sh = 'north_east';
      }
      if (sh === null) {
        if (ns && ew) sh = this.c.sh; else if (ns) sh = 'north_south'; else if (ew) sh = 'east_west';
        if (curves) {
          const order = (pow === opt.powOrder) ? [[se, 'south_east'], [sw, 'south_west'], [ne, 'north_east'], [nw, 'north_west']]
            : [[nw, 'north_west'], [ne, 'north_east'], [sw, 'south_west'], [se, 'south_east']];
          for (const [c, v] of order) if (c) sh = v;
        }
      }
      sh = this.ascend(sh) || this.c.sh;
      this.compute(sh);
      const was = get(...p);
      this.c = { k: this.c.k, sh };
      if (force || was.sh !== sh) {
        set(p, this.c);
        for (const q of this.nb) { const h = Helper.at(q); if (h) { h.refresh(); if (h.canTake(this)) h.take(this); } }
      }
    }
  }
  return {
    get, set,
    place(k, p, facing) { set(p, { k, sh: facing === 'ew' ? 'east_west' : 'north_south' }); new Helper(p, get(...p)).update(false, true); },
    reshape(p, pow) { new Helper(p, get(...p)).update(pow, false); },
  };
}

// ── the layouts ───────────────────────────────────────────────────────────────────────────
// op: [block, x, y, z, facing?]. 'stone' / 'air' are plain writes. `want` pins cells by hand from the Java.
const LAYOUTS = [
  { name: 'straight line, both placed facing east', ops: [['rail', 0, 0, 0, 'ew'], ['rail', 0, 0, 1, 'ew']],
    want: { '0,0,0': 'north_south', '0,0,1': 'north_south' } },
  { name: 'corner (rail curves)', ops: [['rail', 0, 0, 0, 'ns'], ['rail', 1, 0, 0, 'ns'], ['rail', 0, 0, 1, 'ew']],
    want: { '0,0,0': 'south_east', '1,0,0': 'east_west', '0,0,1': 'north_south' } },
  { name: 'T-junction: the third rail keeps its own facing', ops: [['rail', 0, 0, 0, 'ns'], ['rail', 1, 0, 0, 'ns'], ['rail', -1, 0, 0, 'ns'], ['rail', 0, 0, 1, 'ew']],
    want: { '0,0,0': 'east_west', '1,0,0': 'east_west', '-1,0,0': 'east_west', '0,0,1': 'east_west' } },
  { name: 'T-junction closed by a corner first', ops: [['rail', 0, 0, 0, 'ns'], ['rail', 0, 0, 1, 'ns'], ['rail', 1, 0, 0, 'ns'], ['rail', -1, 0, 0, 'ns']],
    want: { '0,0,0': 'south_east', '-1,0,0': 'north_south' } },
  { name: 'slope up a block', ops: [['stone', 1, 0, 0], ['rail', 0, 0, 0, 'ns'], ['rail', 1, 1, 0, 'ns']],
    want: { '0,0,0': 'ascending_east', '1,1,0': 'east_west' } },
  { name: 'slope down to the north', ops: [['stone', 0, 0, -1], ['rail', 0, 1, -1, 'ew'], ['rail', 0, 0, 0, 'ew']],
    want: { '0,0,0': 'ascending_north', '0,1,-1': 'north_south' } },
  { name: 'corner turned by a slope', ops: [['stone', 0, 0, 1], ['rail', 0, 0, 0, 'ns'], ['rail', 1, 0, 0, 'ns'], ['rail', 0, 1, 1, 'ew']],
    want: { '0,0,0': 'south_east', '0,1,1': 'north_south' } },
  ...['powered_rail', 'detector_rail', 'activator_rail'].map((k) => ({
    name: k + ' refuses the corner', ops: [[k, 0, 0, 0, 'ns'], ['rail', 1, 0, 0, 'ns'], ['rail', 0, 0, 1, 'ew']],
    want: { '0,0,0': 'east_west', '0,0,1': 'north_south' } })),
  { name: 'powered_rail placed into a corner keeps its facing (ns)', ops: [['rail', 1, 0, 0, 'ew'], ['rail', 0, 0, 1, 'ns'], ['powered_rail', 0, 0, 0, 'ns']],
    want: { '0,0,0': 'north_south', '0,0,1': 'north_south', '1,0,0': 'east_west' } },
  { name: 'powered_rail placed into a corner keeps its facing (ew)', ops: [['rail', 1, 0, 0, 'ns'], ['rail', 0, 0, 1, 'ns'], ['powered_rail', 0, 0, 0, 'ew']],
    want: { '0,0,0': 'east_west', '1,0,0': 'east_west', '0,0,1': 'north_south' } },
  { name: 'powered_rail climbs a slope', ops: [['stone', 1, 0, 0], ['powered_rail', 0, 0, 0, 'ns'], ['powered_rail', 1, 1, 0, 'ns']],
    want: { '0,0,0': 'ascending_east', '1,1,0': 'east_west' } },
  { name: 'a loop of four corners', ops: [['rail', 0, 0, 0, 'ns'], ['rail', 1, 0, 0, 'ns'], ['rail', 1, 0, 1, 'ns'], ['rail', 0, 0, 1, 'ns']],
    want: { '0,0,0': 'south_east', '1,0,1': 'north_west' } },
];
const SPAN = [];
for (let x = -3; x <= 3; x++) for (let y = 0; y <= 2; y++) for (let z = -3; z <= 3; z++) SPAN.push([x, y, z]);

function runEngine(ops) {
  FLOOR();
  for (const [k, x, y, z, f] of ops) {
    if (k === 'stone') { world.setBlock(x, y, z, STONE); continue; }
    if (k === 'air') { world.setBlock(x, y, z, 0); continue; }
    const st = B.place(B.setProp(def(k), 'shape', f === 'ew' ? 'east_west' : 'north_south'), x, y, z);
    world.setBlock(x, y, z, st);
  }
  const out = {};
  for (const p of SPAN) { const st = world.getBlock(...p); if (Rail.isRail(st)) out[p.join(',')] = R.names[S.block[st]] + ':' + B.propName(st, 'shape'); }
  return out;
}
function runRef(ops, opt) {
  const W = RefWorld(opt);
  for (const [k, x, y, z, f] of ops) {
    if (k === 'stone') W.set([x, y, z], 'stone'); else if (k === 'air') W.set([x, y, z], undefined); else W.place(k, [x, y, z], f);
  }
  const out = {};
  for (const p of SPAN) { const c = W.get(...p); if (c && typeof c === 'object') out[p.join(',')] = c.k + ':' + c.sh; }
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shapeOnly = (o, k) => (o[k] || '').split(':')[1];

console.log('1. layouts: engine vs the re-derivation vs the pinned shapes');
const engineOut = LAYOUTS.map((L) => runEngine(L.ops));
LAYOUTS.forEach((L, i) => {
  const ref = runRef(L.ops);
  ok(same(engineOut[i], ref), `${L.name}: engine ${JSON.stringify(engineOut[i])} != re-derivation ${JSON.stringify(ref)}`);
  for (const k in L.want) ok(shapeOnly(engineOut[i], k) === L.want[k], `${L.name}: ${k} is ${shapeOnly(engineOut[i], k)}, pinned ${L.want[k]}`);
});
console.log(`   ${LAYOUTS.length} layouts`);

console.log('2. the powered T-junction (RailBlock.updateBlockState: a signal source beside three rails)');
const TEE = [['rail', 0, 0, 0, 'ns'], ['rail', 1, 0, 0, 'ns'], ['rail', -1, 0, 0, 'ns'], ['rail', 0, 0, 1, 'ew']];
function junction() {
  runEngine(TEE);
  const lever = B.setProp(B.setProp(def('lever'), 'face', 'floor'), 'powered', 'false');
  world.setBlock(0, 0, -1, lever);
  const seen = [B.propName(world.getBlock(0, 0, 0), 'shape')];
  M.Redstone.setPowered(0, 0, -1, true); seen.push(B.propName(world.getBlock(0, 0, 0), 'shape'));
  M.Redstone.setPowered(0, 0, -1, false); seen.push(B.propName(world.getBlock(0, 0, 0), 'shape'));
  return seen;
}
function refJunction(opt) {
  const W = RefWorld(opt);
  for (const [k, x, y, z, f] of TEE) W.place(k, [x, y, z], f);
  const seen = [W.get(0, 0, 0).sh];
  W.reshape([0, 0, 0], true); seen.push(W.get(0, 0, 0).sh);
  W.reshape([0, 0, 0], false); seen.push(W.get(0, 0, 0).sh);
  return seen;
}
const jSeen = junction();
ok(same(jSeen, ['east_west', 'south_west', 'south_east']), `lever off/on/off: ${jSeen} (want east_west, south_west, south_east)`);
ok(same(jSeen, refJunction()), `junction ${jSeen} != re-derivation ${refJunction()}`);

console.log('3. shouldDropRail: the raised side of a slope');
const SLOPE = [['stone', 1, 0, 0], ['rail', 0, 0, 0, 'ns'], ['rail', 1, 1, 0, 'ns']];
function dropRun() {
  runEngine(SLOPE);
  world.setBlock(1, 1, 0, 0);                                   // the upper rail leaves: no reshape
  const kept = B.propName(world.getBlock(0, 0, 0), 'shape');
  world.setBlock(1, 0, 0, 0);                                   // the rim on the raised side goes
  return [kept, world.getBlock(0, 0, 0)];
}
const [kept, after] = dropRun();
ok(kept === 'ascending_east', `upper rail removed: lower rail is ${kept}, vanilla keeps ascending_east`);
ok(after === 0, 'the raised side losing its rim drops the ascending rail');
ok(!Rail.shouldDrop(0, 0, 0, 0) && Rail.shouldDrop(0, 5, 0, 0), 'a flat rail drops only for its own floor');

console.log('4. rotate / mirror parsed from the Java (switch fall-through included)');
const SH = Rail.SHAPES;
const ENUM = {}; for (const [, f, n] of readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/block/enums/RailShape.java'), 'utf8').matchAll(/(field_\d+)\("(\w+)"\)/g)) ENUM[f] = n;
const ROTF = ['field_11467', 'field_11463', 'field_11464', 'field_11465'], MIRF = ['field_11302', 'field_11300', 'field_11301'];
// method body -> [{labels, arms:[{labels, ret}]}]; ret: shape name | 'super' | 'same' | null (no return: break)
function parseSwitch(src, method) {
  const at = src.indexOf('public BlockState ' + method + '(');
  const lines = src.slice(at).split('\n');
  const outer = []; let depth = 1, cur = null, arm = null;
  for (const l of lines.slice(1)) {
    const t = l.trim(), d0 = depth;                     // d0: 1 method body, 2 outer cases, 3 inner arms
    depth += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
    if (depth <= 0) break;
    const cm = t.match(/^case (field_\d+):$/);
    if (d0 === 2 && (cm || t === 'default:')) { cur = { labels: [cm ? cm[1] : 'default'], arms: [] }; outer.push(cur); arm = null; continue; }
    if (d0 === 2 && /^return \$\$0;$/.test(t) && cur) { cur.ret = 'same'; continue; }
    if (d0 !== 3) continue;
    if (cm || t === 'default:') { if (!arm || arm.ret !== undefined) { arm = { labels: [], ret: undefined }; cur.arms.push(arm); } arm.labels.push(cm ? cm[1] : 'default'); continue; }
    const rm = t.match(/^return \$\$0\.with\(SHAPE, RailShape\.(field_\d+)\);$/);
    if (rm && arm) arm.ret = ENUM[rm[1]];
    else if (/^return super\.mirror/.test(t) && arm) arm.ret = 'same';
    else if (t === 'break;' && arm) arm.ret = null;
  }
  const tail = 'same';                                  // after the switch: `return super.mirror` / the state
  return { outer, tail };
}
// run a (value, shape) through the parsed switch with Java's fall-through
function evalSwitch(P, val, shape, noFall) {
  let i = P.outer.findIndex((c) => c.labels.includes(val));
  if (i < 0) i = P.outer.findIndex((c) => c.labels.includes('default'));
  for (; i >= 0 && i < P.outer.length; i++) {
    const c = P.outer[i];
    if (c.ret) return shape;
    let a = c.arms.find((x) => x.labels.some((f) => ENUM[f] === shape));
    if (!a) a = c.arms.find((x) => x.labels.includes('default'));
    if (a && a.ret) return a.ret === 'same' ? shape : a.ret;
    if (noFall) return shape;
  }
  return shape;
}
const FILES = ['RailBlock', 'PoweredRailBlock', 'DetectorRailBlock'];
const parsed = FILES.map((f) => { const src = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/block', f + '.java'), 'utf8'); return { f, rot: parseSwitch(src, 'rotate'), mir: parseSwitch(src, 'mirror') }; });
function tablesAgree(noFall) {
  let bad = [];
  for (const p of parsed) {
    const shapes = p.f === 'RailBlock' ? SH : SH.slice(0, 6);
    for (let r = 0; r < 4; r++) for (const s of shapes) {
      const want = evalSwitch(p.rot, ROTF[r], s, noFall), got = SH[Rail.rotateShape(SH.indexOf(s), r)];
      if (want !== got) bad.push(`${p.f}.rotate(${r}, ${s}) java ${want} engine ${got}`);
    }
    for (let m = 0; m < 3; m++) for (const s of shapes) {
      const want = evalSwitch(p.mir, MIRF[m], s, noFall), got = SH[Rail.mirrorShape(SH.indexOf(s), m)];
      if (want !== got) bad.push(`${p.f}.mirror(${m}, ${s}) java ${want} engine ${got}`);
    }
  }
  return bad;
}
ok(parsed.every((p) => p.rot.outer.length >= 3 && p.mir.outer.length >= 2), 'the three rotate/mirror switches parsed');
const bad = tablesAgree(false);
ok(bad.length === 0, 'rotate/mirror: ' + bad.slice(0, 4).join('; '));
ok(SH[Rail.rotateShape(0, 2)] === 'east_west', 'CLOCKWISE_180 of north_south falls through to east_west (vanilla)');
// the engine rotate/mirror on real states
const nsRail = B.setProp(def('rail'), 'shape', 'north_east');
ok(B.propName(Rail.rotate(nsRail, 1), 'shape') === 'south_east' && B.propName(Rail.mirror(nsRail, 2), 'shape') === 'north_west', 'Rail.rotate/mirror on a state');

// ── anti-vacuity ──────────────────────────────────────────────────────────────────────────
const disagrees = (opt) => LAYOUTS.some((L, i) => !same(engineOut[i], runRef(L.ops, opt)));
okAv(disagrees({ curves: false }), 'curve rule broken (straight-only rails allowed to curve) is seen');
okAv(disagrees({ ascend: false }), 'ascending rule broken (no slopes) is seen');
okAv(!same(jSeen, refJunction({ powOrder: false })), 'powered junction order swapped is seen');
{
  const real = Rail.shouldDrop;
  Rail.shouldDrop = (x, y, z) => real(x, y, z, 0);             // forget the raised side
  const [, after2] = dropRun();
  Rail.shouldDrop = real;
  okAv(after2 !== 0, 'drop rule without the raised-side rim is seen');
}
okAv(tablesAgree(true).length > 0, 'rotate without the CLOCKWISE_180 fall-through is seen');
okAv(!LAYOUTS.every((L, i) => shapeOnly(engineOut[i], '0,0,0') === (L.name.startsWith('powered_rail refuses') ? 'south_east' : shapeOnly(engineOut[i], '0,0,0'))), 'pinned table claiming powered_rail curves is refused');

if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`railcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
