// scoretickcheck — SB.tickPlayer vs ServerPlayerEntity.playerTick:471-498 (cached last*Score, absorption, air, respawn reset).
import fs from 'fs';
const dir = new URL('..', import.meta.url).pathname;
const src = fs.readFileSync(dir + 'src/07zzo2_scoreboard.js', 'utf8');
const surv = fs.readFileSync(dir + 'src/14d_survival.js', 'utf8') + '\n' + fs.readFileSync(dir + 'src/07zzs_portal.js', 'utf8');
function run(code, sv) {
  const NS = { Player: null };
  new Function('MCL', code)(NS);
  const SB = NS.Scoreboard || NS.SB;
  return { NS, SB };
}
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
function suite(code, svsrc) {
  const f = [];
  const chk = (c, m) => { if (!c) f.push(m); };
  let r; try { r = run(code); } catch (e) { return ['load: ' + e.message]; }
  const SB = r.SB;
  ['health', 'food', 'air', 'armor', 'xp', 'level'].forEach(c => SB.add('o_' + c, c));
  const P = { name: 'P', health: 10.5, absorption: 4, food: 17, air: 300, armor: 5, xpTotal: 7, xpLevel: 1 };
  SB.tickPlayer(P);
  const g = c => SB.getScore('P', SB.objectives['o_' + c]);
  chk(g('health') === 15, 'health = ceil(health+absorption) got ' + g('health'));
  chk(g('air') === 300, 'air written at 300 on first tick got ' + g('air'));
  chk(g('food') === 17 && g('armor') === 5 && g('xp') === 7 && g('level') === 1, 'basic values');
  SB.setScore('P', SB.objectives.o_food, 99); SB.tickPlayer(P);
  chk(g('food') === 99, 'unchanged food is not rewritten');
  P.air = 299.5 ; SB.tickPlayer(P); chk(g('air') === 300, 'air ceil');
  P.air = 120; SB.tickPlayer(P); chk(g('air') === 120, 'air change');
  P.air = 300; SB.tickPlayer(P); chk(g('air') === 300, 'air refill to 300 written');
  P.absorption = 0; SB.tickPlayer(P); chk(g('health') === 11, 'absorption loss updates health');
  P._sbLast = null; SB.setScore('P', SB.objectives.o_food, 99); SB.tickPlayer(P);
  chk(g('food') === 17, 'cache reset rewrites all');
  chk(/e\._sbLast = null/.test(svsrc), 'Sv.respawn resets _sbLast');
  chk(/p\._sbLast = null/.test(svsrc), 'End->overworld exit (respawnPlayer alive=true) resets _sbLast');
  return f;
}
const base = suite(src, surv);
base.forEach(m => console.log('FAIL ' + m));
let caught = 0, total = 0;
const breaks = [
  [s => s.replace("P.health + (P.absorption || 0)", "P.health"), null],
  [s => s.replace("if (P.air !== undefined) upd", "if (P.air !== undefined && P.air < 300) upd"), null],
  [s => s.replace("if (l[k] !== v) {", "if (true) {"), null],
  [s => s.replace("Math.ceil(v)", "Math.floor(v)"), null],
  [null, s => s.replace("e._sbLast = null;", "")],
  [null, s => s.replace("p._sbLast = null;", "")],
];
for (const [a, b] of breaks) {
  total++;
  let f; try { f = suite(a ? a(src) : src, b ? b(surv) : surv); } catch (e) { f = ['x']; }
  if (f.length) caught++; else console.log('NOT CAUGHT: ' + (a || b));
}
console.log(`${base.length ? 'FAIL' : 'ok'}: ${total} breaks caught` + (caught === total ? '' : ` (only ${caught})`));
process.exit(base.length || caught !== total ? 1 : 0);
