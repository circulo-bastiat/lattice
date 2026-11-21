#!/usr/bin/env node
// structrule11759check.mjs — #11759: net/minecraft/structure/rule/* (RuleTest, RuleTestType, AlwaysTrueRuleTest, BlockMatchRuleTest,
// BlockStateMatchRuleTest, RandomBlockMatchRuleTest, RandomBlockStateMatchRuleTest, TagMatchRuleTest, PosRuleTest, PosRuleTestType,
// AlwaysTruePosRuleTest, AxisAlignedLinearPosRuleTest, LinearPosRuleTest) = JG.compilePredicate in 04t_jigsaw.js.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(cut) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, patch: (f, t) => {
    if (f !== '04t_jigsaw.js' || !cut) return t;
    if (!t.includes(cut[0])) throw new Error('cut not found: ' + cut[0]);
    return t.replace(cut[0], cut[1]);
  } });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  return M;
}
function probe(M) {
  const o = {}, C = M.Jigsaw.compilePredicate, WG = M.WG;
  const SS = M.States, stone = SS.stateOf('stone'), dirt = SS.stateOf('dirt');
  const nm = (n, s) => ({ name: n, state: s, seed: 7, x: 1, y: 2, z: 3 });
  o.trueT = C({ predicate_type: 'minecraft:always_true' })(nm('stone', stone));
  const bm = C({ predicate_type: 'block_match', block: 'minecraft:stone' });
  o.bm = bm(nm('stone', stone)) && !bm(nm('dirt', dirt));
  const sm = C({ predicate_type: 'blockstate_match', block_state: { Name: 'minecraft:stone' } });
  o.sm = sm(nm('stone', stone)) && !sm(nm('dirt', dirt));
  const rb1 = C({ predicate_type: 'random_block_match', block: 'minecraft:stone', probability: 1 });
  const rb0 = C({ predicate_type: 'random_block_match', block: 'minecraft:stone', probability: 0 });
  o.rb = rb1(nm('stone', stone)) && !rb0(nm('stone', stone)) && !rb1(nm('dirt', dirt));
  const rs1 = C({ predicate_type: 'random_blockstate_match', block_state: { Name: 'minecraft:stone' }, probability: 1 });
  o.rs = rs1(nm('stone', stone)) && !rs1(nm('dirt', dirt));
  const tg = C({ predicate_type: 'tag_match', tag: 'minecraft:doors' });
  o.tag = tg({ state: SS.stateOf('oak_door') }) && !tg({ state: stone });
  const ax = C({ predicate_type: 'axis_aligned_linear_pos', axis: 'y', min_chance: 0, max_chance: 1, min_dist: 0, max_dist: 10 });
  o.axHi = ax({ x: 5, y: 50, z: 5, seed: 1 }) && !ax({ x: 5, y: 0, z: 5, seed: 1 });
  const ln = C({ predicate_type: 'linear_pos', min_chance: 0, max_chance: 1, min_dist: 0, max_dist: 10 });
  o.ln = ln({ x: 20, y: 0, z: 0, seed: 1 }) && !ln({ x: 0, y: 0, z: 0, seed: 1 });
  try { C({ predicate_type: 'linear_pos', min_dist: 5, max_dist: 5 }); o.range = false; } catch (e) { o.range = true; }
  try { C({ predicate_type: 'bogus' }); o.unk = false; } catch (e) { o.unk = true; }
  return o;
}
const keys = ['trueT', 'bm', 'sm', 'rb', 'rs', 'tag', 'axHi', 'ln', 'range', 'unk'];
const bad = (o) => keys.filter((k) => !o[k]);
const b = probe(trial());
ok(bad(b).length === 0, 'baseline failing: ' + bad(b));
const cuts = [
  ["if (t === 'always_true') return function () { return true; };", "if (t === 'always_true') return function () { return false; };"],
  ["return function (ctx) { return ctx.name === want; };", "return function (ctx) { return true; };"],
  ["return function (ctx) { return ctx.state === st; };", "return function (ctx) { return true; };"],
  ["ctx.name === wantB && (hash4", "(hash4"],
  ["ctx.state === wantS && (hash4", "(hash4"],
  ["return function (ctx) { return flag[NS.States.block[ctx.state]] === 1; };", "return function (ctx) { return false; };"],
  ["var d = Math.abs(v);", "var d = 0;"],
  ["var d = Math.abs(ctx.x) + Math.abs(ctx.y) + Math.abs(ctx.z);", "var d = 0;"],
  ["if (lMinD >= lMaxD) throw", "if (false) throw"],
  ["throw new Error('jigsaw: unknown predicate type '", "return function () { return true; }; throw new Error('jigsaw: unknown predicate type '"],
];
for (const c of cuts) {
  breaks++; let caught;
  try { caught = bad(probe(trial(c))).length > 0; } catch (e) { caught = true; }
  ok(caught, 'anti-vacuity: cut survived: ' + c[0]);
  if (caught) console.log('  ✓ break caught');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `structrule11759check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
