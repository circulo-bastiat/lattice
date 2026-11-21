#!/usr/bin/env node
// shulkersoundcheck.mjs — #658: ShulkerEntity's sounds (ambient only while open, hurt / hurt_closed, death)
// and that every event exists in the vanilla sound table. Ends with "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07h_entities.js', '07_world.js', '07b_behaviour.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07zzk_shulker.js'], dom: false });
const Sh = M.Shulker;
const table = JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcsnd/sounds.json'), 'utf8'));
const played = [];
M.Sound = { play: (ev, o) => { played.push([ev, o]); return true; } };
const last = () => played.length ? played[played.length - 1][0] : null;
const r0 = () => 0;

function run(sh) {
  const res = {};
  for (const v of Object.values(sh.SOUNDS)) res['has:' + v] = !!table[v];
  const open = { x: 1, y: 2, z: 3, shulkerPeek: 100 }, shut = { x: 1, y: 2, z: 3, shulkerPeek: 0 };
  played.length = 0; sh.playSound(open, 'ambient'); res.ambOpen = last();
  played.length = 0; sh.playSound(shut, 'ambient'); res.ambShut = last();
  played.length = 0; sh.playSound(open, 'hurt'); res.hurtOpen = last();
  played.length = 0; sh.playSound(shut, 'hurt'); res.hurtShut = last();
  played.length = 0; sh.playSound(shut, 'death'); res.death = last();
  res.src = played.length ? played[0][1].source : null;
  // ambient roll: with rnd 0, chance starts -80 so nothing until it climbs past 0
  played.length = 0; const e = { x: 0, y: 0, z: 0, shulkerPeek: 100 };
  for (let i = 0; i < 200; i++) sh.tickAmbient(e, r0);
  res.rolled = played.length;
  return res;
}
const good = run(Sh);
ok(Object.entries(good).every(([k, v]) => !k.startsWith('has:') || v), 'all four shulker events exist in the sound table');
ok(good.ambOpen === 'entity.shulker.ambient', 'open shulker plays ambient');
ok(good.ambShut === null, 'closed shulker plays no ambient');
ok(good.hurtOpen === 'entity.shulker.hurt', 'open shulker hurt sound');
ok(good.hurtShut === 'entity.shulker.hurt_closed', 'closed shulker hurt_closed sound');
ok(good.death === 'entity.shulker.death', 'death sound');
ok(good.src === 'hostile', 'hostile category');
ok(good.rolled >= 1, 'ambient roll fires within 200 ticks');

// live hook: Cb.hurt must call playSound for shulkers
const cb = readFileSync(join(MCLITE_ROOT, 'src/14j_combat.js'), 'utf8');
ok(/e\.type === 'shulker'[^\n]*playSound\(e, e\.dead \? 'death' : 'hurt'\)/.test(cb), 'Cb.hurt calls Shulker.playSound');

// vehicle case (#4452): the ambient roll precedes the `if (e.vehicle) return` gate in StayAttachedGoal.tick
const shSrc = readFileSync(join(MCLITE_ROOT, 'src/07zzk_shulker.js'), 'utf8');
const rollsRiding = (src) => /Sh\.tickAmbient\(e, rand\);[^\n]*\n\s*if \(e\.vehicle\) return;/.test(src);
ok(rollsRiding(shSrc), 'riding shulker still rolls ambient sound');

// anti-vacuity: broken variants must be caught
let breaks = 0;
const catches = (mut) => { const s = Object.assign({}, Sh, mut); let r; try { r = run(s); } catch (x) { breaks++; console.log('  ✓ break caught'); return; }
  if (JSON.stringify(r) !== JSON.stringify(good)) { breaks++; console.log('  ✓ break caught'); } };
catches({ playSound: (e, k, r) => Sh.playSound(e, k === 'hurt' ? 'death' : k, r) });
catches({ playSound: (e, k, r) => Sh.playSound(Object.assign({}, e, { shulkerPeek: 100 }), k, r) });
catches({ SOUNDS: Object.assign({}, Sh.SOUNDS, { death: 'entity.shulker.nope' }) });
catches({ tickAmbient: () => {} });
if (rollsRiding(shSrc.replace(/(Sh\.tickAmbient\(e, rand\);[^\n]*\n)(\s*if \(e\.vehicle\) return;\n)/, '$2$1'))) fails.push('vehicle mutation not caught'); else { breaks++; console.log('  ✓ break caught'); }
ok(breaks === 5, 'all 5 mutations detected');

console.log(`shulkersoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  x ' + f);
process.exit(fails.length ? 1 : 0);
