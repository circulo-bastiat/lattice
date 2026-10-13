// fluidpushcheck.mjs - #4429: Entity.updateMovementInFluid. A flowing-water cell pushes an item
// toward its downhill neighbour (0.014/tick); a turtle (isPushedByFluids=false) is not pushed.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '08_lighting.js', '14b_physics.js'], dom: false });
initRegistry(M);
const W = M.World, Ph = M.Physics, SR = M.States, R = M.Reg, CH = M.CH;
W.init(3); M.Light.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) W.getOrCreate(cx, cz).state = CH.GENERATED;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const lvl = (n) => SR.withProp(SR.stateOf('water'), R.PROP.level, R.PVAL[String(n)]);
const STONE = SR.stateOf('stone'), AIR = 0;
function build(src) {
  for (let x = -2; x <= 4; x++) { W.setBlock(x, 29, 0, STONE); W.setBlock(x, 30, 0, AIR); W.setBlock(x, 31, 0, AIR); W.setBlock(x, 30, 1, AIR); W.setBlock(x, 30, -1, AIR); }
  W.setBlock(0, 30, 0, src); W.setBlock(1, 30, 0, lvl(1));
}
const ent = (type) => ({ type, x: 1.5, y: 30, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.25, height: 0.25 });
build(lvl(0));
const item = ent('item'), turtle = ent('turtle'), cow = ent('cow'); cow.width = 0.9; cow.height = 1.4;
Ph.fluidPush(item); Ph.fluidPush(turtle); Ph.fluidPush(cow);
ok(item.vx > 0.004 && Math.abs(item.vz) < 1e-9, `item should drift +x, vx=${item.vx}`);
ok(Math.abs(item.vx - 0.0045) < 1e-9 || Math.abs(item.vx - 0.014) < 1e-9, `item push magnitude ${item.vx}`);
ok(turtle.vx === 0 && turtle.vz === 0, `turtle pushed: ${turtle.vx}`);
ok(cow.vx > 0, `cow vx=${cow.vx}`);
const dry = ent('item'); dry.y = 40; Ph.fluidPush(dry);
ok(dry.vx === 0, 'item out of water must not move');
// anti-vacuity: break the data (flat water: both cells source) and the push must vanish; un-exempt the turtle and it must move
build(lvl(0)); W.setBlock(1, 30, 0, lvl(0));
const flat = ent('item'); Ph.fluidPush(flat); breaks++; ok(flat.vx === 0, `flat water pushed an item: ${flat.vx}`);
build(lvl(0)); delete Ph.NOT_PUSHED.turtle;
const t2 = ent('turtle'); Ph.fluidPush(t2); breaks++; ok(t2.vx > 0, 'turtle exemption not what stops the push');
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught` + (fails.length ? '\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
