#!/usr/bin/env node
// saddlesoundcheck.mjs — #3167: PigEntity.saddle / AbstractHorseEntity.saddle play
// entity.pig.saddle / entity.horse.saddle, NEUTRAL, volume 0.5, pitch 1 (.decomp). Breaks its own data (D-30).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07q_effects.js', '07r_mount.js', '07ze_llama.js', '07w_passive.js'],
});
const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Breed.init(); M.Tame.init(); M.Mount.init();
if (M.Passive.init) M.Passive.init();
M.World.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c);
}
const log = [];
M.Sound = Object.assign(M.Sound || {}, { entitySound: (...a) => { log.push(a); } });
let fails = 0, breaks = 0;
const want = (label, ev, run, brk) => {
  for (const broken of [false, true]) {
    log.length = 0; run(broken);
    const a = log[0];
    const good = log.length === 1 && a[0] === ev && a[5] === 1 && a[4] === 0.5 && a[6] === 'neutral';
    if (!broken) { if (!good) { fails++; console.log('FAIL ' + label, JSON.stringify(log)); } }
    else if (good) { fails++; console.log('FAIL anti-vacuity ' + label); } else breaks++;
  }
};
want('pig', 'entity.pig.saddle', (b) => {
  const p = M.EntityList.spawn('pig', 0, 64, 0); if (b) p.silent = true; M.Passive.pigSaddle(p);
});
want('horse', 'entity.horse.saddle', (b) => {
  const h = M.EntityList.spawn('horse', 2, 64, 0); h.tamed = true; if (b) h.silent = true; M.Mount.saddle(h);
});
console.log(`${breaks * 2 - fails} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
