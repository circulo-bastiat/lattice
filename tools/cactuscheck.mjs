#!/usr/bin/env node
// cactuscheck.mjs — #5653: CactusBlock.entityInside hurts with DamageSource.CACTUS 1.0 (Use.entityCollide).
// Static check of the cactus branch in src/14l_use.js. Anti-vacuity: breaks its own source text.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', '14l_use.js'), 'utf8');
const surv = readFileSync(join(ROOT, 'src', '14d_survival.js'), 'utf8');
const HEAD = 'R.id.cactus !== undefined && S.block[st] === R.id.cactus';
function problems(text) {
  const bad = [];
  const i = text.indexOf(HEAD);
  if (i < 0) return ['branch missing'];
  const body = text.slice(i, text.indexOf('} else if', i));
  if (!/Survival\.hurt\(e, 'cactus', 1\)/.test(body)) bad.push('player not hurt 1 cactus');
  if (!/Combat\.hurt\(e, 1, undefined, false, \{ source: 'cactus' \}\)/.test(body)) bad.push('mobs not hurt 1 cactus');
  if (text.indexOf('Use.entityCollide = function') < 0 || text.indexOf('isSpectator(e)) return;') < 0) bad.push('spectator guard missing');
  return bad;
}
const fails = problems(src);
if (!/cactus:\s*\{ bypassArmor: false, bypassInvuln: false \}/.test(surv)) fails.push('cactus damage type must not bypass armour/invuln');
let breaks = 0;
const caught = (label, text) => {
  if (problems(text).length) { breaks++; console.log('   ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
caught('branch removed', src.replace(HEAD, 'false'));
caught('damage 2', src.replace("hurt(e, 'cactus', 1)", "hurt(e, 'cactus', 2)"));
caught('mob source wrong', src.replace("source: 'cactus'", "source: 'generic'"));
caught('spectator guard gone', src.replace('isSpectator(e)) return;', 'isSpectator(e)) {}'));
console.log('\n================ cactuscheck ================');
console.log(` assertions passed .. ${5 - fails.length}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
