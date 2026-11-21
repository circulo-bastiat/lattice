// lockstep-tripwire -- #6794 (G17-L143): tripwire line of 1-40 strings between two hooks, crossed by a zombie, a dropped item, an arrow
// (through the string and above it), a sneaking player and a bat, 20 salts.
// Reference = .decomp TripWireBlock.java / TripWireHookBlock.java: onEntityCollision -> updatePowered only while unpowered; updatePowered tests
// getOtherEntities(outline shape box) minus Entity.canAvoidTraps (bat) and, on change, setBlockState + hook.update; while powered it schedules
// itself 10 ticks later (dedup per position); hook powered = attached && any armed string powered; hookSound at the far hook then the near hook
// (click_on 0.4/0.6, click_off 0.4/0.5, attach 0.4/0.7). attached shape y 1..2.5/16, detached 0..8/16.
import { loadEngine } from '../loadsrc.mjs';
const EXTRA = ['02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14e_gamemode.js', '14l_use.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const W = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0, setBlock: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); return true; }, blockLightAt: () => 15 };
M.World = W; M.Behave.init(W);
M.EntityList.list = [];
M.Use.init(W);
let fails = 0, breaks = 0, lanes = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
let played = 0; const events = []; M.Sound = { play: (ev, o) => (played++, events.push(`${ev}@${Math.floor(o.x)} v${o.volume} p${o.pitch.toFixed(3)}`)) };
const B = M.Behave;
const stateOf = (name, props) => { let s = M.Reg.realFirst[M.Reg.id[name]] + M.Reg.defaultState[M.Reg.id[name]]; for (const k in props) s = B.setProp(s, k, props[k]); return s; };
const KINDS = {
  zombie: { w: 0.6, h: 1.95, y: 1, v: 0.2 }, item: { w: 0.25, h: 0.25, y: 1, v: 0.2 }, arrow: { w: 0.5, h: 0.5, y: 1.1, v: 0.6 },
  arrowHigh: { w: 0.5, h: 0.5, y: 1.4, v: 0.6 }, player: { w: 0.6, h: 1.5, y: 1, v: 0.12, sneaking: true }, bat: { w: 0.5, h: 0.9, y: 1, v: 0.2 },
};
function lane(salt, kind, gap, forceN) {
  const r = stream(salt), n = forceN || 1 + Math.floor(r() * 40), K = KINDS[kind], gapAt = gap ? 1 + Math.floor(r() * n) : -1;
  const intact = !gap && n >= 1;
  cells.clear(); events.length = 0; B.clearSchedule(); M.EntityList.list = [];
  const place = (x, st) => { const o = W.getBlock(x, 1, 0); W.setBlock(x, 1, 0, st); M.Use.tripwireChanged(x, 1, 0, o); };
  place(0, stateOf('tripwire_hook', { facing: 'east' }));
  for (let i = 1; i <= n; i++) if (i !== gapAt) place(i, stateOf('tripwire', {}));
  place(n + 1, stateOf('tripwire_hook', { facing: 'west' }));
  const e = { type: kind === 'arrowHigh' ? 'arrow' : kind, width: K.w, height: K.h, x: -2, y: K.y, z: 0.5, sneaking: K.sneaking };
  M.EntityList.list = [e];
  // ---- reference ----
  const ref = [], pow = new Array(n + 2).fill(false), sched = []; let hookPow = false, seq = 0;
  if (intact) { ref.push('0:block.tripwire.attach@0 v0.4 p0.700', '0:block.tripwire.attach@' + (n + 1) + ' v0.4 p0.700'.replace('0.700', '0.700')); }
  const top = intact ? 2.5 / 16 : 0.5, bot = intact ? 1 / 16 : 0;
  const hit = (i) => kind !== 'bat' && e.x - K.w / 2 < i + 1 && e.x + K.w / 2 > i && e.y < 1 + top && e.y + K.h > 1 + bot && 0.5 - K.w / 2 < 1 && 0.5 + K.w / 2 > 0;
  const upd = (i, t) => {
    const now = hit(i);
    if (now !== pow[i]) {
      pow[i] = now;
      const hp = intact && pow.some(Boolean);
      if (hp !== hookPow) { hookPow = hp; const ev = hp ? 'click_on v0.4 p0.600' : 'click_off v0.4 p0.500'; ref.push(`${t}:block.tripwire.${ev.split(' ')[0]}@${n + 1} ${ev.slice(ev.indexOf(' ') + 1)}`, `${t}:block.tripwire.${ev.split(' ')[0]}@0 ${ev.slice(ev.indexOf(' ') + 1)}`); }
    }
    if (now && !sched.some((s) => s.i === i)) sched.push({ i, at: t + 10, seq: seq++ });
  };
  const eng = [], T = Math.ceil((n + 5) / K.v) + 40;
  const dump = (t) => { for (const ev of events) eng.push(`${t}:${ev}`); events.length = 0; };
  dump(0);
  const engPow = [], refPow = [];
  for (let t = 1; t <= T; t++) {
    B.tick(); dump(t);
    const due = sched.filter((s) => s.at === t).sort((a, b) => a.seq - b.seq);
    for (const s of due) { sched.splice(sched.indexOf(s), 1); if (pow[s.i]) upd(s.i, t); }
    e.x += K.v; M.Use.entityCollide(e); dump(t);
    const lo = Math.floor(e.x - K.w / 2 + 0.001), hi = Math.floor(e.x + K.w / 2 - 0.001);
    const yl = Math.floor(e.y + 0.001), yh = Math.floor(e.y + K.h - 0.001);
    if (yl <= 1 && 1 <= yh) for (let i = Math.max(lo, 1); i <= Math.min(hi, n); i++) if (i !== gapAt && !pow[i]) upd(i, t);
    let es = '', rs = '';
    for (let i = 0; i <= n + 1; i++) { const st = W.getBlock(i, 1, 0); es += B.propName(st, 'powered') === 'true' ? 1 : 0; rs += (i >= 1 && i <= n && i !== gapAt ? pow[i] : i === 0 || i === n + 1 ? hookPow : false) ? 1 : 0; }
    if (es !== rs) return `tick ${t} n=${n}: powered ${es} vs ${rs}`;
  }
  const att = B.propName(W.getBlock(0, 1, 0), 'attached') === 'true';
  if (att !== intact) return `n=${n}: hook attached ${att} vs ${intact}`;
  if (eng.join('|') !== ref.join('|')) return `n=${n} events ${eng.slice(0, 4)} vs ${ref.slice(0, 4)}`;
  return null;
}
function run() {
  let bad = null; lanes = 0;
  for (let s = 0; s < 20 && !bad; s++) for (const k of Object.keys(KINDS)) for (const gap of [false, true]) {
    if (gap && s % 2) continue;
    const b = lane(s, k, gap); lanes++;
    if (b) { bad = `salt ${s} ${k}${gap ? ' gap' : ''}: ${b}`; break; }
  }
  for (const n of [40]) { const b = lane(1, 'zombie', false, n); lanes++; if (b && !bad) bad = 'n=' + n + ' ' + b; }
  return bad;
}
const base = run(); ok(!base, base); const n0 = lanes;
{ // sanity: the zombie lane really powers the hook
  played = 0; lane(3, 'zombie', false); ok(played > 0, 'the zombie lane really plays tripwire sounds');
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const U = M.Use;
{ const o = U.TRIPWIRE_TICKS; U.TRIPWIRE_TICKS = 5; brk(!!run(), '10-tick re-check -> 5'); U.TRIPWIRE_TICKS = o; }
{ const o = U.TRIPWIRE_TICKS; U.TRIPWIRE_TICKS = 20; brk(!!run(), '10-tick re-check -> 20'); U.TRIPWIRE_TICKS = o; }
{ const o = U.TRIPWIRE_MAX; U.TRIPWIRE_MAX = 30; brk(!!run(), 'hook search range 42 -> 30'); U.TRIPWIRE_MAX = o; }
{ const o = U.TRIPWIRE_SHAPES.attached; U.TRIPWIRE_SHAPES.attached = [0, 1, 0, 16, 1.2, 16]; brk(!!run(), 'attached shape lowered'); U.TRIPWIRE_SHAPES.attached = o; }
{ const o = M.Sound.play; M.Sound.play = (ev, p) => o(ev.replace('click_on', 'click_off'), p); brk(!!run(), 'click_on sound id swapped'); M.Sound.play = o; }
console.log(`lockstep-tripwire: ${n0} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
