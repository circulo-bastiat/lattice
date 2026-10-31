#!/usr/bin/env node
// projamethystcheck.mjs - #8666: AmethystBlock.onProjectileHit via Cb.PROJ_BLOCK_HIT (.decomp AmethystBlock.java).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
          '14f_inventory.js', '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js',
          '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js'],
  dom: false
});
initRegistry(M);
const Cb = M.Combat, fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const names = ['amethyst_block', 'budding_amethyst', 'amethyst_cluster', 'small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud', 'stone'];
const run = (n, rolls) => {
  const played = []; let i = 0;
  M.Sound = { play: (ev, o) => { played.push({ ev, pitch: o.pitch }); } };
  M.EntityList.wr = () => rolls[i++ % rolls.length];
  const st = M.States.stateOf(n);
  Cb.projectileBlockHit({ type: 'arrow' }, { state: st, cx: 1, cy: 2, cz: 3, face: 1, hx: 1.5, hy: 2.5, hz: 3.5 });
  return { played, used: i };
};
const check = () => {
  for (const n of names) {
    const r = run(n, [0.25, 0.75]);
    if (n === 'stone') { ok(r.played.length === 0 && r.used === 0, 'stone plays nothing'); continue; }
    ok(r.played.length === 2 && r.used === 2, n + ' plays exactly two events, two rolls ' + r.played.length + '/' + r.used);
    if (r.played.length === 2) {
      ok(r.played[0].ev === 'block.amethyst_block.hit' && r.played[1].ev === 'block.amethyst_block.chime', n + ' event order');
      ok(Math.abs(r.played[0].pitch - 0.8) < 1e-6 && Math.abs(r.played[1].pitch - 1.4) < 1e-6, n + ' rolls in order: ' + r.played.map(p => p.pitch));
      ok(r.played.every(p => p.pitch >= 0.5 && p.pitch < 1.7), n + ' pitch range');
    }
  }
};
console.log('projamethystcheck');
check();
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
for (const n of names.slice(0, 6)) {
  const saved = Cb.PROJ_BLOCK_HIT[n], p0 = pass; delete Cb.PROJ_BLOCK_HIT[n];
  check(); breaks++;
  const caught = fails.length > 0; fails.length = 0; pass = p0; Cb.PROJ_BLOCK_HIT[n] = saved;
  ok(caught, 'break ' + n + ' not caught');
}
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
