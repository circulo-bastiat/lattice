// #9186: breaks the mobproof hitbox producer's own data and requires each break to be caught.
import { prove } from './mobproofhitbox.mjs';
const E = { dimensions: (n) => ({ width: 0.6, height: 1.95 }), boxAt: (n, x, y, z) => [x - 0.3, y, z - 0.3, x + 0.3, y + 1.95, z + 0.3] };
const jar = { zombie: [0.6, 1.95] };
let bad = 0, caught = 0;
const ok = prove(['zombie'], jar, E).zombie; if (ok.failed.length || ok.pass !== false) { bad++; console.log('baseline wrong ' + JSON.stringify(ok)); }
const brk = (n, j, e) => { if (prove(['zombie'], j, e).zombie.failed.length) caught++; else { bad++; console.log('NOT CAUGHT ' + n); } };
brk('width', { zombie: [0.7, 1.95] }, E); brk('height', { zombie: [0.6, 1.8] }, E);
brk('no jar row', {}, E); brk('no engine dims', jar, { dimensions: () => null, boxAt: () => null });
brk('box off by feet', jar, { dimensions: E.dimensions, boxAt: (n, x, y, z) => [x - 0.3, y - 0.975, z - 0.3, x + 0.3, y + 0.975, z + 0.3] });
// #9196: eye height / baby scale / pose boxes
const X = { zombie: { living: true, eye: 1.74, eyeBaby: 0.93, scale: 0.5, sleep: [0.2, 0.2], swim: [0.6, 1.95], crouch: [0.6, 1.95], sit: [0.6, 1.95], longJump: null, eyeSleep: 0.2 } };
const eng = { ...E, eyeHeight: (n, baby) => (baby ? 0.93 : 1.74), babyScale: () => 0.5 };
const okx = prove(['zombie'], jar, eng, X).zombie; if (okx.failed.length) { bad++; console.log('extras baseline wrong ' + JSON.stringify(okx)); }
const brx = (n, patch, e = eng) => { if (prove(['zombie'], jar, e, { zombie: { ...X.zombie, ...patch } }).zombie.failed.length) caught++; else { bad++; console.log('NOT CAUGHT ' + n); } };
brx('eye', { eye: 1.62 }); brx('baby eye', { eyeBaby: 0.8 }); brx('baby scale', { scale: 0.3 }); brx('sleep box', { sleep: [0.6, 0.6] });
brx('swim box', { swim: [0.6, 0.6] }); brx('crouch box', { crouch: [0.6, 1.5] }); brx('sit box', { sit: [0.6, 1.5] }); brx('sleep eye', { eyeSleep: 1 });
brx('engine eye', {}, { ...eng, eyeHeight: () => 1.5 }); brx('engine baby scale', {}, { ...eng, babyScale: () => 1 });
if (prove(['zombie'], jar, eng, {}).zombie.failed.length) caught++; else { bad++; console.log('NOT CAUGHT no extras row'); }
// #9197: real-server AABB probe walk
import { probes, origin, MOVE } from './referee/hitboxscen.mjs';
const ox = origin(0), at = (mv) => ({ x: ox.x + 0.5 + mv.x, y: ox.y + mv.y, z: ox.z + 0.5 + mv.z });
const inside = (e, c) => probes(c.x, c.y, c.z, 0.6, 1.95).map((p) => [0, 1, 2].every((a) => e[a + 3] > p.at[a] && e[a] < p.at[a] + 1));
const boxFor = (dx) => (n, x, y, z) => [x - 0.3 + dx, y, z - 0.3, x + 0.3 + dx, y + 1.95, z + 0.3];
const sv = { spawn: inside(boxFor(0)('z', at({x:0,y:0,z:0}).x, at({x:0,y:0,z:0}).y, at({x:0,y:0,z:0}).z), at({x:0,y:0,z:0})), moved: null };
const m1 = at(MOVE); sv.moved = inside(boxFor(0)('z', m1.x, m1.y, m1.z), m1);
const okS = prove(['zombie'], jar, E, undefined, { zombie: sv }).zombie; if (okS.failed.length) { bad++; console.log('server baseline wrong ' + JSON.stringify(okS)); }
const brs = (n, e, s) => { if (prove(['zombie'], jar, e, undefined, { zombie: s }).zombie.failed.length) caught++; else { bad++; console.log('NOT CAUGHT ' + n); } };
brs('engine box shifted', { ...E, boxAt: boxFor(0.05) }, sv); brs('engine box wide', { ...E, boxAt: (n, x, y, z) => [x - 0.4, y, z - 0.4, x + 0.4, y + 1.95, z + 0.4] }, sv);
brs('server moved differs', E, { ...sv, moved: sv.moved.map((v, i) => (i === 0 ? !v : v)) }); brs('no server row', E, undefined);
console.log(bad ? 'FAIL' : `mobproofhitboxcheck ok: ${caught} breaks caught`); process.exit(bad ? 1 : 0);
