#!/usr/bin/env node
// zpiglinspawncheck.mjs — #1223: ZombifiedPiglinEntity.canSpawn = !peaceful && floor != nether_wart_block.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
               '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js',
               '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
M.World.init(3); M.Light.init(); M.Behave.init(M.World); M.EntityList.init(); M.Spawn.init();
const { World: W, Spawn, States } = M;
const st = (n) => States.stateOf(n) | 0;
W.getOrCreate(0, 0).state = M.CH.GENERATED;

let breaks = 0, pass = 0; const fails = [];
function run(rule, tag) {
  const x = 8, y = 100, z = 8;
  const res = {};
  W.setBlock(x, y - 1, z, st('netherrack'));
  M.Diff.set && M.Diff.set('normal');
  res.rock = !!rule(x, y, z, 'natural', () => 0);
  W.setBlock(x, y - 1, z, st('nether_wart_block'));
  res.wart = !!rule(x, y, z, 'natural', () => 0);
  W.setBlock(x, y - 1, z, st('netherrack'));
  M.Diff.set && M.Diff.set('peaceful');
  res.peace = !!rule(x, y, z, 'natural', () => 0);
  M.Diff.set && M.Diff.set('normal');
  return res;
}
const good = Spawn.RULES.zombified_piglin;
if (!good) { console.log('FAIL no rule'); process.exit(1); }
const r = run(good);
const chk = (c, m) => { if (c) pass++; else fails.push(m); };
chk(r.rock === true, 'netherrack floor, normal difficulty accepts');
chk(r.wart === false, 'nether_wart_block floor refuses');
chk(r.peace === false, 'peaceful refuses');
// nether wastes monster table lists it, and Spawn.canPlace admits it
const listed = (name) => ((M.Biomes.spawners(M.Biomes.indexOf[name]) || {}).monster || [])
  .some((e) => /zombified_piglin$/.test(e.type || e.id || e.name || ''));
chk(M.Biomes.ready && listed('nether_wastes'), 'nether_wastes monster table lists zombified_piglin');
chk(!listed('plains'), 'plains monster table does not list zombified_piglin');
chk(Spawn.canPlace('zombified_piglin') === true, 'Spawn.canPlace(zombified_piglin)');
// end to end: Spawn.spawnForChunk in a nether_wastes cell places zombified_piglin (pack loop reached)
const e2e = (floor, diff) => {
  const EL = M.EntityList; EL.clear();
  M.Diff.set && M.Diff.set(diff);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    for (let y = 60; y < 70; y++) W.setBlock(x, y, z, y < 64 ? st(floor) : 0);
  }
  const bi = M.Biomes.indexOf['nether_wastes'];
  const oldB = W.biomeAt, oldH = W.heightAt, oldP = M.Player;
  W.biomeAt = () => bi; W.heightAt = () => 63;
  M.Player = Object.assign({}, oldP, { x: 60.5, y: 64, z: 8.5 });
  const oldW = Spawn.worldSpawn; Spawn.worldSpawn = () => null;
  let made = 0, seed = 1;
  const rng = { nextInt: (b) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % b; },
                nextFloat: () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) / 8388608; } };
  try {
    for (let i = 0; i < 20000 && !made; i++) made += Spawn.spawnForChunk(0, 0, 'monster', { rng, info: Spawn.setupInfo() });
  } finally { W.biomeAt = oldB; W.heightAt = oldH; M.Player = oldP; Spawn.worldSpawn = oldW; }
  const kinds = EL.list.filter((e) => !e.removed).map((e) => M.Entities.bare(e.type));
  M.Diff.set && M.Diff.set('normal');
  return kinds;
};
{
  const ok1 = e2e('netherrack', 'normal');
  chk(ok1.length > 0 && ok1.every((k) => k === 'zombified_piglin' || k === 'ghast' || k === 'magma_cube' || k === 'enderman' || k === 'strider' || k === 'piglin' || k === 'hoglin'), 'nether_wastes spawnForChunk produced ' + ok1.join());
  chk(ok1.includes('zombified_piglin'), 'nether_wastes spawnForChunk places zombified_piglin');
  const wart = e2e('nether_wart_block', 'normal');
  chk(!wart.includes('zombified_piglin'), 'nether_wart_block floor: no zombified_piglin');
  const peace = e2e('netherrack', 'peaceful');
  chk(!peace.includes('zombified_piglin'), 'peaceful: no zombified_piglin');
}
// #2008 PiglinEntity.canSpawn: wart floor refuses, peaceful does NOT (no difficulty gate)
{ const pr = Spawn.RULES.piglin; chk(!!pr, 'Spawn.RULES.piglin exists');
  if (pr) { const q = run(pr);
    chk(q.rock === true && q.wart === false && q.peace === true, 'piglin rule: rock ok, wart refuses, peaceful ok');
    const saved = Spawn.RULES.piglin; delete Spawn.RULES.piglin;
    if (Spawn.canPlace('piglin') === false) breaks++;
    Spawn.RULES.piglin = saved;
    if (run(() => true).wart === true) breaks++; } }
// breaks: sabotaged rules must be caught by the same assertions
const mutants = [
  () => true,
  (x, y, z) => !M.Diff.isPeaceful(),
  (x, y, z) => W.getBlock(x, y - 1, z) !== st('nether_wart_block'),
];
for (const m of mutants) {
  const rr = run(m);
  if (!(rr.rock === true && rr.wart === false && rr.peace === false)) breaks++;
}
{ const saved = Spawn.RULES.zombified_piglin; delete Spawn.RULES.zombified_piglin;
  if (Spawn.canPlace('zombified_piglin') === false && !listed('plains')) breaks++;
  Spawn.RULES.zombified_piglin = saved; }
{ const saved = Spawn.RULES.zombified_piglin; Spawn.RULES.zombified_piglin = () => true;
  if (e2e('nether_wart_block', 'normal').includes('zombified_piglin')) breaks++;
  Spawn.RULES.zombified_piglin = saved; }
chk(breaks >= 2, 'mutants caught: ' + breaks);
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `zpiglinspawncheck: ${pass} checks ok, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
