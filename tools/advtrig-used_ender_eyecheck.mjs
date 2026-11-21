#!/usr/bin/env node
// advtrig-used_ender_eyecheck.mjs — G17-AT29 (#7995). Drives the REAL call site (Throw.useEye -> Adv.trigger
// 'minecraft:used_ender_eye') and lists every packed advancement using the trigger; breaks its own matcher and call site.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02l_advancements.js', '14f_inventory.js', '07h_entities.js',
  '07i_entitylist.js', '14b_physics.js', '14e_gamemode.js', '14d_survival.js', '14j_combat.js', '07zzd_throw.js', '07zw_mobnbt.js'];
const fails = []; let asserted = 0;

function run(patch, tweak) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Gen.init(1337, Object.assign(MCL.Gen.defaults(), { climate: 'vanilla' }));
  MCL.Entities.init(); MCL.EntityList.init();
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  // vanilla 1.18.2 packs NO advancement on this trigger (follow_ender_eye is a location/stronghold trigger), so list that and
  // add synthetic ones, one per distance condition, through the real Adv.builder/Manager.load.
  const users = [];
  Adv.manager.advancements.forEach((a, id) => { for (const n in a.criteria) if (a.criteria[n].trigger === 'minecraft:used_ender_eye') users.push(id); });
  no(users.length === 0, 'packed data now has used_ender_eye advancements: ' + users + ' — extend this check to drive them');
  if (!patch) console.log('   packed advancements using used_ender_eye: ' + (users.join(', ') || 'none (vanilla 1.18.2)'));
  const rec = (cond) => ({ c: { x: ['minecraft:used_ender_eye', cond] }, q: [['x']] });
  Adv.manager.load([['test:near', Adv.builder(rec({ distance: { max: 100000 } }))], ['test:far', Adv.builder(rec({ distance: { min: 90000 } }))]]);
  const mk = () => {
    const done = [];
    const P = { x: 100.5, y: 70, z: -200.5, type: 'player', eyeHeight: 1.62, slot: 0, inventory: null };
    P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
    P.instabuild = true;
    return { P, done };
  };
  const stack = { i: MCL.Items.of('ender_eye'), n: 1 };
  const tgt = MCL.Structures.locateStructure('eye_of_ender_located', 100, -201, 100);
  no(!!tgt, 'no stronghold located');
  const { P, done } = mk();
  MCL.EntityList.clear();
  no(MCL.Throw.useEye(P, stack) === true, 'useEye refused');
  no(done.includes('test:near'), 'in-range used_ender_eye advancement not completed');
  no(!done.includes('test:far'), 'out-of-range distance completed');
  // direct matcher: a distance condition outside the range must not match
  const m = Adv.matchers['minecraft:used_ender_eye'];
  no(m && m({ distance: { min: 10 } }, { player: P, distSq: 99 }) === false, 'distance min 10 matched at 9.95');
  no(m && m({ distance: { min: 10 } }, { player: P, distSq: 101 }) === true, 'distance min 10 failed at 10.05');
  no(m && m({ distance: { max: 10 } }, { player: P, distSq: 101 }) === false, 'distance max 10 matched at 10.05');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('07zzd_throw.js', "'minecraft:used_ender_eye', {", "'minecraft:used_ender_eye_x', {")],
  ['distance ignored', brk('02l_advancements.js', "P.rangeSqrt(c.distance, ctx.distSq)", "true")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:used_ender_eye'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-used_ender_eyecheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-used_ender_eyecheck: OK — ${caught} breaks caught`);
