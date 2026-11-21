#!/usr/bin/env node
// snowlayercheck.mjs — #2330 KW-SNOW: snow layers are not full cubes. Vanilla SnowBlock (1.18.2): collision
// height (layers-1)*2px (layer 1 none), light block only at 8, isSolidRender only at 8, not a "opaque" floor
// below 8, face sturdy UP only at 8, replaceable by placement only at layer 1 (or same item). Breaks its own data.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07_world.js', '08_lighting.js'], dom: false });
const R = M.Reg, SR = M.States, sb = SR.snowBlock, lp = R.PROP.layers;
const states = []; for (let st = 0; st < SR.count; st++) if (SR.block[st] === sb) states.push(st);
const ly = (st) => +R.valueNames[SR.propValue(st, lp)];
const top = (st) => { const sh = R.shapeOf[st], a = R.shapeOff[sh], b = R.shapeOff[sh + 1]; let h = 0, n = b - a; for (let i = a; i < b; i++) h = Math.max(h, R.shapeBox[i * 6 + 4]); return [n, h]; };
function audit(t) {
  const bad = [];
  if (states.length !== 8) bad.push('8 states');
  for (const st of states) {
    const L = ly(st), [n, h] = top(st), full = L === 8, id = 'layers=' + L;
    if (h !== (L - 1) * 128 || n !== (L === 1 ? 0 : 1)) bad.push(id + ' collision');
    if (t.light(st) !== (full ? 15 : 0)) bad.push(id + ' light');
    if (SR.solidRender(st) !== full) bad.push(id + ' solidRender');
    if (t.opBase(st) !== (full ? 1 : 0)) bad.push(id + ' opaqueBase floor');
    if (SR.faceSturdy(st, 2, SR.SUPPORT_FULL) !== full) bad.push(id + ' sturdy up');
    if (SR.faceSturdy(st, 3, SR.SUPPORT_FULL) !== true) bad.push(id + ' sturdy down');
  }
  return bad;
}
const real = { light: (st) => SR.atten[st], opBase: (st) => SR.opaqueBase[st] };
const bad = audit(real);
bad.length ? (console.log('FAIL', bad.join('; ')), process.exit(1)) : console.log('  ✓ snow layers 1..8 match vanilla');
const saveOp = SR.opaqueBase.slice(), saveSolid = SR.solidRender;
let caught = 0;
const brk = (name, t) => { const b = audit(t); if (b.length) caught++; else console.log('NOT CAUGHT: ' + name); };
brk('layer 3 opaque floor', { light: real.light, opBase: (st) => (ly(st) === 3 ? 1 : SR.opaqueBase[st]) });
brk('layer 8 not floor', { light: real.light, opBase: (st) => (ly(st) === 8 ? 0 : SR.opaqueBase[st]) });
brk('light 15 at layer 2', { light: (st) => (ly(st) === 2 ? 15 : SR.atten[st]), opBase: real.opBase });
SR.solidRender = () => true; brk('solidRender all', real); SR.solidRender = saveSolid;
SR.solidRender = (st) => false; brk('solidRender none', real); SR.solidRender = saveSolid;
const sf = SR.faceSturdy; SR.faceSturdy = () => true; brk('sturdy all', real); SR.faceSturdy = sf;
console.log('snowlayercheck: ' + states.length * 6 + ' assertions, 0 failures, ' + caught + ' breaks caught'); process.exit(caught === 6 ? 0 : 1);
