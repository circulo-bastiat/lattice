#!/usr/bin/env node
// petdeathmsgcheck.mjs — #8262: a tamed pet's death message uses display names + the real source key.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['01b_inflate.js', '02i_text.js', '02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '14d_survival.js', '14j_combat.js'] });
const T = M.Text;
const A = join(ROOT, 'assets');
const meta = JSON.parse(readFileSync(join(A, 'lang.meta.json'), 'utf8'));
T.init({ lang: readFileSync(join(A, 'lang.bin')).toString('base64'), langBytes: meta.rawBytes,
  langOverrides: readFileSync(join(A, 'lang-overrides.json'), 'utf8') });
let pass = 0; const fails = [];
const msg = (name, src, killer) => T.plain(T.deathMessage(T.entityDisplayName({ type: 'wolf', customName: name }),
  T.deathCauseOf(src, killer, null), killer ? T.entityDisplayName(killer) : null));
const cases = [
  ['Rex', { source: 'mob' }, { type: 'zombie' }, 'Rex was slain by Zombie'],
  [null, { source: 'mob' }, { type: 'zombie' }, 'Wolf was slain by Zombie'],
  ['Rex', { source: 'projectile' }, { type: 'skeleton' }, 'Rex was shot by Skeleton'],
  [null, { source: 'projectile' }, { type: 'skeleton' }, 'Wolf was shot by Skeleton'],
  ['Rex', { source: 'fireball' }, { type: 'ghast' }, 'Rex was fireballed by Ghast'],
  [null, { source: 'fireball' }, { type: 'ghast' }, 'Wolf was fireballed by Ghast'],
  ['Rex', { source: 'explosion' }, { type: 'creeper' }, 'Rex was blown up by Creeper'],
  [null, { source: 'explosion' }, { type: 'creeper' }, 'Wolf was blown up by Creeper']
];
for (const [n, s, k, want] of cases) { const got = msg(n, s, k); if (got === want) pass++; else fails.push(want + ' <> ' + got); }
// anti-vacuity: the raw-id path must differ from every expectation
let breaks = 0;
for (const [n, s, k, want] of cases) {
  const raw = T.plain(T.deathMessage(n || 'wolf', k ? 'mob' : 'generic', k.type));
  if (raw !== want) { breaks++; console.log('   ✓ raw-id path differs: ' + want); } else fails.push('anti-vacuity: raw path equals ' + want);
}
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
