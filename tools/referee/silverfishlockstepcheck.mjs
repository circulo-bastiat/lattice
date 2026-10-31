// silverfishlockstepcheck.mjs -- #6681 (G17-L110): lockstep scenario 'silverfish': one hurt silverfish calls for help (CallForHelpGoal, 20-tick delay, 21x11x11 zig-zag box,
// break-out + spawned silverfish, or revert to stone when mobGriefing is off, coin-flip stop), two more infest an adjacent stone block (WanderAndInfestGoal, 1-in-10, random direction); 20 salts.
// Reference = .decomp SilverfishEntity.CallForHelpGoal / WanderAndInfestGoal / InfestedBlock.onStacksDropped written out independently over NS.JRandom on a Map world.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07h_entities.js', '07i_entitylist.js', '07zn_silverfish.js'], dom: false, initReg: true });
const SF = M.Silverfish, R = M.Reg;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i), TICKS = 120, HURT = 10;
const STONE = R.realFirst[R.id.stone], INF = R.realFirst[R.id.infested_stone];
const k = (x, y, z) => x + ',' + y + ',' + z;
const INFESTED = [[3, 64, 2], [-4, 66, 1], [5, 62, -3], [0, 64, 6], [-2, 63, -2], [7, 65, 7]];
const STONES = [[20, 64, 20], [30, 64, 30]];
const ZZ = (m) => { const o = [0]; for (let i = 1; i <= m; i++) o.push(i, -i); return o; };   // 0,1,-1,2,-2... (the ($$3<=0?1:0)-$$3 walk)
function mkWorld() { const w = new Map(); INFESTED.forEach((p) => w.set(k(...p), INF)); STONES.forEach((p) => w.set(k(...p), STONE)); return w; }
const snap = (w, sp, rem, a) => [[...w.entries()].sort().join(';'), sp.length, rem.join(''), a > 0 ? 1 : 0].join('|');

function reference(salt) {
  const r = new M.JRandom(9100 + salt), w = mkWorld(), tr = [], sp = [], griefing = salt % 4 !== 3, rem = [0, 0];
  let delay = 0;
  const B = [[21.5, 64, 20.5], [31.5, 64, 30.5]];
  for (let t = 0; t < TICKS; t++) {
    if (t === HURT && delay === 0) delay = 20;
    if (delay > 0) {
      delay--;
      if (delay <= 0) {
        scan: for (const dy of ZZ(5)) for (const dx of ZZ(10)) for (const dz of ZZ(10)) {
          const q = k(0 + dx, 64 + dy, 0 + dz), s = w.get(q);
          if (s === INF) {
            if (griefing) { w.delete(q); sp.push(q); } else w.set(q, STONE);
            if (r.nextDouble() < 0.5) break scan;
          }
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      if (rem[i]) continue;
      if (griefing && r.nextDouble() < 0.1) {
        const d = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][(r.nextDouble() * 6) | 0];
        const q = k(Math.floor(B[i][0]) + d[0], Math.floor(B[i][1] + 0.5) + d[1], Math.floor(B[i][2]) + d[2]);
        if (w.get(q) === STONE) { w.set(q, INF); rem[i] = 1; }
      }
    }
    tr.push(snap(w, sp, rem, delay));
  }
  return tr;
}

function engine(salt) {
  const r = new M.JRandom(9100 + salt), w = mkWorld(), tr = [], sp = [], griefing = salt % 4 !== 3;
  M.World = { getBlock: (x, y, z) => w.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { if (s === 0) w.delete(k(x, y, z)); else w.set(k(x, y, z), s); return true; } };
  M.EntityList = { ready: true, spawn: (id, x, y, z) => { sp.push(k(Math.floor(x), y, Math.floor(z))); return {}; } };
  const ctx = { random: () => r.nextDouble(), mobGriefing: () => griefing };
  const a = { x: 0.5, y: 64, z: 0.5 }, bs = [{ x: 21.5, y: 64, z: 20.5, passengers: [{}] }, { x: 31.5, y: 64, z: 30.5, passengers: [{}] }];
  const call = new SF.CallForHelpGoal(a, ctx), inf = bs.map((e) => new SF.WanderAndInfestGoal(e, 1.0, ctx));
  for (let t = 0; t < TICKS; t++) {
    if (t === HURT) call.onHurt();
    if (call.canUse()) call.tick();
    inf.forEach((g, i) => { if (!bs[i].removed && g.canUse()) g.start(); });
    tr.push(snap(w, sp, bs.map((e) => (e.removed ? 1 : 0)), call.canUse() ? 1 : 0).replace(/\|(\d+)$/, (m, d) => m));
  }
  return tr;
}
const norm = (tr) => tr;
const dirty = () => salts.some((s) => { const a = reference(s), b = engine(s); return a.some((v, i) => v !== b[i]); });
const res = salts.map((s) => { const a = reference(s), b = norm(engine(s)); const i = a.findIndex((v, j) => v !== b[j]); return { a, bad: i >= 0 ? 'tick ' + i + ' ' + a[i] + ' vs ' + b[i] : '' }; });
ok(!res.some((x) => x.bad), 'divergence: ' + res.map((x, i) => x.bad && i + ':' + x.bad).filter(Boolean).slice(0, 2));
ok(res.every((x) => x.a[HURT + 5].endsWith('|1') && x.a[TICKS - 1].split('|')[3] === '0'), 'delay armed at hurt, drained after (not vacuous)');
ok(res.some((x) => x.a[TICKS - 1].split('|')[1] !== '0') && res.some((x) => x.a[TICKS - 1].includes(',' + INF + ';') || x.a[TICKS - 1].includes(STONE + ';')), 'break-outs spawn silverfish; reverts happen');
ok(res.some((x) => x.a[TICKS - 1].split('|')[2] !== '00'), 'some silverfish infest a neighbour block');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = SF.CALL_FOR_HELP_DELAY; SF.CALL_FOR_HELP_DELAY = 10; brk(dirty(), 'call delay 20 -> 10 caught'); SF.CALL_FOR_HELP_DELAY = o; }
{ const o = SF.isInfested; SF.isInfested = () => false; brk(dirty(), 'break-out disabled caught'); SF.isInfested = o; }
console.log(`silverfishlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
