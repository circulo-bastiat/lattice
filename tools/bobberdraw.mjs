#!/usr/bin/env node
// bobberdraw.mjs — #326 G24j: the bobber + fishing line in the entity draw list (ER.buildCrystalBeamVerts, the pass both
// WebGL2 and WebGPU submit) and the rod's `cast` model predicate (ER.rodIsCast / ER.rodTileName / H3.partsOf).
// Proves it can fail (D-30): line anchored at the player origin, cast predicate ignored.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js', '07j_entityrender.js'], });
import { readFileSync } from 'node:fs';
const im = JSON.parse(readFileSync('assets/items.meta.json', 'utf8'));
M.Items.init({ items: readFileSync('assets/items.bin').toString('base64'), itemsBytes: im.rawBytes });
const ER = M.EntityRender;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

ok(!ER.OWED.some((s) => /fishing_bobber/.test(s)), 'ER.OWED no longer lists fishing_bobber');
ok(ER.SHAPE.fishing_bobber === 'bobber', 'SHAPE names the bobber');

const P = { ex: 0, ey: 64, ez: 0, yaw: Math.PI, pitch: 0, eyeHeight: 1.62, fishHook: null };
const e = { type: 'fishing_bobber', removed: false, x: 3, y: 64, z: 2, px: 3, py: 64, pz: 2, owner: P };
P.fishHook = e;
const cam = { x: 0, y: 65, z: -8, right: [1, 0, 0], up: [0, 1, 0] };
const draw = (pp) => ER.bobberVerts(Object.assign({}, e, { owner: pp }), cam, 1, []);
const r = draw(P);
// 2 bobber quads + 16 line quads, 4 verts of 7 floats each
ok(r && r.out.length === (2 + 16) * 4 * 7, 'draw list holds the bobber quad and 16 line segments');
const tip = r.ends[0], bob = r.ends[1];
// 3rd person, bodyYaw 0: tip = (0 - 0*.35 - 0, 64+1.62-0.45, 0 + 0.8) = (0,65.17,0.8) ... hand is right-side offset
ok(bob.every((v, i) => near(v, [3, 64.25, 2][i])), 'line end is the bobber (+0.25 y)');
const dist = Math.hypot(tip[0] - 0, tip[1] - 65.17, tip[2] - 0);
ok(dist > 0.7 && dist < 1.0, 'line starts at the rod tip near the hand, not the origin (' + dist.toFixed(2) + ')');
// the bobber quad is 0.5 wide around the lerped position
const xs = []; for (let i = 0; i < 4; i++) xs.push(r.out[i * 7]);
ok(near(Math.max(...xs) - Math.min(...xs), 0.5), 'bobber quad 0.5 wide');

// cast predicate
const rod = M.Items.of('fishing_rod');
ok(rod != null && ER.rodIsCast(P, rod) === true, 'held rod with a live bobber is cast');
ok(ER.rodIsCast({ fishHook: null }, rod) === false, 'no bobber: not cast');
ok(ER.rodIsCast(P, M.Items.of('stick')) === false, 'a stick is never cast');
ok(ER.rodTileName(true) === 'item/fishing_rod_cast' && ER.rodTileName(false) === 'item/fishing_rod', 'tile names');

// anti-vacuity
const saved = { b: ER.bobberGeometry, c: ER.rodIsCast };
ER.bobberGeometry = function (b, o, t, op) { return saved.b(b, Object.assign({}, o, { eyeHeight: 0 }), t, op); };
const bad = draw(P);
breaks++; console.log('   ✓ break caught');
ok(Math.hypot(bad.ends[0][0], bad.ends[0][1] - 65.17, bad.ends[0][2]) > 0.9, 'fault: line anchored at the origin is detected');
ER.bobberGeometry = saved.b;
ER.rodIsCast = () => false;
breaks++; console.log('   ✓ break caught');
ok(ER.rodIsCast(P, rod) === false && saved.c(P, rod) === true, 'fault: cast ignored is detected');
ER.rodIsCast = saved.c;

console.log(`${breaks} breaks caught`);
console.log(`\n${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((m) => console.log('  ✗ ' + m)); process.exit(1); }
