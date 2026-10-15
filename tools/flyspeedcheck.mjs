#!/usr/bin/env node
// flyspeedcheck.mjs — #2034: every Fl.FLYING_SPEED entry must match a .decomp `field_23720` (flying_speed) user.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07q_effects.js', '14j_combat.js', '07k_goals.js', '07l_spawn.js',
  '07m_breed.js', '07n_tame.js', '07t_fly.js'] });

const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const users = new Set();
for (const f of walk(join(ROOT, '.decomp/net/minecraft/entity')))
  if (f.endsWith('Entity.java') && readFileSync(f, 'utf8').includes('field_23720'))
    users.add(basename(f).replace('Entity.java', '').toLowerCase());

const check = table => Object.keys(table).filter(k => !users.has(k)).concat([...users].filter(k => !(k in table) && ['parrot','bee','wither'].includes(k)));
let breaks = 0;
const bad = check(M.Fly.FLYING_SPEED);
if (bad.length) { console.log('FAIL: FLYING_SPEED mismatch vs .decomp field_23720: ' + bad); process.exit(1); }
if (!check({ ...M.Fly.FLYING_SPEED, ghast: 10 }).includes('ghast')) { console.log('FAIL: ghast break not caught'); process.exit(1); }
breaks++; console.log('✓ ghast break caught');
if (!check({ parrot: 0.4, bee: 0.6 }).includes('wither')) { console.log('FAIL: missing-wither break not caught'); process.exit(1); }
breaks++; console.log('✓ missing-wither break caught');
console.log(`flyspeedcheck: ${Object.keys(M.Fly.FLYING_SPEED).length} entries ok, ${breaks} breaks caught`);
console.log(`flyspeedcheck: ${Object.keys(M.Fly.FLYING_SPEED).length + breaks} assertions, 0 failures`);
