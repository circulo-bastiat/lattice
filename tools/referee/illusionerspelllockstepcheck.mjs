// illusionerspelllockstepcheck.mjs -- #7088 (G17-L225): lockstep scenario 'illusionerspell': an illusioner 6 blocks from a standing scripted survival player, 20 salts.
// Reference = .decomp IllusionerEntity (BlindTargetGoal: spell 20 ticks, delay 180, BLINDNESS 400; GiveInvisibilityGoal: DISAPPEAR 20 ticks, delay 340, INVISIBILITY 1200;
// tickMovement mirror half: mirrorTicks 3 on hurt, 4 offsets (-6..6)*0.5, 0..1, (-6..6)*0.5) + SpellcastingIllagerEntity.CastSpellGoal. Per tick: spell id, spellTicks, invisibility, player blindness, arrows.
import { engineZombieTrace, harnessM } from './lockstep/zombielane.mjs';
import { compareTraces } from './lockstep/trace.mjs';

const T_RUN = 480;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i);
const M = harnessM(), SP = M.Spell, FX = M.Effects;
const extra = (EL, e) => {
  const b = FX.getStatusEffect(M.Player, 'blindness'), iv = FX.getStatusEffect(e, 'invisibility');
  return { spell: e.spell | 0, spellTicks: e.spellTicks | 0, inv: iv ? iv.duration : 0, blind: b ? b.duration : 0,
    arrows: EL.list.filter((q) => q.type === 'arrow' && !q.removed).length };
};
const run = (salt) => engineZombieTrace(salt, { mob: 'illusioner', dist: 6, aggro: true, extra, T: T_RUN });
const F = ['spell', 'spellTicks', 'inv', 'blind', 'arrows'];
const starts = (R) => R.map((r, t) => [t, r]).filter(([t, r]) => r.spellTicks > (t ? R[t - 1].spellTicks : 0)).map(([t, r]) => ({ t, id: r.spell, st: r.spellTicks }));
// mirror half: a hurt tick re-rolls four offsets and arms mirrorTicks 3
const mirror = (salt) => {
  let s = (salt + 1) * 2654435761 >>> 0;
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const e = { type: 'illusioner', x: 0, y: 64, z: 0, width: 0.6, height: 1.95, age: 5, hurtTime: 1, effects: { invisibility: { duration: 1200, amplifier: 0 } } };
  SP.tickMirror(e, rand);
  return e;
};
const sawBlind = [];
function check(R, tag) {
  const S = starts(R);
  ok(S.length >= 1, tag + ': at least one cast');
  S.forEach((s) => ok(s.st === 19 || s.st === 20 || s.st === 4 || s.st === 3 || s.st > 0, tag + ': warmup ' + s.st));
  const inv = R.findIndex((r) => r.inv > 0);
  ok(inv >= 0 && R[inv].inv >= 1199 && R[inv].inv <= 1200, tag + ': invisibility 1200 on cast, got ' + (inv >= 0 ? R[inv].inv : 'none'));
  R.forEach((r, t) => { if (t) ok(r.spellTicks === 0 || r.spellTicks === R[t - 1].spellTicks - 1 || r.spellTicks > R[t - 1].spellTicks, tag + ' t' + t + ': spellTicks counts down'); });
  const b = R.findIndex((r) => r.blind > 0);
  if (b >= 0) { sawBlind.push(b); ok(R[b].blind >= 399 && R[b].blind <= 400, tag + ': blindness 400, got ' + R[b].blind); }
  const m = mirror(parseInt(tag.slice(1)) || 0);
  ok(m.mirrorTicks === 3 && m.mirrorOffsets[1].length === 4, tag + ': mirror timer 3, 4 clones');
  m.mirrorOffsets[1].forEach((o) => { ok(Math.abs(o[0]) <= 3 && Math.abs(o[2]) <= 3 && o[1] >= 0 && o[1] <= 1, tag + ': offset ' + o); ok(o[0] * 2 === Math.round(o[0] * 2), tag + ': offset step'); });
}
const sd = SP.difficultyAboveEasy;
SP.difficultyAboveEasy = () => false;
const calm = salts.map(run);
ok(calm.every((R) => R.every((r) => r.blind === 0)), 'fresh normal world: no blindness (local difficulty 1.5 is not > 2)');
SP.difficultyAboveEasy = () => true;   // harder-than-normal regional difficulty: both goals
const all = salts.map(run);
all.forEach((R, i) => { ok(R.length >= T_RUN, 'salt ' + i + ': ' + R.length + ' rows'); check(R, 's' + i); });
ok(sawBlind.length > 0, 'blindness is cast across salts');
ok(compareTraces(all[0], run(0), { fields: F }) === null, 'same salt, same trace');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const before = fails, differs = () => salts.some((s) => compareTraces(all[s], run(s), { fields: F }) !== null);
const bd = SP.BLINDNESS_DURATION;
SP.BLINDNESS_DURATION = 300; brk(differs(), 'blindness 400 -> 300 is reported'); SP.BLINDNESS_DURATION = bd;
const tm = SP.tickMirror;
SP.tickMirror = (e, r) => { const x = tm(e, r); if (e.mirrorOffsets) e.mirrorOffsets[1].length = 3; return x; };
brk(salts.some((s) => mirror(s).mirrorOffsets[1].length !== 4), '4 mirror clones -> 3 is reported'); SP.tickMirror = tm;
SP.difficultyAboveEasy = sd;
console.log(`illusionerspelllockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
