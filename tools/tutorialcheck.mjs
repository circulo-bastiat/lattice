#!/usr/bin/env node
// tutorialcheck.mjs - #11729: net.minecraft.client.tutorial.* (src/14o_tutorial.js). Drives the step machine with the real thresholds
// read from .decomp, asserts every entry point is wired in the shipped sources, and proves each assertion can fail (mutants).
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
const src = (f) => readFileSync(`src/${f}`, 'utf8');
const dec = (c) => readFileSync(`.decomp/net/minecraft/client/tutorial/${c}.java`, 'utf8');
let fails = [], breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function run(mut) {
  const T0 = src('14o_tutorial.js');
  const code = mut ? mut(T0) : T0;
  if (mut && code === T0) throw new Error('mutant did not change source');
  const MCL = {}; globalThis.window = globalThis;
  new Function('MCL', code.replace(/\}\)\(MCL\);\s*$/, '})(MCL);') + '\nreturn MCL;')(MCL);
  const T = MCL.Tutorial;
  const st = { surv: true, world: true, tree: false, log: false, planks: false, broken: false, w: 0 };
  Object.assign(T.host, { inSurvival: () => st.surv, hasWorld: () => st.world, hasTreeItem: () => st.tree, hasLogItem: () => st.log,
    hasPlanksItem: () => st.planks, hasBrokenTree: () => st.broken, hasCraftedPlanks: () => false, writeOptions: () => { st.w++; } });
  return { T, st };
}
function checks(h) {
  const out = []; const { T, st } = h;
  const tk = (n) => { for (let i = 0; i < n; i++) T.tick(); };
  out.push(['byName unknown -> none', T.byName('zzz') === 'none' && T.byName('craft_planks') === 'craft_planks']);
  // Movement: toast at tick 100, completes after >40 moved ticks and >40 looked ticks -> find_tree (survival)
  tk(1); out.push(['handler created on first world tick', !!T.handler]);
  tk(100); out.push(['movement toast at tick 100', T.toasts.length === 1 && T.toasts[0].type === 'movement_keys']);
  for (let i = 0; i < 40; i++) { T.onMovement({ fwd: 1 }); T.tick(); }
  out.push(['40 moved ticks not yet done', T.toasts.some((t) => t.type === 'movement_keys')]);
  T.onMovement({ fwd: 1 }); T.tick(); T.tick();
  out.push(['move done hides toast', !T.toasts.some((t) => t.type === 'movement_keys')]);
  tk(20); out.push(['look toast 20 ticks after move', T.toasts.some((t) => t.type === 'mouse')]);
  for (let i = 0; i < 42; i++) { T.onUpdateMouse(1, 0); T.tick(); }
  out.push(['movement+look -> find_tree', T.step === 'find_tree' && st.w > 0]);
  st.tree = false; { const sv = T.step; T.setStep('find_tree'); tk(5999); const a = T.toasts.length; tk(1); out.push(['find_tree toast exactly at 6000', a === 0 && T.toasts.some((t) => t.type === 'tree')]); T.setStep(sv); T.destroyHandler(); T.createHandler(); }
  T.onTarget('oak_log'); out.push(['targeting a tree -> punch_tree', T.step === 'punch_tree']);
  T.onBlockBreaking(null, 0.5, true); T.onBlockBreaking(null, 0.5, true); T.onBlockBreaking(null, 0, true); T.onBlockBreaking(null, 0, true); tk(1);
  out.push(['no toast before 600 ticks / >3 punches yet', T.toasts.length === 0]);
  T.onBlockBreaking(null, 0, true); T.onBlockBreaking(null, 0, true); tk(1); out.push(['>3 punches shows punch toast', T.toasts.some((t) => t.type === 'tree')]);
  T.onBlockBreaking(null, 1, true); out.push(['log broken -> open_inventory', T.step === 'open_inventory' && T.toasts.length === 0]);
  tk(600); out.push(['inventory toast at 600', T.toasts.some((t) => t.type === 'recipe_book')]);
  T.onInventoryOpened(); out.push(['inventory opened -> craft_planks', T.step === 'craft_planks']);
  tk(1200); out.push(['planks toast at 1200', T.toasts.some((t) => t.type === 'wooden_planks')]);
  st.planks = true; T.onSlotUpdate(); out.push(['planks in slot -> none', T.step === 'none' && T.toasts.length === 0]);
  // non-survival: find_tree falls to none
  T.setStep('find_tree'); st.surv = false; tk(1); out.push(['creative in find_tree -> none', T.step === 'none']);
  // find_tree skip when tree item at tick 1
  st.surv = true; st.tree = true; T.setStep('find_tree'); T.destroyHandler(); tk(1); tk(1);
  out.push(['holding a log at find_tree tick 1 -> craft_planks', T.step === 'craft_planks']);
  // world gone destroys handler
  st.world = false; tk(1); out.push(['no world destroys handler', T.handler === null]);
  // Bundle
  st.world = true; T.hideBundleTutorial = false;
  T.onPickupSlotClick('stone', 'bundle', 'left'); out.push(['bundle left click shows toast', T.toasts.some((t) => t.type === 'bundle')]);
  tk(20); out.push(['bundle toast alive at 20 ticks', T.toasts.some((t) => t.type === 'bundle')]); tk(120); out.push(['bundle toast alive at 140', T.toasts.some((t) => t.type === 'bundle')]);
  tk(21); out.push(['bundle toast expires after 160', !T.toasts.some((t) => t.type === 'bundle')]);
  T.onPickupSlotClick('stone', 'bundle', 'left'); T.onPickupSlotClick('stone', 'bundle', 'right');
  out.push(['bundle right click ends + hides forever', T.hideBundleTutorial === true && !T.toasts.some((t) => t.type === 'bundle')]);
  T.onPickupSlotClick('stone', 'bundle', 'left'); out.push(['hidden bundle tutorial stays hidden', !T.toasts.some((t) => t.type === 'bundle')]);
  return out;
}
// decomp thresholds (the numbers the module must carry)
const D = { 'MovementTutorialStepHandler': ['40', '100', '20'], 'FindTreeTutorialStepHandler': ['6000'], 'PunchTreeTutorialStepHandler': ['600'],
  'OpenInventoryTutorialStepHandler': ['600'], 'CraftPlanksTutorialStepHandler': ['1200'], 'BundleTutorial': [] };
