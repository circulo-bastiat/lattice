#!/usr/bin/env node
// advtrig-entity_hurt_playercheck.mjs -- #7977 G17-AT15. minecraft:entity_hurt_player through the real call site
// (Survival.hurt, LivingEntity.damage :1162). No vanilla 1.18.2 advancement uses this trigger (it is data-pack only),
// so two synthetic advancements are loaded; breaks its own matcher/call site to prove it can fail (D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

console.log('advtrig-entity_hurt_playercheck -- #7977');
const ASSETS = join(MCLITE_ROOT, 'assets');
const meta = JSON.parse(readFileSync(join(ASSETS, 'advancements.meta.json'), 'utf8'));
const bin = readFileSync(join(ASSETS, 'advancements.bin')).toString('base64');
const T = 'minecraft:entity_hurt_player';

function scenarios(patch, matcherPatch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({
    extra: ['02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07q_effects.js', '14d_survival.js', '02l_advancements.js'],
    initReg: false, patch });
  M.Adv.init({ advancements: bin, advancementsBytes: meta.rawBytes });
  if (matcherPatch) matcherPatch(M.Adv);
  const A = M.Adv, Sv = M.Survival;
  const rec = (cond) => ({ c: { a: [T, cond] }, q: [['a']] });
  A.manager.load([['test:any', A.builder(rec({}))], ['test:big', A.builder(rec({ damage: { taken: { min: 5 } } }))],
    ['test:blocked', A.builder(rec({ damage: { blocked: true } }))], ['test:zombie', A.builder(rec({ damage: { source_entity: { type: 'minecraft:zombie' } } }))]]);
  const P = M.Player = Sv.create ? Sv.create() : { x: 0, y: 64, z: 0 };
  P.advancements = new A.Tracker({});
  const done = (id) => P.advancements.getProgress(A.manager.get(id)).isDone();
  ok(!done('test:any') && !done('test:big'), 'starts incomplete');
  Sv.hurt(P, 'mob', 2, { type: 'skeleton', x: 1, y: 64, z: 0 });
  ok(done('test:any'), 'unconditioned criterion completes on any hit');
  ok(!done('test:big'), 'taken<5 must not complete test:big');
  ok(!done('test:blocked'), 'unblocked hit must not complete test:blocked');
  ok(!done('test:zombie'), 'skeleton must not complete test:zombie');
  P.invulnerable = 0;
  Sv.hurt(P, 'mob', 8, { type: 'zombie', x: 1, y: 64, z: 0 });
  ok(done('test:big'), 'taken>=5 completes test:big');
  ok(done('test:zombie'), 'zombie attacker completes test:zombie');
  return { fails, n };
}

const base = scenarios();
const fails = base.fails.slice();
const mutants = [
  ['matcher always false', null, (A) => { A.matchers[T] = () => false; }],
  ['matcher ignores damage', null, (A) => { A.matchers[T] = () => true; }],
  ['no call site', [['14d_survival.js', "NS.Adv.trigger(e, 'minecraft:entity_hurt_player'", "void (e, 'minecraft:entity_hurt_player'"]]],
  ['taken lost', [['14d_survival.js', 'taken: dealt', 'taken: 0']]],
];
let caught = 0;
for (const [name, p, mp] of mutants) {
  let bad;
  try { bad = scenarios(p ? (f, src) => { for (const [file, a, b] of p) if (f === file || f.endsWith(file)) { if (!src.includes(a)) throw new Error('anchor gone'); src = src.replace(a, b); } return src; } : undefined, mp).fails; }
  catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-entity_hurt_playercheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${base.n}`);
console.log(`advtrig-entity_hurt_playercheck: OK — ${caught} breaks caught`);
