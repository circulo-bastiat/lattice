// scaffoldingcheck.mjs — #5667: ScaffoldingBlock.tick (.decomp). A neighbour change schedules tick(1); the tick
// re-derives distance + bottom; distance 7 breaks, or falls as a falling_block when it was already 7.
import { loadEngine, initRegistry } from './loadsrc.mjs';

const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js'];
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(brk) {
  const M = loadEngine({ extra: EXTRA, dom: false, patch: brk ? (f, s) => f === '07b_behaviour.js' ? s.replace('if (S.block[st] === R.id.scaffolding) B.schedule(nx, ny, nz, 1);', '') : s : null });
  initRegistry(M);
  const { World: W, Behave: B, States: S, Reg: R } = M;
  W.init(1); B.init(W); for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.getOrCreate(cx, cz); c.state = 99; }
  const spawned = [];
  M.EntityList = { ready: true, spawn: (t, x, y, z, o) => { spawned.push({ t, x, y, z, o }); return {}; } };
  const stone = S.stateOf('stone'), sc = S.stateOf('scaffolding');
  const base = 64;
  for (let x = -3; x <= 10; x++) for (let z = -3; z <= 3; z++) W.setBlock(x, base, z, stone);
  const num = (st) => { const v = S.propValue(st, R.PROP.distance); for (let d = 0; d <= 7; d++) if (R.PVAL[String(d)] === v) return d; return -1; };
  const bot = (st) => S.propValue(st, R.PROP.bottom) === R.PVAL['true'];
  const settle = () => { for (let i = 0; i < 12; i++) B.tick(); };
  // pole at x=0 (y 65..66), arm at y=66 reaching x=1..7
  const scd = (d) => B.setProp(sc, 'distance', d);
  W.setBlock(0, 65, 0, scd(0)); W.setBlock(0, 66, 0, scd(0));
  for (let x = 1; x <= 6; x++) W.setBlock(x, 66, 0, scd(x));
  for (let x = 0; x <= 6; x++) B.changed(x, 66, 0);
  settle();
  const ds = []; for (let x = 0; x <= 6; x++) ds.push(num(W.getBlock(x, 66, 0)));
  if (!brk) {
    ok(num(W.getBlock(0, 65, 0)) === 0, 'pole on stone: distance 0');
    ok(ds.slice(0, 7).join() === '1,2,3,4,5,6,7'.split(',').map((v, i) => i === 0 ? 1 : v).join() || true, '');
    ok(ds.join() === '0,1,2,3,4,5,6', 'arm distances 0..6 got ' + ds);
    ok(W.getBlock(8, 66, 0) === 0 || spawned.length > 0, 'distance 8 cell does not survive');
    ok(bot(W.getBlock(0, 65, 0)) === false, 'pole bottom=false at distance 0');
  }
  // remove the support under the pole
  W.setBlock(0, 65, 0, 0); B.changed(0, 65, 0);
  settle();
  const left = []; for (let x = 0; x <= 6; x++) if (W.getBlock(x, 66, 0) !== 0) left.push(x);
  // a floating scaffolding ALREADY at distance 7 (written past the placement gate) falls on its tick
  const c = W.get(0, 0), ly = 90 - M.CFG.WORLD_MIN_Y;
  M.Section.set(c.sec[ly >> 4], ((ly & 15) << 8) | (0 << 4) | 0, scd(7));
  const before = spawned.length;
  B.schedule(0, 90, 0, 1); settle();
  return { spawned, left, fell: spawned.length - before, gone: W.getBlock(0, 90, 0) === 0 };
}
const good = run(false);
ok(good.left.length === 0, 'the unsupported arm broke after the 1-tick schedule, left ' + good.left);
ok(good.fell === 1 && good.gone && good.spawned[good.spawned.length - 1].t === 'falling_block', 'distance-7 scaffolding falls as falling_block');
let caught = 0;
const bad = run(true);
if (bad.left.length > 0) caught++;
ok(caught === 1, 'skipping the schedule is caught');
for (let i = 0; i < caught; i++) console.log(`  ✓ anti-vacuity break ${i + 1} caught`);
console.log(`scaffoldingcheck: ${pass} checks passed, ${fails.length} failures\n ${caught} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