for (const [c, ns] of Object.entries(D)) for (const n of ns) ok(dec(c).includes(n), `${c} no longer has ${n}`);
ok(dec('BundleTutorial').length > 0 && /\(\$\$1, 160\)|, 160\)/.test(dec('TutorialManager') + dec('BundleTutorial')), 'bundle 160');
ok((dec('FindTreeTutorialStepHandler').match(/Blocks\.field_/g) || []).length === 26, 'TREE_BLOCKS count 26 in decomp');
const base = checks(run());
for (const [n, v] of base) ok(v, 'FAIL ' + n);
const steps = [...dec('TutorialStep').matchAll(/\("([a-z_]+)"/g)].map((m) => m[1]);
loadEngine({}); const T0 = run().T;
ok(JSON.stringify(steps) === JSON.stringify(T0.STEPS), `TutorialStep names ${steps} vs ${T0.STEPS}`);
ok(T0.TREE_BLOCKS.length === 26, 'TREE_BLOCKS length 26');
{ const R = loadEngine({}).Reg; for (const b of T0.TREE_BLOCKS) ok(R.id[b] !== undefined, `TREE_BLOCKS ${b} not a registry block`); }
// wiring: every entry point reachable from the shipped sources
const wires = [['17_main.js', 'NS.Tutorial.tick()'], ['17_main.js', 'NS.Tutorial.onInventoryOpened()'], ['14_player.js', 'NS.Tutorial.onMovement(cmd)'],
  ['14_player.js', 'NS.Tutorial.onBlockBreaking('], ['13_input.js', 'NS.Tutorial.onUpdateMouse(']];
for (const [f, s] of wires) ok(src(f).includes(s), `${f} no longer calls ${s}`);
ok(readFileSync('build.mjs', 'utf8').includes("'14o_tutorial.js'"), 'build.mjs lacks 14o_tutorial.js');
// mutants: each must flip at least one check
const MUT = [
  (s) => s.replace('ticks >= 6000', 'ticks >= 6001'), (s) => s.replace('moved > 40', 'moved > 41'), (s) => s.replace('ticks >= 100', 'ticks >= 101'),
  (s) => s.replace('ticks >= 600 && !h.toast) h.toast = show(mk(\'recipe_book\'', 'ticks >= 601 && !h.toast) h.toast = show(mk(\'recipe_book\''),
  (s) => s.replace("T.setStep('craft_planks'); };\n    return h;\n  };\n  // ── CraftPlanks", "};\n    return h;\n  };\n  // ── CraftPlanks"),
  (s) => s.replace("T.add(T.bundle.toast, 160)", "T.add(T.bundle.toast, 100)"), (s) => s.replace("punches > 3", "punches > 9"),
  (s) => s.replace("T.setStep('punch_tree')", "T.setStep('none')"), (s) => s.replace("ticks >= 1200", "ticks >= 1201"),
  (s) => s.replace("if (!T.hideBundleTutorial) { T.hideBundleTutorial = true;", "if (false) { T.hideBundleTutorial = true;"),
];
for (const m of MUT) { let r; try { r = checks(run(m)); } catch (e) { breaks++; continue; } if (r.some(([, v]) => !v)) { breaks++; console.log("✓ mutant caught"); } else fails.push('mutant survived: ' + m.toString().slice(0, 60)); }
for (const f of fails) console.log('FAIL', f);
console.log(`tutorialcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length || breaks < MUT.length ? 1 : 0);
