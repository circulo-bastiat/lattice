#!/usr/bin/env node
// lockstep-preytarget -- #8718 (G18b-L45): who ActiveTargetGoal picks, and when. Each predator beside each prey in a fenced
// arena, 20 salts, adult and baby prey. Expected table is PARSED from each mob's own .decomp registerGoals (class, chance,
// mustSee flag, predicate); the engine must (a) acquire exactly the allowed prey and never a disallowed one, (b) acquire on the
// nextInt(toGoalTicks(10)) roll (first-acquire tick distribution: mean ~ 20 ticks, never none within 300), (c) carry the same
// mustSee flag on the goal row as the decomp's TrackTargetGoal.checkVisibility.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dec = (f) => readFileSync(join(ROOT, '.decomp/net/minecraft/entity/passive', f), 'utf8').replace(/\s+/g, ' ');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// decomp facts: [file, regex proving the row exists, mustSee per ActiveTargetGoal ctor]
const need = (file, re) => { if (!re.test(dec(file))) throw new Error('decomp row missing: ' + file + ' ' + re); };
need('CatEntity.java', /UntamedActiveTargetGoal<>\(this, RabbitEntity\.class, false, null\)/);
need('OcelotEntity.java', /ActiveTargetGoal<>\(this, ChickenEntity\.class, false\)/);
need('FoxEntity.java', /AnimalEntity\.class, 10, false, false, \$\$0 -> \$\$0 instanceof ChickenEntity \|\| \$\$0 instanceof RabbitEntity/);
need('FoxEntity.java', /FishEntity\.class, 20, false, false, \$\$0 -> \$\$0 instanceof SchoolingFishEntity/);
need('WolfEntity.java', /UntamedActiveTargetGoal<>\(this, AnimalEntity\.class, false, FOLLOW_TAMED_PREDICATE\)/);
need('WolfEntity.java', /\$\$1 == EntityType\.field_6115 \|\| \$\$1 == EntityType\.field_6140 \|\| \$\$1 == EntityType\.field_17943/);
need('PolarBearEntity.java', /ActiveTargetGoal<>\(this, FoxEntity\.class, 10, true, true, null\)/);
// [predator, prey, allowed, mustSee]
const ROWS = [
  ['cat', 'rabbit', true, false], ['cat', 'chicken', false, false],
  ['ocelot', 'chicken', true, false], ['ocelot', 'rabbit', false, false],
  ['fox', 'chicken', true, false], ['fox', 'rabbit', true, false], ['fox', 'cod', true, false], ['fox', 'sheep', false, false],
  ['wolf', 'sheep', true, false], ['wolf', 'rabbit', true, false], ['wolf', 'fox', true, false], ['wolf', 'chicken', false, false],
  ['polar_bear', 'fox', true, true], ['polar_bear', 'rabbit', false, true],
];
const TICKS = 300, PY = 20;

function runAll(patch, salt) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07zb_creeper.js', '07n_tame.js', '07zv_villagerbrain.js', '07w_passive.js', '07zj_fox.js', '07zj_polarbear.js', '07l_spawn.js', '14c_raycast.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
  const W = M.World, EL = M.EntityList, stone = M.States.stateOf('stone');
  const bad = [], acq = [];
  for (const [pred, prey, allowed, mustSee] of ROWS) for (const baby of [false, true]) {
    W.init(1);
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) { W.setBlock(x, PY - 1, z, stone); if (Math.abs(x) === 5 || Math.abs(z) === 5) { W.setBlock(x, PY, z, stone); W.setBlock(x, PY + 1, z, stone); } }
    EL.clear(); EL.random = stream(salt * 131 + (baby ? 7 : 3));
    const e = EL.spawn(pred, -1.5, PY, 0.5), p = EL.spawn(prey, 1.5, PY, 0.5);
    const tag = `${pred}/${prey}${baby ? '(baby)' : ''} salt=${salt}`;
    if (!e || !p) { bad.push(tag + ': spawn failed'); continue; }
    if (baby) { p.isBaby = true; p.age = -24000; }
    p.ai = null;
    if (!e.ai) { bad.push(tag + ': no goals'); continue; }
    const rows = e.ai.entries.filter((en) => en.flags === M.Ai.TARGET && en.goal.getCandidates && en.goal.getCandidates().includes(p));
    if (allowed !== (rows.length > 0)) bad.push(`${tag}: prey list ${rows.length > 0 ? 'has' : 'lacks'} ${prey}, vanilla ${allowed ? 'has' : 'lacks'}`);
    for (const r of rows) if (!!r.goal.mustSee !== mustSee) bad.push(`${tag}: mustSee ${!!r.goal.mustSee} want ${mustSee}`);
    let first = -1;
    for (let k = 0; k < TICKS; k++) { EL.tickMob(e); if (e.target === p) { first = k; break; } if (e.target && e.target !== p) { bad.push(tag + ': wrong target ' + e.target.type); break; } }
    if (allowed && first < 0) bad.push(tag + ': never acquired');
    if (!allowed && first >= 0) bad.push(tag + ': acquired a disallowed prey at ' + first);
    if (first >= 0) acq.push(first);
  }
  return { bad, acq };
}

let fails = 0, breaks = 0, n = 0, sum = 0;
for (let s = 0; s < 20; s++) { const r = runAll(null, s); n += r.acq.length; sum += r.acq.reduce((a, b) => a + b, 0); if (r.bad.length) { fails++; console.log('  FAIL salt ' + s + ': ' + r.bad.slice(0, 3).join(' | ')); } }
if (!n) { fails++; console.log('  FAIL vacuous: nothing acquired'); }
const mean = sum / Math.max(n, 1);
if (mean < 8 || mean > 60) { fails++; console.log('  FAIL acquire-tick mean ' + mean.toFixed(1) + ' outside the 1/10 roll band'); }
const mut = (name, file, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== file) return src; const o = src.replace(f, to); hit = o !== src; return o; };
  let caught = false;
  for (let s = 0; s < 3 && !caught; s++) caught = runAll(patch, s).bad.length > 0;
  if (!hit) { fails++; console.log('  FAIL mutation did not apply: ' + name); } else if (caught) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('cat list rabbit -> chicken', '07k_goals.js', "ofTypeC('rabbit')", "ofTypeC('chicken')");
mut('ocelot list chicken -> rabbit', '07k_goals.js', "ofTypeO('chicken'); }, { reciprocalChance", "ofTypeO('rabbit'); }, { reciprocalChance");
mut('polar bear mustSee dropped', '07k_goals.js', 'sight: true, mustSee: true });\n    foxGoal.tag', 'sight: true, mustSee: false });\n    foxGoal.tag');
console.log(`lockstep-preytarget: ${20 + 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${n} acquisitions, mean tick ${mean.toFixed(1)})`);
process.exit(fails ? 1 : 0);
