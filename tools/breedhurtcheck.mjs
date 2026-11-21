#!/usr/bin/env node
// breedhurtcheck.mjs -- #3521: AnimalEntity.damage (.decomp AnimalEntity.java:75-82) sets loveTicks=0 on a
// non-invulnerable hit. Split from breedcheck because loading Combat makes the idle test cow take real damage.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

const M = loadEngine({
  // ⚠ `02g_items.js` IS HERE FOR ONE ASSERTION AND IT EARNS ITS PLACE: §6 resolves a held
  // stack through the REAL item registry, which is the only way to prove the live player's
  // `heldItem()` shape reaches `Breed.isFood` as a name rather than as an object.
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '14j_combat.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
const EL = M.EntityList, Br = M.Breed;
M.Behave.init(M.World); M.Ai.init(); M.Breed.init(); M.Combat.init();
const Cb = M.Combat;
const mk = () => { const c = EL.spawn('cow', 40, 8, 0.5); Br.setInLove(c, null); return c; };
const c = mk(); ok(c.inLove > 0, 'setup: cow is in love');
Cb.hurt(c, 1, 0, true);
ok(c.inLove === 0, 'a hit resets inLove to 0');
const d = mk(); d.invulnerable = true; Cb.hurt(d, 1, 0, true);
okAv(d.inLove > 0, 'an invulnerable animal keeps its love mode');
console.log('================ breedhurtcheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
