#!/usr/bin/env node
// fish11651check.mjs — #11651: proves 07zj_fish.js EntityGroup(AQUATIC filter)/CodEntity/SalmonEntity/PufferfishEntity/
// TropicalFishEntity are REACHED from real entry points (07i_entitylist spawn-init + tickMob, 07l_spawn rules, 14l_use bucket)
// and that cutting each behaviour breaks a scenario. SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07zj_fish.js'], dom: false, patch: patch ? (f, s) => (f === '07zj_fish.js' ? patch(s) : s) : undefined });
  const F = M.Fish, o = {};
  o.types = F.isFishType('cod') && F.isFishType('salmon') && F.isFishType('pufferfish') && F.isFishType('tropical_fish') && !F.isFishType('squid');
  o.bucket = F.bucketItemFor('cod') === 'cod_bucket' && F.bucketItemFor('salmon') === 'salmon_bucket' &&
    F.bucketItemFor('pufferfish') === 'pufferfish_bucket' && F.bucketItemFor('tropical_fish') === 'tropical_fish_bucket' && F.bucketItemFor('cow') === null;
  const mk = (type) => ({ type, x: 1, y: 60, z: 1, width: 0.5, height: 0.3 });
  // schooling: cod/salmon/tropical join a leader, pufferfish does not
  const pack = {}; const a = mk('cod'), b = mk('cod');
  F.spawnInit(a, { packData: pack }); F.spawnInit(b, { packData: pack });
  o.school = pack.fishLeader === a && b.fishLeader === a && a.fishGroupSize === 2;
  const p = mk('pufferfish'); F.spawnInit(p, { puffState: 5 });
  o.puff = p.puffState === 2;
  const p0 = mk('pufferfish'); F.spawnInit(p0, {});
  const s = mk('salmon'); F.spawnInit(s, {});
  o.nopuff = p0.puffState === 0 && s.puffState === undefined && s.fishLeader === null;
  const t = mk('tropical_fish'); F.spawnInit(t, {});
  o.variant = typeof t.variant === 'number' || typeof t.fishVariant === 'number' || Object.keys(t).some((k) => /variant/i.test(k));
  // EntityGroup.AQUATIC: pufferfish does not sting aquatic mobs, stings land mobs, always axolotl
  o.group = !F.isBlowUpTarget({ type: 'cod', health: 3 }) && !F.isBlowUpTarget({ type: 'guardian', health: 3 }) &&
    F.isBlowUpTarget({ type: 'zombie', health: 20 }) && F.isBlowUpTarget({ type: 'axolotl', health: 14 });
  // canSpawn depth window (WaterCreatureEntity.canSpawn)
  const wst = M.States.stateOf('water'); M.World = { getBlock: () => wst };
  o.spawnwin = F.canSpawn(0, 70, 0, 63) === false && F.canSpawn(0, 40, 0, 63) === false && F.canSpawn(0, 60, 0, 63) === true;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
const el = rd('07i_entitylist.js'), sp = rd('07l_spawn.js'), us = rd('14l_use.js');
for (const t of ['cod', 'salmon', 'pufferfish', 'tropical_fish'])
  ok(new RegExp(t + ': function \\(e, opts\\) \\{ if \\(NS\\.Fish\\) NS\\.Fish\\.spawnInit\\(e, opts\\)').test(el), 'reach: spawn-init for ' + t);
ok(/NS\.Fish\.isFishType\(e\.type\)\) NS\.Fish\.tick\(e\)/.test(el), 'reach: tickMob -> Fish.tick');
ok(/NS\.Fish\.travelMob\(e\)/.test(el), 'reach: tickMob -> Fish.travelMob');
ok(/NS\.Fish\.canSpawn\(x, y, z, Spawn\.SEA_LEVEL\)/.test(sp) && /NS\.Fish\.tropicalCanSpawn\(/.test(sp), 'reach: Spawn rules call Fish.canSpawn/tropicalCanSpawn');
ok(/NS\.Fish\.bucketItemFor\(e\.type\)/.test(us), 'reach: Use.entityUse -> Fish.bucketItemFor');
const BR = [
  ['types', "t === 'pufferfish' || t === 'tropical_fish'; }\n  Fish.isFishType", "t === 'pufferfish'; }\n  Fish.isFishType", ['types']],
  ['bucket', "case 'cod': return 'cod_bucket';", "case 'cod': return null;", ['bucket']],
  ['school', "Fish.SCHOOLING = { cod: true, salmon: true, tropical_fish: true };", "Fish.SCHOOLING = { };", ['school']],
  ['puffclamp', "Math.min(opts.puffState | 0, 2)", "Math.min(opts.puffState | 0, 9)", ['puff']],
  ['aquatic', "return other.type === 'axolotl' || !isAquaticType(other.type);", "return true;", ['group']],
  ['depth', "if (y < sl - 13 || y > sl) return false;", "", ['spawnwin']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`fish11651check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
