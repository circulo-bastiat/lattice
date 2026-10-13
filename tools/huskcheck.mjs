#!/usr/bin/env node
// huskcheck.mjs — #859: husk ambient/hurt/death/step sounds (HuskEntity.get*Sound), baby pitch +0.5,
// step volume 0.15, and the live hooks (Cb.hurt, entity tick). Ends with "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07h_entities.js', '07_world.js', '07zk_undead.js'], dom: false });
const U = M.Undead;
const table = JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcsnd/sounds.json'), 'utf8'));
const played = [];
M.Sound = { entitySound: (ev, x, y, z, vol, pitch, src) => { played.push({ ev, vol, pitch, src }); return true; } };
const r0 = () => 0.5;

function run(u) {
  const res = {};
  for (const v of Object.values(u.HUSK_SOUNDS || {})) res['has:' + v] = !!table[v];
  const husk = () => ({ type: 'husk', x: 0, y: 0, z: 0, onGround: true });
  for (const k of ['ambient', 'hurt', 'death', 'step']) { played.length = 0; u.playHuskSound(husk(), k, r0); res[k] = played.map(p => [p.ev, p.vol, p.pitch, p.src]); }
  played.length = 0; u.playHuskSound(Object.assign(husk(), { growAge: -24000 }), 'hurt', r0); res.baby = played.map(p => p.pitch);
  played.length = 0; u.playHuskSound(Object.assign(husk(), { silent: true }), 'hurt', r0); res.silent = played.length;
  played.length = 0; const z = { type: 'zombie', x: 0, y: 0, z: 0 }; u.playHuskSound(z, 'hurt', r0); res.zombie = played.length;
  played.length = 0; const a = husk(); for (let i = 0; i < 200; i++) u.tickHuskAmbient(a, () => 0); res.ambient200 = played.length;
  return res;
}
const good = run(U);
ok(Object.entries(good).every(([k, v]) => !k.startsWith('has:') || v), 'all husk events exist in the sound table');
ok(good.ambient[0]?.[0] === 'entity.husk.ambient' && good.hurt[0]?.[0] === 'entity.husk.hurt' && good.death[0]?.[0] === 'entity.husk.death', 'ambient/hurt/death events');
ok(good.step[0]?.[0] === 'entity.husk.step' && good.step[0][1] === 0.15, 'step event at volume 0.15');
ok(good.hurt[0]?.[3] === 'hostile' && good.hurt[0][1] === 1 && good.hurt[0][2] === 1, 'hostile, vol 1, pitch 1 at r-r=0');
ok(good.baby[0] === 1.5, 'baby pitch +0.5');
ok(good.silent === 0 && good.zombie === 0, 'silent and non-husk make no sound');
ok(good.ambient200 >= 1, 'ambient roll fires within 200 ticks');

const cb = readFileSync(join(MCLITE_ROOT, 'src/14j_combat.js'), 'utf8');
const el = readFileSync(join(MCLITE_ROOT, 'src/07i_entitylist.js'), 'utf8');
ok(/fresh[^\n]*NS\.Undead\.playSound\(e, e\.health <= 0 \? 'death' : 'hurt'\)/.test(cb) && !/playHuskSound/.test(cb), 'Cb.hurt plays husk hurt/death once, via Undead.playSound');
ok(!/tickHuskAmbient|tickHuskStep/.test(el) && /Undead\.tickSounds\(e/.test(el), 'entity tick: ambient + step only via Undead.tickSounds (no double step, #4303)');

let breaks = 0;
const catches = (mut) => { let r; try { r = run(Object.assign({}, U, mut)); } catch (x) { breaks++; console.log('  ✓ break caught'); return; }
  if (JSON.stringify(r) !== JSON.stringify(good)) { breaks++; console.log('  ✓ break caught'); } };
catches({ playHuskSound: () => false });
catches({ HUSK_SOUNDS: Object.assign({}, U.HUSK_SOUNDS, { death: 'entity.husk.nope' }) });
catches({ playHuskSound: (e, k, r) => U.playHuskSound(Object.assign({}, e, { growAge: 0 }), k, r) });
catches({ tickHuskAmbient: () => {} });
ok(breaks === 4, 'all 4 mutations detected');

console.log(`huskcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  x ' + f);
process.exit(fails.length ? 1 : 0);
