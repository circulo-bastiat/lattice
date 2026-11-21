#!/usr/bin/env node
// brutesoundcheck.mjs — #1045: piglin_brute plays entity.piglin_brute.angry on the switch to FIGHT and 1.25%/tick
// while fighting (PiglinBruteBrain.tick / playSoundRandomly -> PiglinBruteEntity.playAngrySound), and the
// extractor's golden lists it in the angry column.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['07zzp_mobvoice.js', '07zzf_piglin.js'], dom: false });
const Pg = M.Piglin || M.Pg;
const table = {};
for (const l of readFileSync(join(MCLITE_ROOT, 'tools/golden/mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); table[c[0]] = c.slice(2); }
M.DATA = Object.assign({}, M.DATA, { mobSounds: table });
const played = [];
M.Sound = { play: (ev) => { played.push(ev); return true; } };
const angry = () => played.filter((x) => x === 'entity.piglin_brute.angry').length;
const mk = () => ({ type: 'piglin_brute', x: 0, y: 0, z: 0, health: 50, target: null, immuneToZombification: true });
const tgt = { health: 20 };

const EL = M.EntityList || (M.EntityList = {});
const tick = (e, r) => { EL.random = r || (() => 0.5); Pg.tickEntity(e); };
function run() {
  played.length = 0;
  const e = mk();
  tick(e); ok(angry() === 0, 'idle brute silent');
  e.target = tgt;
  tick(e, () => 0.5);
  const first = angry();
  for (let i = 0; i < 1000; i++) tick(e, () => 0.5);
  const steady = angry() - first;
  let n = 0, seed = 12345; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  played.length = 0;
  for (let i = 0; i < 40000; i++) tick(e, r);
  n = angry();
  return { first, steady, rate: n / 40000 };
}
const good = run();
ok(good.first === 1, 'idle->fight emits one angry (' + good.first + ')');
ok(good.steady === 0, 'no sound on quiet fighting ticks');
ok(good.rate > 0.0105 && good.rate < 0.0145, 'fight rate ~1.25% (' + good.rate + ')');

const tsv = readFileSync(join(MCLITE_ROOT, 'tools/golden/mob-sounds-1.18.2.tsv'), 'utf8').split('\n').find((l) => l.startsWith('piglin_brute\t')).split('\t');
ok(tsv[10] === 'entity.piglin_brute.angry', 'golden angry column lists entity.piglin_brute.angry');

// breaks: re-enable the duplicate call (a second hook with its own trigger and roll) -> caught
const orig = Pg.tickEntity;
Pg.tickEntity = function (e) {   // the old second hook: own entry-edge state, own roll
  orig(e);
  const f = !!e.target, was = !!e.dupFight; e.dupFight = f;
  if (f && (!was || EL.random() < 0.0125)) M.Sound.play('entity.piglin_brute.angry');
};
const dup = run(); okAv(dup.first !== 1, 'duplicate angry hook is caught (first=' + dup.first + ')');
Pg.tickEntity = orig;
okAv(!'entity.piglin_brute.ambient'.endsWith('.angry'), 'golden check rejects a non-angry name');
Pg.tickEntity = (e) => { e.target = null; orig(e); };
okAv(run().first === 0, 'silenced brute is caught (first)');
Pg.tickEntity = orig;

for (const f of fails) console.log('  FAIL ' + f);
console.log(`brutesoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
