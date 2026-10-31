#!/usr/bin/env node
// zombiefirecheck.mjs — #667: ZombieEntity.tryAttack (.decomp:330-340) spreads fire to the target.
//   node tools/zombiefirecheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (process.argv.includes('--verbose')) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };

console.log('zombiefirecheck — #667: a burning empty-handed zombie ignites its target');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.EnchHelper && M.EnchHelper.init) M.EnchHelper.init();
if (M.Effects && M.Effects.init) M.Effects.init();
M.Combat.init();
const EL = M.EntityList, Eq = M.Equip, IT = M.Items, Cb = M.Combat;

// scenario: returns the target's remainingFireTicks after one landed hit
function run(o) {
  const keepLd = Eq.localDifficulty, keepR = EL.random;
  Eq.localDifficulty = () => o.diff; EL.random = () => o.roll;
  try {
    const z = EL.spawn(o.type || 'zombie', 0.5, 64, 0.5);
    const t = EL.spawn('pig', 1.0, 64, 0.5);
    Eq.setEquipped(z, IT.MAINHAND, o.hand ? { i: IT.idOf ? IT.idOf(o.hand) : 1, n: 1 } : null);
    z.remainingFireTicks = o.burning ? 100 : 0; z.isOnFire = !!o.burning;
    t.invulnerableTime = 0; t.remainingFireTicks = 0; t.isOnFire = false;
    Cb.mobAttack(z, t);
    return t.remainingFireTicks | 0;
  } finally { Eq.localDifficulty = keepLd; EL.random = keepR; }
}
const base = { diff: 2.5, roll: 0.1, burning: true };   // 0.1 < 2.5*0.3
const want = 2 * 2 * Cb.FIRE_TICKS_PER_SECOND;           // 2*(int)2.5 seconds
ok(run(base) === want, `burning empty zombie ignites for ${want} ticks (got ${run(base)})`);
ok(run(Object.assign({}, base, { diff: 3.0 })) === 6 * Cb.FIRE_TICKS_PER_SECOND, 'diff 3.0 -> 6 s');
for (const t of ['husk', 'drowned', 'zombie_villager', 'zombified_piglin'])
  ok(run(Object.assign({}, base, { type: t })) === want, t + ' also spreads fire');

// anti-vacuity: each break of the scenario must remove the fire
const neg = [
  ['not burning', { burning: false }], ['roll above threshold', { roll: 0.9 }],
  ['difficulty 0', { diff: 0 }], ['skeleton is not a zombie', { type: 'skeleton' }],
  ['armed zombie', { hand: 'iron_sword' }],
];
for (const [n, d] of neg) {
  breaks++;
  const r = run(Object.assign({}, base, d));
  if (ok(r === 0, `break caught: ${n} -> no ignite (got ${r})`)) console.log('   ✓ break caught: ' + n); else console.log('  ✗ break NOT caught: ' + n);
}
ok(run(base) === want, 'the unbroken scenario still ignites (breaks were not vacuous)');

// #9964: Entity.baseTick skips the ON_FIRE hit while in LAVA (not water)
function fireHits(lava) {
  const z = EL.spawn('zombie', 0.5, 64, 0.5), keep = M.Physics.updateFluids, kh = Cb.hurt;
  let hits = 0;
  M.Physics.updateFluids = (e) => { e.inLava = lava; e.inWater = false; };
  Cb.hurt = (e, a, x, y, o) => { if (o && o.source === 'onFire') hits++; return false; };
  try { z.remainingFireTicks = 20; Cb.tickEntity(z); } finally { M.Physics.updateFluids = keep; Cb.hurt = kh; }
  return hits;
}
ok(fireHits(false) === 1, 'burning zombie on dry ground takes ON_FIRE on tick %20==0');
breaks++;
ok(fireHits(true) === 0, 'break caught: in lava -> no ON_FIRE hit');

if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); console.log(`FAIL ${fails.length}`); process.exit(1); }
console.log(`PASS zombiefirecheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
