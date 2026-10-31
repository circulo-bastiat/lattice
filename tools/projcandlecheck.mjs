#!/usr/bin/env node
// projcandlecheck.mjs - #8664: AbstractCandleBlock.onProjectileHit - a burning projectile lights candles and candle cakes.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
          '14f_inventory.js', '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js',
          '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js'], dom: false });
initRegistry(M);
const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; },
            get: () => null, getLight: () => 240, heightAt: () => 63, chunks: new Map() };
const S = M.States, R = M.Reg, Cb = M.Combat;
const colours = ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
const names = ['candle', ...colours.map(c => c + '_candle')];
const withLit = (n, v, extra) => { let st = S.withProp(S.stateOf(n), R.PROP.lit, R.PVAL[v ? 'true' : 'false']); if (extra) st = S.withProp(st, R.PROP.waterlogged, R.PVAL['true']); return st; };
const isLit = st => S.withProp(st, R.PROP.lit, R.PVAL['true']) === st;
const hit = (st, fire) => { cells.set(k(0, 0, 0), st); Cb.projectileBlockHit({ type: 'arrow', isOnFire: fire }, { state: st, cx: 0, cy: 0, cz: 0, face: 1, hx: .5, hy: 1, hz: .5 }); return cells.get(k(0, 0, 0)); };
const run = () => {
  const out = [];
  for (const n of [...names, ...names.map(x => x === 'candle' ? 'candle_cake' : x.replace('_candle', '_candle_cake'))]) {
    const un = withLit(n, false);
    out.push([n + ' burning lights', isLit(hit(un, true))]);
    out.push([n + ' plain arrow does nothing', hit(un, false) === un]);
  }
  const lit = withLit('candle', true); out.push(['lit candle stays lit', hit(lit, true) === lit]);
  const wl = withLit('candle', false, true); out.push(['waterlogged candle follows AbstractCandleBlock (lit)', isLit(hit(wl, true))]);
  return out;
};
console.log('projcandlecheck - AbstractCandleBlock.onProjectileHit');
let res = run(); for (const [m, c] of res) ok(c, m);
ok(res.length === 70, 'covers 17 candles + 17 cake variants + lit + waterlogged (' + res.length + ')');
ok(typeof Cb.PROJ_BLOCK_HIT.candleLight === 'function', 'handler found, not a no-op');
// anti-vacuity: with the handler removed the lighting cases must go red
const real = Cb.PROJ_BLOCK_HIT.candleLight; Cb.PROJ_BLOCK_HIT.candleLight = () => -1;
const bad = run().filter(([, c]) => !c).length; Cb.PROJ_BLOCK_HIT.candleLight = real; breaks++;
ok(bad >= 34, 'handler removed turns the lighting cases red (' + bad + ')');
if (fails.length) { console.log('FAIL\n  ' + fails.slice(0, 20).join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
