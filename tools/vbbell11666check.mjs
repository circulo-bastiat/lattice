#!/usr/bin/env node
// vbbell11666check -- #11666: proves 07zv7_vbbell.js (HideWhenBellRingsTask + ForgetBellRingTask) is reached from
// 07zv_villagerbrain.js (tick -> VBBell.tick => 'hide' activity; ring via bell use) and 07s_raid.js, and that cutting
// each rule changes the outcome. '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(/NS\.VBBell\.tick\(e, tnow\)\) activity = 'hide'/.test(rd('07zv_villagerbrain.js')), 'reach: villager brain ticks VBBell -> hide');
ok(/NS\.VBBell\.ring\(m\.x, m\.y, m\.z\)/.test(rd('07zv_villagerbrain.js')), 'reach: villager brain rings bell');
ok(/NS\.VBBell\.ring\(x, y, z, dir\)/.test(rd('07s_raid.js')), 'reach: raid bell ring');
function scenario(edit) {
  const NS = { EntityList: { list: [] }, RaidManager: { world: {}, raid: false, getRaidAt() { return this.raid; } } };
  let s = rd('07zv7_vbbell.js');
  if (edit) { if (!s.includes(edit[0])) throw new Error('edit target missing'); s = s.replace(edit[0], edit[1]); }
  new Function('MCL', s)(NS);
  const V = NS.VBBell, out = {};
  const mk = (o) => Object.assign({ type: 'villager', x: 0.5, y: 64, z: 0.5, vbAge: 10, vbHome: { x: 0, y: 64, z: 0 } }, o);
  const a = mk({}), far = mk({ x: 100.5 }), dead = mk({ dead: true });
  NS.EntityList.list = [a, far, dead];
  out.n = V.ring(0, 64, 0); out.far = far.vbHeardBell; out.heard = a.vbHeardBell;
  out.t1 = V.tick(a, 20); out.hiding = a.vbHiding;
  out.ticks = (V.tick(a, 21), a.vbHiddenTicks);
  const b = mk({}); NS.EntityList.list = [b]; V.ring(0, 64, 0);
  out.expire = V.tick(b, 10 + 300); out.cleared = b.vbHeardBell;
  const c = mk({}); NS.EntityList.list = [c]; V.ring(0, 64, 0); NS.RaidManager.raid = true;
  out.raid = V.tick(c, 20); NS.RaidManager.raid = false;
  const d = mk({}); NS.EntityList.list = [d]; V.ring(0, 64, 0); d.vbHiddenTicks = 0; V.tick(d, 20); d.vbHiddenTicks = 301;
  out.maxHidden = V.tick(d, 21);
  return JSON.stringify(out);
}
const base = scenario(); const o = JSON.parse(base);
ok(o.n === 1 && o.far === undefined && o.heard === 10, 'ring reaches only near living villagers');
ok(o.t1 === true && o.hiding === true && o.ticks === 2, 'hides and counts');
ok(o.expire === false && o.cleared === null, 'forget after 300');
ok(o.raid === false, 'no hide during raid'); ok(o.maxHidden === false, 'forget after max hidden');
const breaks = [
  ['HEAR_DIST = 32;', 'HEAR_DIST = 1000;'],
  ['e.dead || e.removed', 'e.removed'],
  ['if (raid) return false;', ''],
  ['e.vbHeardBell + VBB.HEARD_WINDOW <= tnow', 'false'],
  ['e.vbHiddenTicks <= VBB.MAX_HIDDEN &&', ''],
  ['e.vbHiddenTicks++', 'e.vbHiddenTicks += 0'],
  ['e.vbHeardBell = null; e.vbHidingPlace', 'e.vbHidingPlace'],
].map((b) => [b, b[0]]);
let caught = 0;
for (const [ed, name] of breaks) {
  let got; try { got = scenario(ed); } catch (e) { got = 'throw'; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`vbbell11666check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== breaks.length ? 1 : 0);
