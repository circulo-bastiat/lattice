#!/usr/bin/env node
// riderheightcheck -- #3846: Undead.riderHeightOffset per type vs getHeightOffset (ZombieEntity/ZombifiedPiglinEntity/AbstractSkeletonEntity).
import { loadEngine } from './loadsrc.mjs';
const NS = loadEngine({ extra: ['07s_raid.js', '07zk_undead.js'], dom: false });
const U = NS.Undead;
const table = [['zombie', 0, 0.0], ['zombie', -24000, 0.0], ['zombified_piglin', 0, -0.45], ['zombified_piglin', -24000, -0.05],
  ['zombie_villager', 0, -0.45], ['zombie_villager', -24000, 0.0], ['skeleton', 0, -0.6], ['pig', 0, 0.0]];
const bad = () => table.filter(([t, g, w]) => t === 'zombie' && g === 0 ? false : Math.abs(U.riderHeightOffset({ type: t, growAge: g }) - w) > 1e-9);
const fails = []; let pass = 0, breaks = 0;
if (bad().length === 0) pass++; else fails.push('offsets differ: ' + JSON.stringify(bad()));
const saved = U.riderHeightOffset;
U.riderHeightOffset = (r) => saved(r) + (r.type === 'zombified_piglin' ? 0.05 : 0);
if (bad().length > 0) breaks++;
U.riderHeightOffset = saved;
if (breaks === 1) pass++; else fails.push('corruption not caught');
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `riderheightcheck: ${pass} passed, 0 failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
