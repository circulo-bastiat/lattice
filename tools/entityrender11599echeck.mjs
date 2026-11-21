#!/usr/bin/env node
// entityrender11599echeck.mjs — #11599 (AUDIT-MAP) part 5: ConduitBlockEntityRenderer parts + BeaconBlockEntityRenderer beam, 
// crop (orbUV) and colour pulse (orbColorAt) driven through their real entry points, then re-run against source mutants:
// every cut must be noticed.
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry } from './loadsrc.mjs';
const A = new URL('../assets/', import.meta.url).pathname;

const near = (a, b) => Math.abs(a - b) < 1e-9;
let N = 0;
function run(patch) {
  const M = loadEngine({ extra: ['02g_items.js', '07c_blockentity.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '15h_bemodel.js', '07j_entityrender.js'], dom: false,
    ...(patch ? { patch: (f, t) => (f === '07j_entityrender.js' ? patch(t) : t) } : {}) });
  initRegistry(M);
  const ER = M.EntityRender, f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    ER.init();
  M.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes });
    M.BEModel.init({ models: readFileSync(A + 'models.bin').toString('base64'), modelsBytes: JSON.parse(readFileSync(A + 'models.meta.json', 'utf8')).rawBytes });
    const e0 = { ticks: 70, ticksActive: 10, active: true, eyeOpen: true, x: 0, y: 0, z: 0 };
    const idle = ER.conduitParts({ ticksActive: 4 }, 0);
    ok(idle.length === 1 && idle[0].key === 'base' && Math.abs(idle[0].m[0] - Math.cos(0.15)) < 1e-6 && idle[0].m[2] < 0 && Math.abs(Math.abs(idle[0].m[2]) - Math.sin(0.15)) < 1e-6, 'Conduit inactive base shell');
    const P = ER.conduitParts(e0, 0.5, { yaw: 0, pitch: 0 });
    ok(P.map((q) => q.key).join() === 'cage,wind,wind2,eye', 'Conduit active part list');
    const sn = Math.sin(70.5 * 0.1) / 2 + 0.5, by = 0.3 + (sn * sn + sn) * 0.2;
    ok(Math.abs(P[0].o[1] - by) < 1e-6 && Math.abs(P[3].o[1] - by) < 1e-6 && P[1].o[1] === 0.5, 'Conduit cage bob');
    ok(P[1].texKey === 'conduit_wind#1' && ER.conduitParts({ ...e0, ticks: 0 }, 0)[1].texKey === null && ER.conduitParts({ ...e0, ticks: 130 }, 0)[1].texKey === 'conduit_wind#1' && ER.conduitParts({ ...e0, ticks: 140 }, 0)[1].m[1] !== 0 && Math.abs(ER.conduitParts({ ...e0, ticks: 140 }, 0)[1].m[1] + 1) < 1e-9, 'Conduit wind phase ticks/66%3');
    ok(near(Math.abs(P[2].m[0]), 0.875) && Math.abs(Math.abs(P[3].m[0]) - 0.5 * 1.3333334) < 1e-6 && P[3].texKey === null && ER.conduitParts({ ...e0, eyeOpen: false }, 0)[3].texKey === 'conduit_eye#1', 'Conduit wind2 scale / eye');
    const tilt = ER.conduitParts({ ...e0, ticksActive: 0 }, 0)[0].m, tilt2 = ER.conduitParts({ ...e0, ticksActive: 20 }, 0)[0].m;
    ok(near(tilt[0], 1) && Math.abs(tilt2[0] - 1) > 0.01, 'Conduit cage rotation uses ticksActive');
    const V = ER.beaconBeamVerts([[1, 0, 0, 5], [0, 1, 0, 3]], 100, 0.5);
    const w = Math.fround(Math.fround(20.5 * 2.25) - 45) * Math.PI / 180;
    ok(V.length === 64 && V[0][3] === 1 && V[32][4] === 1 && Math.max(...V.slice(0, 32).map((v) => v[1])) === 5 && Math.max(...V.map((v) => v[1])) === 1029 && V[0][6] === 1 && V[16][6] === 0.125, 'Beacon beam segments/alpha');
    ok(Math.abs(V[0][0] - (0.5 + 0.2 * Math.sin(w))) < 1e-6 && Math.abs(V[0][2] - (0.5 + 0.2 * Math.cos(w))) < 1e-6, 'Beacon inner spin');
    ok(Math.abs(V[16][0] - 0.25) < 1e-6 && Math.abs(V[16][2] - 0.25) < 1e-6, 'Beacon outer prism radius');
    const R = M.Reg, SR = M.States, ap = M.Items.index['apple'];
    const cf = (face, items) => ER.campfireItems({ x: 10, y: 64, z: 20, items }, SR.withProp(SR.stateOf('campfire'), R.PROP.facing, R.PVAL[face]));
    const C = cf('east', [{ i: ap, n: 1 }, null, { i: ap, n: 1 }, { i: ap, n: 0 }]);
    ok(C.length === 2 && C[0].campfireSlot === 0 && C[1].campfireSlot === 2, 'Campfire skips empty slots');
    ok(near(C[0].x, 10.234375) && near(C[0].z, 20.8125) && near(C[1].x, 10.765625) && near(C[1].z, 20.1875) && near(C[0].y, 64.44921875), 'Campfire slot offsets (facing east)');
    const Cn = cf('north', [{ i: ap, n: 1 }]);
    ok(near(Cn[0].x, 10.8125) && near(Math.abs(Cn[0].m[0]), 0.1875), 'Campfire facing rotates slot / scale');
    const mk = (z) => ({ x: 0, y: 0, z: 0, bticks: 0, nextPageTurningSpeed: 0, pageTurningSpeed: 0, nextPageAngle: 0, pageAngle: 0, fl2: 0, fl3: 0, fl4: 0, fl7: 0, fl9: 0, bookRnd: { k: 0, nextInt() { return (this.k++ % 2) ? 0 : z; } } });
    const bt = mk(1); ER.bookTick(bt, { x: 5, z: 0.5 });
    ok(near(bt.nextPageTurningSpeed, 0.1) && bt.bticks === 1 && near(bt.fl2, Math.atan2(0, 4.5)) && near(bt.fl4, 0), 'Book tick: player near opens + faces');
    const bf = mk(1); bf.nextPageTurningSpeed = 0.5; ER.bookTick(bf, null);
    ok(near(bf.nextPageTurningSpeed, 0.4) && near(bf.fl2, 0.02), 'Book tick: no player closes + drifts');
    const bc = mk(1); bc.nextPageTurningSpeed = 0.95; ER.bookTick(bc, { x: 5, z: 0.5 });
    ok(bc.nextPageTurningSpeed === 1 && bc.fl9 === 0, 'Book tick: speed clamp, no page change when rnd nonzero');
    const bp = mk(0); let q = 0; bp.bookRnd.nextInt = () => (q++ % 2 ? 0 : 3); ER.bookTick(bp, { x: 5, z: 0.5 });
    ok(bp.fl9 === 3 && near(bp.fl7, 0.2 * 0.9) && near(bp.nextPageAngle, 0.18), 'Book tick: page target + clamp 0.2');
    const lp = (face, hb) => { let st = SR.withProp(SR.stateOf('lectern'), R.PROP.facing, R.PVAL[face]); st = SR.withProp(st, R.PROP.has_book, R.PVAL[hb]); return ER.bookItem({ x: 0, y: 0, z: 0 }, st, 'lectern', 0); };
    ok(lp('north', 'false') === null, 'Lectern without book draws nothing');
    const L1 = lp('north', 'true'), L2 = lp('east', 'true');
    ok(L1 !== null && L2 !== null && JSON.stringify(L1) !== JSON.stringify(L2) && JSON.stringify(L1) !== JSON.stringify(lp('south', 'true')) && JSON.stringify(L1) !== JSON.stringify(lp('west', 'true')) && JSON.stringify(L1) === JSON.stringify(ER.bookItem({ x: 0, y: 0, z: 0 }, SR.withProp(SR.withProp(SR.stateOf('lectern'), R.PROP.facing, R.PVAL.north), R.PROP.has_book, R.PVAL['true']), 'lectern', 0)), 'Lectern pose depends on facing');
    let cur = 0; M.World = M.World || {}; M.World.getBlock = () => cur;
    const sg = (name, props) => { let st = SR.stateOf(name); for (const [k, v] of props) st = SR.withProp(st, R.PROP[k], R.PVAL[v]); cur = st; return ER.beWorldItem({ type: 'sign', x: 3, y: 70, z: 5 }, 0); };
    const S0 = sg('oak_sign', [['rotation', '0']]), S4 = sg('oak_sign', [['rotation', '4']]), Sb = sg('birch_sign', [['rotation', '0']]);
    ok(S0 && S0.layer === 'sign' && S0.texKey === null && Sb.texKey === 'sign#2' && S0.hide === null && near(S0.scale.sxz, 0.6666667) && near(S0.raw[0], 3.5) && near(S0.raw[1], 70.5), 'Sign standing: wood sheet, no hide, centred');
    ok(near(S0.yaw, -Math.PI) && near(S4.yaw, -(-4 * 22.5 * Math.PI / 180 + Math.PI)), 'Sign standing yaw = rotation*22.5');
    const Wn = sg('oak_wall_sign', [['facing', 'north']]), We = sg('oak_wall_sign', [['facing', 'east']]);
    ok(Wn.hide && Wn.hide.stick === 1 && near(Wn.raw[1], 70.1875) && near(Wn.raw[2], 5.5 - 0.4375 * Math.cos(-Math.PI)) && near(We.raw[0], 3.5 - 0.4375 * Math.sin(-1.5 * Math.PI)), 'Sign wall: stick hidden, offset by facing');
    cur = SR.stateOf('stone'); ok(ER.beWorldItem({ type: 'sign', x: 3, y: 70, z: 5 }, 0) === null, 'Sign on non-sign block draws nothing');
    const dl = (e, p) => ER.beBannerAnim(e, p).deltaFor('flag');
    const D0 = dl({ x: 0, y: 0, z: 0 }, 0), D5 = dl({ x: 0, y: 0, z: 0 }, 25);
    ok(ER.beBannerAnim({ x: 0, y: 0, z: 0 }, 0).deltaFor('pole') === null && D0 && D0.rx !== D5.rx && near(D0.rx - D5.rx, 0.01 * Math.PI * (1 - Math.cos(Math.PI / 2))) && near(dl({ x: 3, y: 0, z: 0 }, 0).rx - dl({ x: 0, y: 0, z: 0 }, 0).rx, 0.01 * Math.PI * (Math.cos(Math.PI * 2 * 0.21) - 1)) && near(D0.dpy, -32 - M.BEModel.layer('banner').parts.find((q) => q.n === 'flag').py), 'Banner sway: flag only, phase by time/partial/position');
    const bl = (d, t) => ER.bellAnim({ ringing: true, ticks: t, lastSideHit: d }, 0.5).deltaFor('bell_body');
    const sb = Math.sin(10.5 / Math.PI) / (4 + 10.5 / 3);
    ok(ER.bellAnim({ ringing: false, ticks: 5, lastSideHit: 'north' }, 0).deltaFor('bell_body').rx === 0 && ER.bellAnim({ ringing: true, ticks: 1 }, 0).deltaFor('other') === null && near(bl('north', 10).rx, -sb) && near(bl('south', 10).rx, sb) && near(bl('east', 10).rz, -sb) && near(bl('west', 10).rz, sb) && bl('north', 10).rz === 0, 'Bell swing: side/sign/idle');
    const qp = ER.endPortalQuads(false), qg = ER.endPortalQuads(true);
    ok(qp.length === 2 && qp.map((q) => q.face).join() === 'down,up' && near(qp[0].v[0][1], 0.375) && near(qp[1].v[0][1], 0.75) && qg.length === 6 && near(ER.endPortalQuads(true, (x) => x === 'up')[0].v[0][1], 1) && ER.endPortalQuads(true, (x) => x === 'up').length === 1, 'End portal quads: slab vs gateway cube');
    const lp1 = ER.endPortalLayerParams(1, 0), lp16 = ER.endPortalLayerParams(16, 2);
    ok(near(lp1.k, 8.5) && near(lp16.k, 1) && near(lp1.tx, 17) && near(lp16.ty, (2 + 16 / 1.5) * 3) && near(lp1.rot, 4330 * 2 * Math.PI / 180), 'End portal layer params');
    const uv = ER.endPortalUV(0.5, 0.25, 16, 0), r16 = lp16.rot, k0 = ER.endPortalLayerParams(16, 0);
    ok(near(uv[0], (0.5 * k0.k * Math.cos(k0.rot) + 0.25 * k0.k * Math.sin(k0.rot) + k0.tx) * 0.5 + 0.25), 'End portal UV transform');
    const sh = ER.endPortalShade(0, 0, 0, () => [1, 1, 1], () => [0, 0, 0]);
    ok(near(sh[0], 0.022087) && near(sh[2], 0.110818) && ER.END_PORTAL_COLORS.length === 16, 'End portal shade sky*COLORS[0]');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['conduit rot sign', (t) => t.replace('BEs.conduitRotation(e, 0) * 180', '-BEs.conduitRotation(e, 0) * 180')],
  ['conduit bob', (t) => t.replace('by = 0.3 + sn * 0.2', 'by = 0.3 + sn * 0.3')],
  ['conduit wind phase', (t) => t.replace('(ticks / 66) | 0) % 3', '(ticks / 60) | 0) % 3')],
  ['conduit wind2 scale', (t) => t.replace('rotZ(180)), 0.875)', 'rotZ(180)), 0.75)')],
  ['conduit eye scale', (t) => t.replace('0.5 * 1.3333334', '0.5')],
  ['conduit eye tex', (t) => t.replace('e.eyeOpen ? null', '!e.eyeOpen ? null')],
  ['beacon last seg', (t) => t.replace('i === segs.length - 1 ? 1024', 'i === segs.length - 1 ? 512')],
  ['beacon outer alpha', (t) => t.replace('0.125, false', '0.25, false')],
  ['beacon outer radius', (t) => t.replace("rOut === undefined ? 0.25", "rOut === undefined ? 0.3")],
  ['beacon spin', (t) => t.replace('f(t * f(2.25)) - 45', 'f(t * f(2.25)) - 40')],
  ['campfire rot', (t) => t.replace('ER.CAMPFIRE_ROT = [0, 90, 180, 270]', 'ER.CAMPFIRE_ROT = [0, 270, 180, 90]')],
  ['campfire y', (t) => t.replace('e.y + 0.44921875 + o[1]', 'e.y + 0.5 + o[1]')],
  ['campfire scale', (t) => t.replace('var G = ER.GROUND_SPRITE, K = 0.375', 'var G = ER.GROUND_SPRITE, K = 0.5')],
  ['campfire skip empty', (t) => t.replace('!(stack.n > 0)', 'false')],
  ['book speed step', (t) => t.replace('e.nextPageTurningSpeed += 0.1;', 'e.nextPageTurningSpeed += 0.2;')],
  ['book idle drift', (t) => t.replace('e.fl2 += 0.02;', 'e.fl2 += 0.04;')],
  ['book flip damp', (t) => t.replace('(q - e.fl7) * 0.9', '(q - e.fl7) * 0.5')],
  ['lectern needs book', (t) => t.replace("if (SR.propValue(st, P_.has_book) !== V['true']) return null;", '')],
  ['lectern facing', (t) => t.replace("{ north: 'east', east: 'south'", "{ north: 'north', east: 'south'")],
  ['sign wood index', (t) => t.replace("texKey: gw ? 'sign#' + gw : null", "texKey: gw ? 'sign#' + (gw + 1) : null")],
  ['sign scale', (t) => t.replace('ER.SIGN_SCALE = 0.6666667', 'ER.SIGN_SCALE = 0.75')],
  ['sign wall offset', (t) => t.replace('e.y + 0.5 - 0.3125, e.z + 0.5 - 0.4375 * Math.cos(ga)', 'e.y + 0.5, e.z + 0.5 - 0.4375 * Math.cos(ga)')],
  ['sign rot step', (t) => t.replace('ga = -(parseInt(R.valueNames[SR.propValue(st, P_.rotation)], 10) | 0) * 22.5', 'ga = -(parseInt(R.valueNames[SR.propValue(st, P_.rotation)], 10) | 0) * 15')],
  ['sign wall hide', (t) => t.replace('hide: gm[2] ? { stick: 1 } : null', 'hide: null')],
  ['banner sway amp', (t) => t.replace('+ 0.01 * Math.cos(Math.PI * 2', '+ 0.02 * Math.cos(Math.PI * 2')],
  ['banner sway phase', (t) => t.replace('e.x * 7 + e.y * 9 + e.z * 13', 'e.x * 9 + e.y * 9 + e.z * 13')],
  ['banner sway pivot', (t) => t.replace('dpy: -32 - rest.py', 'dpy: -rest.py')],
  ['book flip clamp', (t) => t.replace('Math.min(0.2, (e.fl9', 'Math.min(0.3, (e.fl9')],
  ['bell side sign', (t) => t.replace("if (d === 'north') rx = -s; else if (d === 'south') rx = s;", "if (d === 'north') rx = s; else if (d === 'south') rx = -s;")],
  ['bell decay', (t) => t.replace('/ Math.PI) / (4 + t / 3);', '/ Math.PI) / (4 + t / 2);')],
  ['portal slab top', (t) => t.replace('topY: 0.75, sky', 'topY: 0.875, sky')],
  ['portal gateway faces', (t) => t.replace("if (!gateway && f !== 'up' && f !== 'down') continue;", '')],
  ['portal layer scale', (t) => t.replace('(4.5 - layer / 4) * 2', '(4.5 - layer / 4) * 1.5')],
  ['portal layer scroll', (t) => t.replace('(2 + layer / 1.5) * (t * 1.5)', '(2 + layer / 1.5) * (t * 2)')],
  ['portal colour0', (t) => t.replace('[0.022087, 0.098399, 0.110818]', '[0.032087, 0.098399, 0.110818]')],
  ['portal uv offset', (t) => t.replace('* 0.5 + 0.25, (-x * s', '* 0.5 + 0.3, (-x * s')]

];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
