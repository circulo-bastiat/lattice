// evokerspellslockstepcheck.mjs -- #7087 (G17-L224): lockstep scenario 'evokerspells': an evoker against a standing scripted survival player at 4 and 12 blocks, 20 salts.
// Reference = .decomp SpellcastingIllagerEntity.CastSpellGoal (canStart: target alive, not casting, age >= startTime; start: spellTicks, startTime = age + startTimeDelay; mobTick: spellTicks--)
// + EvokerEntity.SummonVexGoal (spellTicks 100, delay 340, 3 vexes at blockPos+(-2..2, 1, -2..2), owner, bounds, lifeTicks 20*(30..119); canStart nextInt(8)+1 > nearby vexes)
// + ConjureFangsGoal (spellTicks 40, delay 100). Per tick: spell id, spellTicks, vex rows [owner, dist, life], fang count. The FangsAttack tiers (13 near / 16 line) are #6617; only the selection is compared here.
import { engineZombieTrace, harnessM } from './lockstep/zombielane.mjs';
import { compareTraces } from './lockstep/trace.mjs';

const T_RUN = 480;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i);
const M = harnessM(), SP = M.Spell;
const extra = (EL, e) => {
  const live = (ty) => EL.list.filter((q) => q.type === ty && !q.removed);
  return { spell: e.spell | 0, spellTicks: e.spellTicks | 0, fangs: live('evoker_fangs').length,
    vexes: live('vex').map((v) => [v.owner === e ? 1 : 0, Math.max(Math.abs(v.x - e.x), Math.abs(v.z - e.z)), v.vexLifeTicks]) };
};
const run = (salt, dist) => engineZombieTrace(salt, { mob: 'evoker', dist, aggro: true, extra, T: T_RUN });
const F = ['spell', 'spellTicks', 'fangs', 'vexes'];
// the casts: tick a spell begins = spellTicks jumps to its starting value
const starts = (R) => R.map((r, t) => [t, r]).filter(([t, r]) => r.spellTicks > (t ? R[t - 1].spellTicks : 0)).map(([t, r]) => ({ t, id: r.spell, st: r.spellTicks }));
function check(R, tag) {
  const S = starts(R);
  ok(S.length >= 2, tag + ': at least two casts, got ' + S.length);
  S.forEach((s) => ok((s.id === 2 && s.st === 39) || (s.id === 1 && s.st === 99), tag + ': spell ' + s.id + ' warmup ' + s.st));
  S.forEach((s, i) => { if (s.id === 1) { const n = R[Math.min(R.length - 1, s.t + 40)].vexes.length; ok(n >= 3, tag + ': vex count after summon ' + n); } });
  const sums = S.filter((s) => s.id === 1);
  for (let i = 1; i < sums.length; i++) ok(sums[i].t - sums[i - 1].t >= 340, tag + ': summon cooldown ' + (sums[i].t - sums[i - 1].t));
  const fg = S.filter((s) => s.id === 2);
  for (let i = 1; i < fg.length; i++) ok(fg[i].t - fg[i - 1].t >= 100, tag + ': fangs cooldown ' + (fg[i].t - fg[i - 1].t));
  R.forEach((r, t) => { if (t) ok(r.spellTicks === 0 || r.spellTicks === R[t - 1].spellTicks - 1 || r.spellTicks > R[t - 1].spellTicks, tag + ' t' + t + ': spellTicks counts down'); });
  R.forEach((r, t) => r.vexes.forEach((v) => { ok(v[0] === 1, tag + ' t' + t + ': vex owner'); ok(v[2] > 0 && v[2] <= 20 * 119, tag + ' t' + t + ': vex lifetime ' + v[2]); }));
  return S;
}
const all = {};
for (const dist of [4, 12]) {
  all[dist] = salts.map((s) => run(s, dist));
  all[dist].forEach((R, i) => { ok(R.length >= T_RUN, 'dist ' + dist + ' salt ' + i + ': ' + R.length + ' rows'); check(R, `d${dist} s${i}`); });
  const again = run(0, dist);
  ok(compareTraces(all[dist][0], again, { fields: F }) === null, 'dist ' + dist + ': same salt, same trace');
  ok(all[dist].some((R) => starts(R).some((s) => s.id === 1)) && all[dist].some((R) => starts(R).some((s) => s.id === 2)), 'dist ' + dist + ': both spells are chosen across salts');
}
const sig = (set) => JSON.stringify(set.map((R) => starts(R)));
const base = [sig(all[4]), sig(all[12])];
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const differs = () => [4, 12].some((d, i) => salts.some((s) => { const R = run(s, d); return compareTraces(all[d][s], R, { fields: F }) !== null; }));
const csv = SP.castSummonVex;
// vex count 3 -> 4: one extra spawn per cast
SP.castSummonVex = (e, ctx) => { csv(e, ctx); if (ctx && ctx.spawnFn) { const v = ctx.spawnFn('vex', e.x + 0.5, e.y + 1, e.z + 0.5); if (v) { v.owner = e; v.vexAlive = true; v.vexLifeTicks = 600; } } };
brk(differs(), 'vex count 3 -> 4 is reported'); SP.castSummonVex = csv;
const CSG = SP.CastSpellGoal;
SP.CastSpellGoal = function (e, ctx, cfg) { return new CSG(e, ctx, cfg.startTimeDelay === 340 ? Object.assign({}, cfg, { startTimeDelay: 300 }) : cfg); };
brk(differs(), 'summon cooldown 340 -> 300 is reported'); SP.CastSpellGoal = CSG;
ok(sig(all[4]) === base[0], 'unbroken engine unchanged after the breaks');
console.log(`evokerspellslockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
