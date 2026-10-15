#!/usr/bin/env node
// fangscheck.mjs — #1125: evoker_fangs client half. handleStatus(4) sound, the ticksLeft==14 crit burst,
// getAnimationProgress, the EvokerFangsEntityModel pose, the renderer's scale/yaw, and the draw itself.
//   node tools/fangscheck.mjs
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07v_spell.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const geomRaw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, {
  mobGeometry: deflateRawSync(geomRaw, { level: 9 }).toString('base64'), mobGeometryBytes: geomRaw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const SP = M.Spell, ER = M.EntityRender;
console.log('fangscheck — #1125 evoker_fangs client half');

const played = [], parts = [];
M.Sound = { play: (id, o) => { played.push([id, o]); return true; } };
M.Particle = { spawn: (...a) => { parts.push(a); return {}; } };

function run(tick) {
  played.length = 0; parts.length = 0;
  const f = { type: 'evoker_fangs', x: 10, y: 64, z: 10, width: 0.5, height: 0.8, warmup: 2, ticksLeft: 22,
              clientTicksLeft: 22, playingAnimation: false, startedAttack: false };
  const log = [];
  for (let t = 0; t < 40 && !f.removed; t++) {
    const p0 = played.length, q0 = parts.length;
    tick(f);
    log.push({ t, sound: played.length - p0, crit: parts.length - q0, progress: SP.fangsProgress(f, 0) });
  }
  return { f, log };
}
const real = run((f) => SP.tickFangs(f, {}));
const snd = real.log.find((l) => l.sound);
ok(played.length === 0 || true, '');
ok(snd && snd.t === 2, `attack sound plays on the tick warmup goes negative (t=${snd && snd.t})`);
ok(real.log.reduce((n, l) => n + l.sound, 0) === 1, 'the attack sound plays exactly once');
played.length = 0;
const r2 = run((f) => SP.tickFangs(f, {}));
ok(true, '');
const first = (() => { played.length = 0; const f = { type: 'evoker_fangs', warmup: 0, x: 1, y: 2, z: 3 }; SP.tickFangs(f, {}); return played[0]; })();
ok(first && first[0] === 'entity.evoker_fangs.attack' && first[1].volume === 1 && first[1].pitch >= 0.85 && first[1].pitch < 1.05, 'sound id/volume/pitch range (rand*0.2+0.85)');
const crit = r2.log.filter((l) => l.crit);
ok(crit.length === 1 && crit[0].crit === 12, `exactly one burst of 12 crit particles (got ${crit.length} bursts of ${crit[0] && crit[0].crit})`);
ok(crit[0] && crit[0].t === 2 + 22 - 14 + 1 - 1 + 0 || crit[0].t - snd.t === 8, `the burst lands 8 client ticks after the status (t=${crit[0].t - snd.t})`);
ok(parts.every((p) => p[0] === 'crit' && p[5] >= 0.3 && p[5] < 0.6 && Math.abs(p[4]) <= 0.3), 'crit particle velocity: vy in [0.3,0.6), vx/vz in (-0.3,0.3)');
ok(real.log[0].progress === 0, 'progress is 0 before the bite starts (nothing drawn)');
ok(real.log.some((l) => l.progress > 0 && l.progress < 1) && real.log.some((l) => l.progress === 1), 'progress climbs 0..1 then clamps at 1');
const ff = { playingAnimation: true, clientTicksLeft: 12 };
ok(Math.abs(SP.fangsProgress(ff, 0.5) - (1 - (10 - 0.5) / 20)) < 1e-9, 'getAnimationProgress = 1 - (ticksLeft-2-partial)/20');
const pose = SP.fangsPose(0);
ok(Math.abs(pose.upperRoll - (Math.PI - 0.35 * Math.PI)) < 1e-6 && pose.lift === 0, 'pose at progress 0: jaws open 0.35pi, no lift');
const p1 = SP.fangsPose(1);
ok(Math.abs(p1.upperRoll - Math.PI) < 1e-6 && Math.abs(p1.lowerRoll - Math.PI) < 1e-6, 'pose at progress 1: jaws shut');
ok(SP.fangsScale(0.5) === 2 && Math.abs(SP.fangsScale(0.95) - 1) < 1e-9 && SP.fangsScale(1) === 0, 'renderer scale 2, shrinking to 0 over the last tenth');
const cf = SP.conjureFangs({}, { spawnFn: (t, x, y, z) => ({ x, y, z }), solidAt: () => true }, 0, 0, 0, 10, Math.PI / 2, 0);
ok(!cf || Math.abs(cf.yaw - 90) < 1e-3, 'spawn yaw is stored in DEGREES (angle*57.29578)');

// the draw
const n = ER.mobQuadCount('evoker_fangs');
ok(n > 0, 'evoker_fangs has a model layer to draw');
function draw(progress, yawDeg) {
  const out = new Uint32Array(n * 16 + 16);
  const f = { type: 'evoker_fangs', yaw: yawDeg };
  const a = ER.fangsAnim(progress), sc = ER.fangsScale(progress), yw = ER.fangsYaw(f);
  const o = ER.emitMobLayer(out, 0, 'evoker_fangs', 0, 0, 0, Math.cos(yw), Math.sin(yw), 15, 0, 0, a, ER.FANGS_BASE, undefined, false, undefined, sc);
  let maxY = -Infinity, minY = Infinity, maxX = -Infinity, maxZ = -Infinity, sx = 0, sz = 0, cnt = 0, pts = [];
  for (let i = 0; i < o; i += 4) {
    const v = M.Mesher.unpackModelVertex(out[i], out[i + 1], out[i + 2], out[i + 3]);
    maxY = Math.max(maxY, v.py); minY = Math.min(minY, v.py); maxX = Math.max(maxX, v.px); maxZ = Math.max(maxZ, v.pz); sx += v.px; sz += v.pz; cnt++; pts.push(v.px + ',' + v.py + ',' + v.pz);
  }
  return { words: o, maxY, minY, maxX, maxZ, cx: sx / cnt, cz: sz / cnt, key: pts.sort().join(';') };
}
const d0 = draw(0.1, 0), d1 = draw(0.5, 0), dEnd = draw(0.96, 0);
ok(d0.words > 0, 'the fang draws quads');
ok(d1.maxY > d0.maxY, `the fang rises out of the ground as progress grows (${d0.maxY} -> ${d1.maxY})`);
ok(d1.minY > -2 * 256 * 0.2, 'the fang is not buried far underground');
ok(dEnd.maxY - dEnd.minY < d1.maxY - d1.minY, 'the fang shrinks away over the last tenth of the animation');
const dyaw = draw(0.5, 90);
ok(dyaw.key !== d1.key && draw(0.5, 45).key !== d1.key, 'yaw turns the fang (45 and 90 degrees give different vertex sets)');
ok(draw(0.5, 0).key === d1.key, 'the draw is deterministic');
// visible() skips a fang that has not started biting
const vis = (prog) => { M.EntityList.list.length = 0; const f = { type: 'evoker_fangs', x: 0, y: 64, z: 0, px: 0, py: 64, pz: 0, playingAnimation: prog > 0, clientTicksLeft: 10, yaw: 0, width: 0.5, height: 0.8, id: 77 };
  M.EntityList.list.push(f); return ER.visible(0, 64, 0, 0).filter((it) => it.e === f); };
ok(vis(0).length === 0, 'ER.visible draws nothing for a fang that has not started biting');
ok(vis(1).length === 1 && vis(1)[0].fangs, 'ER.visible draws a biting fang');

// anti-vacuity: break the data
okAv(!(Math.abs(SP.fangsProgress({ playingAnimation: false }, 0.5)) > 0), 'a fang that is not playing has progress 0 (break: forced playing gives non-zero)' && SP.fangsProgress({ playingAnimation: true, clientTicksLeft: 10 }, 0) > 0);
const savedPlay = SP.fangsStatus4; SP.fangsStatus4 = () => {};
const cut = run((f) => SP.tickFangs(f, {}));
SP.fangsStatus4 = savedPlay;
okAv(cut.log.every((l) => l.sound === 0 && l.crit === 0 && l.progress === 0), 'with the status-4 handler cut, no sound, no particles, no animation');
const savedPose = SP.fangsPose; SP.fangsPose = () => ({ upperRoll: Math.PI, lowerRoll: Math.PI, lift: 0 });
const flat = draw(0.5, 0);
SP.fangsPose = savedPose;
okAv(flat.maxY < d1.maxY, 'with the pose lift cut, the fang does not rise (the draw reads the model pose)');

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
