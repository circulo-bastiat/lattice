#!/usr/bin/env node
// lockstep-skeletonswitch -- #6941 (G17-L201): a skeleton given a bow, then a sword (bow to the offhand), then the bow removed.
// Per tick: running goals (class by canUse shape: bow vs melee, with priority), the BowAttackGoal cooldown, arrow entities, held slots.
// Engine side only (no server half); compareTraces, exact doubles, 20 salts. Anti-vacuity: the bow interval 20 (normal) vs 40 hard swapped.
import { engineZombieTrace, harnessM, attackTicksOf } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const FIELDS = ['pos', 'yaw', 'pitch', 'target', 'goals', 'held', 'arrows', 'cd'];
const SALTS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : Array.from({ length: 20 }, (_, i) => i);
const SWORD_AT = 60, BOW_OUT_AT = 110;

function trace(salt, diff = 'normal') {
  const M = harnessM(), IT = M.Items, Eq = M.Equip;
  const extra = [];
  let e = null, prev = new Set();
  const snap = (t, EL) => {
    const gs = e.ai, goals = [];
    const ents = (gs && gs.entries) || [];
    ents.forEach((en, k) => { if (en.running) goals.push(en.priority + ':' + (en.priority === 4 ? (k === ents.findIndex((x) => x.priority === 4) ? 'bow' : 'melee') : k)); });
    const held = [IT.MAINHAND, IT.OFFHAND].map((s) => { const st = Eq.getEquipped(e, s); return st ? IT.nameOf(st.i) : null; });
    const arrows = EL.list.filter((x) => /arrow/.test(x.type)).map((x) => x.id + '@' + x.x + ',' + x.y + ',' + x.z);
    extra[t] = { goals: goals.join(','), held: held.join('/'), arrows: arrows.join(';'), cd: attackTicksOf(M.Ai, e) };
  };
  if (M.Diff) M.Diff.set(diff);
  const rows = engineZombieTrace(salt, { mob: 'skeleton', onTick: (t, EL) => {
    if (!e) e = EL.list.find((x) => x.type === 'skeleton');
    if (t === 1) { if (M.Diff) M.Diff.set(diff); Eq.setEquipped(e, IT.MAINHAND, Eq.stackOf('bow')); }
    if (t === SWORD_AT) { Eq.setEquipped(e, IT.OFFHAND, Eq.getEquipped(e, IT.MAINHAND)); Eq.setEquipped(e, IT.MAINHAND, Eq.stackOf('iron_sword')); }
    if (t === BOW_OUT_AT) Eq.setEquipped(e, IT.OFFHAND, null);
    snap(t, EL);
  } });
  if (M.Diff) M.Diff.set('normal');
  return rows.map((r, t) => Object.assign({}, r, extra[t] || {}));
}
const traces = SALTS.map((s) => trace(s));
traces.forEach((rows, i) => {
  const s = SALTS[i], at = (a, b) => rows.slice(a, b);
  ok(rows.length === T, `salt ${s}: rows`);
  ok(at(2, SWORD_AT).some((r) => /bow/.test(r.goals || '')), `salt ${s}: bow goal never active with a bow`);
  ok(at(SWORD_AT + 1, BOW_OUT_AT).every((r) => r.held === 'iron_sword/bow'), `salt ${s}: held slots`);
  ok(at(BOW_OUT_AT + 2, T).every((r) => !/bow/.test(r.goals || '')), `salt ${s}: bow goal still active after the bow is removed`);
});
ok(traces.some((rows) => rows.some((r) => r.arrows)), 'no arrow in any salt');
ok(compareTraces(traces[0], trace(SALTS[0]), { fields: FIELDS }) === null, 'same salt, same trace');
const mut = (f, v) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: v } : r));
caught(compareTraces(traces[0], mut('pos', [1, 2, 3]), { fields: FIELDS })?.tick === 77, 'pos');
caught(compareTraces(traces[0], mut('held', 'bow/iron_sword'), { fields: FIELDS })?.field === 'held', 'held slots');
caught(compareTraces(traces[0], mut('goals', 'x'), { fields: FIELDS })?.field === 'goals', 'goals list');
// the 20 vs 40 tick interval swapped at hard difficulty: the hard trace must differ from normal in the arrow list.
const hard = SALTS.map((s) => trace(s, 'hard'));
caught(hard.some((h, i) => compareTraces(traces[i], h, { fields: FIELDS })), 'interval 20/40 swap at hard');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
