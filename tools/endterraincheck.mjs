#!/usr/bin/env node
// endterraincheck.mjs — #258 (G27e): the End's terrain and features (src/04za_end.js).
// Facts come from the shipped noise_settings/end.json and the decomp (EndSpikeFeature, EndPortalFeature, EndGatewayFeature,
// ChorusFlowerBlock.generate). There is no real-server End golden on disk (tools/golden has the Nether only), so the density
// values are a regression pin, like netherterraincheck's were before its golden.
//   node tools/endterraincheck.mjs
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('endterraincheck -- #258, End terrain + spikes + podium + gateway + chorus');

const SEED = 12345n;
const mkWorld = () => { const m = new Map(); return { m, get: (x, y, z) => m.get(x + ',' + y + ',' + z) || 0, set: (x, y, z, s) => m.set(x + ',' + y + ',' + z, s) }; };

function audit(M, over) {
  const E = M.EndTerrain; E.init(SEED); if (over) over(E);
  const B = E.state().B, R = {};
  const ns = M.WG.get('noise_settings', 'end');
  R.data = ns.sea_level === 0 && ns.aquifers_enabled === false && ns.ore_veins_enabled === false && E.SEA === ns.sea_level &&
    ns.noise.size_horizontal === 2 && ns.noise.size_vertical === 1 && ns.noise.height === 128 && ns.noise.min_y === 0 &&
    ns.noise.top_slide.target === -23.4375 && ns.noise.top_slide.size === 64 && ns.noise.top_slide.offset === -46 &&
    ns.noise.bottom_slide.target === -0.234375 && ns.noise.bottom_slide.size === 7 && ns.noise.bottom_slide.offset === 1 &&
    ns.default_block.Name === 'minecraft:end_stone' && E.HEIGHT === ns.noise.height;
  // islands term: EndIslands = (getNoiseAt - 8) / 128, bounded by [-0.84375, 0.5625]-ish range
  R.isl0 = Math.abs(E.islands(0, 0) - (80 - 8) / 128) < 1e-9;
  let lo = 1, hi = -1; for (let x = -3000; x <= 3000; x += 97) for (let z = -3000; z <= 3000; z += 89) { const v = E.islands(x, z); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  R.islFar = lo < -0.5 && lo >= -0.84375 && hi <= 0.5625;
  // terrain: central island solid with a top ~60, void gap at ring, outer islands exist
  const c = E.generate(0, 0), col = []; for (let y = 0; y < 128; y++) if (c.blocks[E.IDX(8, y, 8)] === B.end_stone) col.push(y);
  R.center = col.length > 20 && col[col.length - 1] >= 55 && col[col.length - 1] <= 70 && c.blocks.every((s) => s === 0 || s === B.end_stone);
  R.biome = c.biomes[0] === 'the_end';
  let outer = 0; for (let cx = 40; cx < 80; cx++) for (let cz = -20; cz < 20; cz++) { for (const v of E.fillTerrain(cx, cz)) if (v) { outer++; break; } }
  R.outer = outer > 50;
  R.deterministic = E.fillTerrain(3, -5).join() === E.fillTerrain(3, -5).join();
  // spikes: the ring is the dragon fight's ring
  const sp = E.spikes(SEED), ring = M.EnderDragon.buildCrystalRing(SEED);
  R.spikes = sp.length === 10 && sp.every((s, i) => s.centerX === ring[i].x && s.centerZ === ring[i].z && s.radius === ring[i].radius &&
    s.height === ring[i].height && s.guarded === ring[i].guarded) && sp.filter((s) => s.guarded).length === 2 &&
    sp.map((s) => s.height).sort((a, b) => a - b).join() === [76, 79, 82, 85, 88, 91, 94, 97, 100, 103].join();
  const w = mkWorld(), spike = sp.find((s) => s.guarded) || sp[0], cr = E.generateSpike(w, spike, null, {});
  R.spikeBlocks = w.get(spike.centerX, spike.height, spike.centerZ) === B.bedrock && w.get(spike.centerX + 1, spike.height - 1, spike.centerZ) === B.obsidian &&
    w.get(spike.centerX, spike.height + 6, spike.centerZ) === 0 && cr.y === spike.height + 1 &&
    M.States.name(w.get(spike.centerX + 2, spike.height + 3, spike.centerZ + 2)) === 'iron_bars' && M.States.name(w.get(spike.centerX, spike.height + 3, spike.centerZ)) === 'iron_bars' && w.get(spike.centerX, spike.height + 3, spike.centerZ) !== B.iron_bars;
  const w2 = mkWorld(), ng = sp.find((s) => !s.guarded) || sp[0]; E.generateSpike(w2, ng, null, {});
  R.unguarded = w2.get(ng.centerX + 2, ng.height + 3, ng.centerZ + 2) === 0;
  // podium
  const p = mkWorld(); E.generatePortal(p, 0, 63, 0, false);
  R.podium = p.get(1, 63, 0) === 0 && p.get(0, 63, 0) === B.bedrock && p.get(0, 64, 0) === B.bedrock && p.get(0, 66, 0) === B.bedrock && p.get(0, 67, 0) === 0 && p.get(0, 62, 0) === B.bedrock &&
    p.get(3, 63, 0) === B.bedrock && p.get(0, 62, 3) === B.end_stone && p.get(1, 65, 0) === M.States.withProp(B.wall_torch, M.Reg.PROP.facing, M.Reg.PVAL.east);
  const po = mkWorld(); E.generatePortal(po, 0, 63, 0, true);
  R.podiumOpen = po.get(1, 63, 0) === B.end_portal && po.get(0, 63, 0) === B.bedrock;
  // gateway
  const gw = mkWorld(); E.generateGateway(gw, 10, 70, 10);
  R.gateway = gw.get(10, 70, 10) === B.end_gateway && gw.get(10, 72, 10) === B.bedrock && gw.get(10, 71, 10) === B.bedrock && gw.get(11, 71, 10) === B.bedrock &&
    gw.get(11, 72, 10) === 0 && gw.get(11, 70, 11) === 0 && gw.get(11, 70, 10) === 0;
  // chorus
  const cw = mkWorld(); for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) cw.set(x, 60, z, B.end_stone);
  const rnd = new M.Noise.LegacyRandom(7n);
  R.chorusGrow = E.generateChorus(cw, rnd, 0, 61, 0);
  let plants = 0, flowers = 0, inR = true; for (const [k, s] of cw.m) { const [x, y, z] = k.split(',').map(Number);
    if (s === B.chorus_flower || M.States.name(s) === 'chorus_flower') flowers++;
    if (M.States.name(s) === 'chorus_plant') { plants++; if (Math.abs(x) >= 9 || Math.abs(z) >= 9) inR = false; } }
  R.chorus = plants >= 2 && flowers >= 1 && inR && cw.get(0, 61, 0) !== 0;
  const nw = mkWorld(); R.chorusNeedsStone = !E.generateChorus(nw, new M.Noise.LegacyRandom(7n), 0, 61, 0);
  return R;
}

