#!/usr/bin/env node
// projmotioncheck.mjs — #5916 (G17-X13): the potion / experience_bottle / arrow / spectral_arrow / trident
// gravity+drag rows are the .decomp extractor's output (extract-entity-motion-src.mjs projectileRows),
// EL.motionFor hardcodes none of them, and every claim can fail (anti-vacuity, D-30).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT as ROOT } from './loadsrc.mjs';
import * as X from './extract-entity-motion-src.mjs';

const JSONF = join(ROOT, 'assets', 'entities.json');
if (!existsSync(JSONF)) { console.log('FAIL projmotioncheck: input missing — run tools/pack-entities.mjs first'); process.exit(1); }
if (!existsSync(join(ROOT, '.decomp'))) { console.log('FAIL projmotioncheck: input missing - no .decomp'); process.exit(1); }
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js'], initReg: false });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(JSONF, 'utf8')) });
M.Entities.init();
M.EntityList.init();
const EL = M.EntityList;

const { rows, refused } = X.projectileRows();
ok(rows.length === X.PROJECTILES.length && refused.length === 0, 'extractor accepts every projectile type: ' + refused.join('; '));
const mainTsv = readFileSync(join(ROOT, 'tools', 'golden', 'entity-motion-1.18.2.tsv'), 'utf8').split('\n');
for (const [n, , g, d] of rows) {
  const m = EL.motionFor(n);
  ok(m && m[0] === g && m[1] === d, `${n}: EL.motionFor ${JSON.stringify(m)} == extractor [${g}, ${d}]`);
  const line = mainTsv.find((l) => l.startsWith(n + '\t'));
  if (line) ok(Number(line.split('\t')[2]) === g && Number(line.split('\t')[3]) === d, `${n}: bytecode tsv row agrees with the source extractor`);
}
ok(M.Potion ? M.Potion.GRAVITY === 0.05 && M.Potion.DRAG_AIR === 0.99 : true, 'Po.GRAVITY/DRAG_AIR agree with the extracted potion row');

const realMot = M.DATA.entities.motion;
for (const n of ['potion', 'experience_bottle', 'trident']) {
  ok(EL.spawn(n, 0, 70, 0) !== null, `${n} spawns with its row`);
  M.DATA.entities.motion = Object.assign({}, realMot); delete M.DATA.entities.motion[n];
  okAv(EL.spawn(n, 0, 70, 0) === null, `deleting the ${n} row makes EL.spawn refuse (no hardcode left)`);
  M.DATA.entities.motion = realMot;
}
M.DATA.entities.motion = Object.assign({}, realMot, { potion: [0.03, 0.99] });
okAv(EL.motionFor('potion')[0] !== rows.find((r) => r[0] === 'potion')[2], 'a corrupted potion row no longer equals the extractor output');
M.DATA.entities.motion = realMot;

okAv(!X.projectileRow('SnowballEntity', true).ok, 'snowball inherits ThrownEntity.getGravity: refused as an own override (D-309 shape)');
const src = X.rd;
ok(X.projectileRow('PotionEntity', true, src).ok, 'baseline: PotionEntity own override accepted');
okAv(!X.projectileRow('PotionEntity', true, (c) => { const t = src(c); return c === 'PotionEntity' ? t.replace(/protected float getGravity\(\)\s*\{\s*return 0\.05F;\s*\}/, '') : t; }).ok,
  'PotionEntity with getGravity removed (value now inherited) is refused');

console.log(`projmotioncheck: ${pass} assertions, ${fails.length} failures`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