const M = loadEngine({ extra: ['07zzl_enderdragon.js'] });
const R = audit(M);
for (const k of Object.keys(R)) ok(R[k], 'good: ' + k);

// ── anti-vacuity: each break edits the real behaviour and must flip its assertion ───────────────
const cut = (name, over, keys) => { const r = audit(M, over); const caught = keys.some((k) => !r[k]); if (caught) { breaks++; console.log('  ✓ break caught: ' + name); } else fails.push('break not caught: ' + name); };
const ES = M.EndTerrain;
const origSlide = ES.slide, origIsl = ES.islands, origSpikes = ES.spikes, origPortal = ES.generatePortal, origGw = ES.generateGateway, origChorus = ES.generateChorus;
const restore = () => { ES.slide = origSlide; ES.islands = origIsl; ES.spikes = origSpikes; ES.generatePortal = origPortal; ES.generateGateway = origGw; ES.generateChorus = origChorus; };
cut('no bottom slide', (E) => { E.slide = (v) => v; }, ['center']); restore();
cut('islands off by 8', (E) => { const f = E.islands; E.islands = (x, z) => f(x, z) + 8 / 128; }, ['isl0']); restore();
cut('islands: wrong centre value', (E) => { E.islands = (x, z) => origIsl(x, z) * 0.5; }, ['isl0']); restore();
cut('spike order', (E) => { const f = E.spikes; E.spikes = (s) => f(s).reverse(); }, ['spikes']); restore();
cut('no guard cage', (E) => { const f = E.spikes; E.spikes = (s) => f(s).map((x) => ({ ...x, guarded: false })); }, ['spikes', 'spikeBlocks']); restore();
cut('podium torches gone', (E) => { const f = E.generatePortal; E.generatePortal = (w, x, y, z, o) => { f(w, x, y, z, o); w.set(x + 1, y + 2, z, 0); }; }, ['podium']); restore();
cut('gateway bedrock gone', (E) => { const f = E.generateGateway; E.generateGateway = (w, x, y, z) => { f(w, x, y, z); w.set(x, y + 2, z, 0); }; }, ['gateway']); restore();
cut('chorus on any floor', (E) => { E.generateChorus = () => false; }, ['chorusGrow', 'chorus']); restore();

for (const f of fails) console.log('  FAIL ' + f);
console.log(`endterraincheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
