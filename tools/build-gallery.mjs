#!/usr/bin/env node
// build-gallery.mjs — render the whole block roster, so it can be judged by looking at it.
//
//   node tools/build-gallery.mjs [--out dist/gallery.html]
//
// PLAN F8 produces `assets/block-geometry.json` and a test suite that says it is correct.
// A test suite is not the same as seeing it. This builds a single self-contained page that
// draws every one of the 900 blocks and all 8,933 of their visual states in 3D, from the
// SAME baked quads and the SAME atlas the engine will use — so a rotation that is wrong is
// wrong on screen, where it cannot hide behind a passing assertion.
//
// It is a build artefact, not part of the game, and it deliberately shares no code with the
// engine's renderer: if both were wrong in the same way, neither would reveal it.
//
// ⚠ AND THAT INDEPENDENCE HAS A LIMIT WORTH KNOWING (PLAN §23). This page's projection negates
// Z (`out[10] = -0.15` in `mat`), which flips handedness and therefore flips WINDING — so it
// draws the baked corners in their source order and gets front faces, while the engine draws
// the same corners through a normal projection and gets back faces. For a session and a half
// the engine's model stream was wound inside out and every slab, stair and grass block in the
// game was invisible, and THIS PAGE LOOKED PERFECT THE WHOLE TIME. Two renderers can be wrong
// in opposite ways as easily as in the same way. **Do not use the gallery to judge winding**;
// `emitcheck` derives each quad's normal from its own corners and is the authority.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ASSETS = opt('assets', MCLITE_ROOT + 'assets');
const OUT = opt('out', MCLITE_ROOT + 'dist/gallery.html');
mkdirSync(dirname(OUT), { recursive: true });

const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const geom = rd('block-geometry.json');
const atlasIdx = rd('atlas-index.json');
const registry = rd('block-registry.json');
const consts = rd('block-constants.json');
const itemIdx = rd('item-atlas-index.json');
const itemReg = rd('item-registry.json');

// ── one texture, two atlases ────────────────────────────────────────────────
// The page needs the block atlas AND the item sprite atlas. Two samplers would mean a
// per-vertex flag and a branch in the fragment shader for no benefit, so they are composed
// into one image here: blocks on top, items below, and the item rows are addressed with a
// Y offset. Done at build time, where getting it wrong shows up immediately as the wrong
// picture rather than as a subtly shifted UV at runtime.
const bImg = decodePng(readFileSync(join(ASSETS, 'atlas.png')));
const iImg = decodePng(readFileSync(join(ASSETS, 'item-atlas.png')));
const CW = Math.max(bImg.width, iImg.width);
const CH = bImg.height + iImg.height;
const comp = Buffer.alloc(CW * CH * 4);
for (let y = 0; y < bImg.height; y++)
  bImg.data.copy(comp, (y * CW) * 4, y * bImg.width * 4, (y + 1) * bImg.width * 4);
for (let y = 0; y < iImg.height; y++)
  iImg.data.copy(comp, ((bImg.height + y) * CW) * 4, y * iImg.width * 4, (y + 1) * iImg.width * 4);
const atlasB64 = encodePng(CW, CH, comp, { level: 9, palette: true }).toString('base64');

// The gallery needs less than the engine: per block, its states' property maps and the
// display name. Strip everything else so the page stays openable.
const blocks = registry.map((e) => ({
  n: e.name,
  d: (consts.blocks[e.name] && consts.blocks[e.name].displayName) || e.name,
  k: e.kind === 'multipart' ? 1 : 0,
  s: e.states.map((s) => s.state),
  g: geom.states[e.name],
}));

// items: only the real ones, and only what the gallery has to draw
const items = [];
for (const [name, it] of Object.entries(itemReg.items)) {
  if (!it.real) continue;
  items.push({
    n: name, d: it.displayName, k: it.kind,
    l: it.layers ? it.layers.map((t) => itemIdx.index[t]).filter((v) => v !== undefined) : null,
    p: it.part === undefined ? null : it.part,
    ss: it.stackSize || 1, du: it.durability || 0, nt: !!it.needsTint,
    f: it.food ? [it.food.nutrition, it.food.saturation] : null,
  });
}
items.sort((a, b) => (a.k === b.k ? a.n.localeCompare(b.n) : a.k.localeCompare(b.k)));

const payload = {
  atlas: {
    tile: atlasIdx.tile,
    W: CW, H: CH,
    b: { cols: atlasIdx.cols, y0: 0 },
    i: { cols: itemIdx.cols, y0: bImg.height },
  },
  parts: geom.parts,
  iparts: itemReg.parts,
  blocks,
  items,
};

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>MC-Lite — block roster</title>
<style>
  :root{--bg:#14171c;--panel:#1c2028;--line:#2e343d;--fg:#dfe3e8;--dim:#8b939e;--acc:#6f9f5a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 "Segoe UI",Tahoma,DejaVu Sans,sans-serif;overflow:hidden}
  #top{position:fixed;inset:0 0 auto 0;height:52px;background:var(--panel);border-bottom:1px solid var(--line);
       display:flex;align-items:center;gap:12px;padding:0 14px;z-index:5}
  #top b{font-size:15px;letter-spacing:.2px}
  input[type=search]{background:#12151a;border:1px solid var(--line);color:var(--fg);padding:6px 10px;
       border-radius:3px;width:230px;font:13px inherit}
  button{background:#282e37;border:1px solid var(--line);color:var(--fg);padding:6px 11px;border-radius:3px;
       cursor:pointer;font:12px inherit}
  button:hover{background:#333b46}
  button.on{background:var(--acc);border-color:var(--acc);color:#0f130d}
  .sp{flex:1}
  #stat{color:var(--dim);font-size:12px;white-space:nowrap}
  #c{position:fixed;inset:52px 0 30px 0;width:100%;display:block}
  #foot{position:fixed;inset:auto 0 0 0;height:30px;background:var(--panel);border-top:1px solid var(--line);
       display:flex;align-items:center;gap:10px;padding:0 14px;font-size:12px;color:var(--dim);z-index:5}
  #tip{position:fixed;pointer-events:none;background:#0d0f13ee;border:1px solid var(--line);padding:6px 9px;
       border-radius:3px;font-size:12px;display:none;z-index:9;max-width:340px}
  #tip .t{color:#fff;font-weight:600}
  #tip .p{color:var(--dim);font-size:11px;word-break:break-all}
</style></head><body>
<div id="top">
  <b>MC-Lite — block roster</b>
  <input type="search" id="q" placeholder="filter blocks…" autocomplete="off">
  <button id="tBlocks" class="on">blocks</button>
  <button id="tItems">items</button>
  <span style="width:8px"></span>
  <button id="mAll" class="on">all states</button>
  <button id="mDef">one per block</button>
  <button id="mNC">non-cube only</button>
  <span class="sp"></span>
  <span id="stat"></span>
</div>
<canvas id="c"></canvas>
<div id="foot"><span id="pg"></span><span class="sp"></span>
  <span id="note"></span>
  <span>scroll to page · drag to spin · hover for the state</span></div>
<div id="tip"></div>
<script id="d" type="application/json">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
(function(){
'use strict';
var D = JSON.parse(document.getElementById('d').textContent);
var TILE = D.atlas.tile, AW = D.atlas.W, AH = D.atlas.H;
var BCOLS = D.atlas.b.cols, BY0 = D.atlas.b.y0;
var ICOLS = D.atlas.i.cols, IY0 = D.atlas.i.y0;

// ── flatten to a list of things to draw ─────────────────────────────────────
// one entry per (block, visual state). The group model is respected: every group is drawn,
// and within a group the FIRST alternative is used — the gallery is not the place for
// random variation, and showing all four would be exactly the bug meshcheck caught.
var ALL = [];
for (var b = 0; b < D.blocks.length; b++) {
  var B = D.blocks[b];
  for (var s = 0; s < B.g.length; s++) {
    var groups = B.g[s], ids = [];
    for (var g = 0; g < groups.length; g++) {
      var gg = groups[g];
      ids.push(typeof gg === 'number' ? gg : gg.a[0]);
    }
    var nq = 0; for (var i = 0; i < ids.length; i++) nq += D.parts[ids[i]].length;
    ALL.push({ b: b, s: s, ids: ids, nq: nq, cube: nq === 6 && isCube(ids) });
  }
}
function isCube(ids){
  if (ids.length !== 1) return false;
  var qs = D.parts[ids[0]];
  if (qs.length !== 6) return false;
  for (var i=0;i<qs.length;i++){ var p=qs[i].p;
    for (var k=0;k<12;k++){ if (p[k]!==0 && p[k]!==16) return false; } }
  return true;
}

var view = [], mode = 'all', tab = 'blocks', page = 0, PER = 96, spin = 0.6, tilt = 0.55, drag = null;

function rebuild(){
  var q = document.getElementById('q').value.trim().toLowerCase();
  if (tab === 'items'){
    view = D.items.filter(function(it){
      if (q && it.n.indexOf(q) < 0 && it.d.toLowerCase().indexOf(q) < 0) return false;
      if (mode === 'nc' && it.k === 'flat') return false;
      return true;
    });
    document.getElementById('stat').textContent =
      view.length.toLocaleString() + ' of ' + D.items.length.toLocaleString() + ' items · ' +
      D.iparts.length + ' 3D parts · ' + '534 sprites';
  } else {
    var seenBlock = {};
    view = ALL.filter(function(e){
      var B = D.blocks[e.b];
      if (q && B.n.indexOf(q) < 0 && B.d.toLowerCase().indexOf(q) < 0) return false;
      if (mode === 'def'){ if (seenBlock[e.b]) return false; seenBlock[e.b] = 1; }
      if (mode === 'nc' && e.cube) return false;
      return true;
    });
    document.getElementById('stat').textContent =
      view.length.toLocaleString() + ' states · ' + D.blocks.length + ' blocks · ' +
      D.parts.length.toLocaleString() + ' baked parts';
  }
  if (page * PER >= view.length) page = 0;
  draw();
}

// ── GL ──────────────────────────────────────────────────────────────────────
var cv = document.getElementById('c');
var gl = cv.getContext('webgl2', { antialias: true, alpha: false });
if (!gl) { document.body.innerHTML = '<p style="padding:40px">This page needs WebGL2.</p>'; return; }

var VS = ['#version 300 es',
'in vec3 aPos; in vec2 aUv; in float aShade; in vec3 aTint;',
'uniform mat4 uMVP;',
'out vec2 vUv; out float vShade; out vec3 vTint;',
'void main(){ vUv=aUv; vShade=aShade; vTint=aTint; gl_Position=uMVP*vec4(aPos,1.0); }'].join('\\n');
var FS = ['#version 300 es','precision highp float;',
'in vec2 vUv; in float vShade; in vec3 vTint;',
'uniform sampler2D uTex;',
'out vec4 o;',
'void main(){ vec4 t=texture(uTex,vUv); if(t.a<0.02) discard;',
'  o=vec4(t.rgb*vTint*vShade,1.0); }'].join('\\n');

function sh(t,src){ var s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
var prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
var uMVP = gl.getUniformLocation(prog,'uMVP');
gl.uniform1i(gl.getUniformLocation(prog,'uTex'), 0);

var tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
var img = new Image(); var texReady = false;
img.onload = function(){ gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img); texReady=true; draw(); };
img.src = 'data:image/png;base64,${atlasB64}';

var vbo = gl.createBuffer(), ibo = gl.createBuffer(), vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
var STRIDE = 9*4;
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,STRIDE,0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,STRIDE,12);
gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,STRIDE,20);
gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,3,gl.FLOAT,false,STRIDE,24);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);

// vanilla's fixed directional shading: down .5, up 1.0, north/south .8, west/east .6
var SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
// tintindex is where W5's biome colour attaches. Until then, plains grass and foliage, so
// a grass block is green in the gallery instead of the grey it would otherwise be.
var TINTS = [[0.569,0.741,0.349],[0.467,0.671,0.184],[0.247,0.463,0.894]];

var geomCache = {};
// The two atlases live in one image: tileUV addresses the block half, itemUV the item half.
function tileUV(t, u, v){
  var cx = (t % BCOLS) * TILE, cy = BY0 + ((t / BCOLS)|0) * TILE;
  return [ (cx + u) / AW, (cy + v) / AH ];
}
function itemUV(t, u, v){
  var cx = (t % ICOLS) * TILE, cy = IY0 + ((t / ICOLS)|0) * TILE;
  return [ (cx + u) / AW, (cy + v) / AH ];
}

function buildPage(){
  var start = page*PER, end = Math.min(view.length, start+PER);
  var n = end-start;
  var cols = Math.ceil(Math.sqrt(n * (cv.width/Math.max(1,cv.height)) )) || 1;
  var rows = Math.ceil(n/cols);
  var V = [], I = [], vi = 0, cells = [];
  // the per-block rotation, built once per page rather than per vertex
  var cs=Math.cos(spin), sn=Math.sin(spin), ct=Math.cos(tilt), st=Math.sin(tilt);
  var R = [ cs, 0, -sn,
            sn*st, ct, cs*st,
            sn*ct, -st, cs*ct ];
  var CELL = 1.75;
  for (var e = start; e < end; e++){
    var it = view[e], k = e-start;
    var cxp = (k % cols), cyp = (k / cols)|0;
    cells.push({ item: it, col: cxp, row: cyp });

    if (tab === 'items'){
      if (it.k === 'flat' && it.l && it.l.length){
        // A flat item is a SPRITE, and vanilla composites layer0..layerN in order — the
        // potion's colour overlay under its bottle, the dyed leather under its undyed
        // trim. Each layer gets its own screen-facing quad, a hair apart in z so the
        // depth test keeps the order the file declares.
        for (var li = 0; li < it.l.length; li++){
          var z = -0.001 * li;
          var uv0 = itemUV(it.l[li], 0, 0), uv1 = itemUV(it.l[li], 16, 16);
          var qx = 0.55;
          // ⚠ WINDING. Back-face culling is on (front = counter-clockwise), and the first
          // version wound these clockwise — so every one of the 610 item sprites was
          // emitted, counted in the quad total, and then culled. The page looked empty
          // while the tooltip happily reported the item under the cursor, which is the most
          // confusing possible symptom. Counter-clockwise seen from +Z is
          // bottom-left, bottom-right, top-right, top-left.
          var pts = [[-qx,-qx, z],[qx,-qx, z],[qx, qx, z],[-qx, qx, z]];
          var uvs = [[uv0[0],uv1[1]],[uv1[0],uv1[1]],[uv1[0],uv0[1]],[uv0[0],uv0[1]]];
          for (var pc = 0; pc < 4; pc++)
            V.push(pts[pc][0] + cxp*CELL, pts[pc][1] - cyp*CELL, pts[pc][2],
                   uvs[pc][0], uvs[pc][1], 1.0, 1,1,1);
          I.push(vi, vi+1, vi+2, vi, vi+2, vi+3); vi += 4;
        }
        continue;
      }
      if (it.k === 'block' && it.p !== null){
        var iq = D.iparts[it.p];
        for (var qj = 0; qj < iq.length; qj++){
          var Q = iq[qj];
          var s2 = Q.shade ? SHADE[Q.d] : 1.0;
          var t2 = Q.tint >= 0 ? (TINTS[Q.tint] || TINTS[0]) : [1,1,1];
          for (var c2 = 0; c2 < 4; c2++){
            var u2 = tileUV(Q.t, Q.uv[c2*2], Q.uv[c2*2+1]);
            var lx2 = Q.p[c2*3]/16-0.5, ly2 = Q.p[c2*3+1]/16-0.5, lz2 = Q.p[c2*3+2]/16-0.5;
            V.push(lx2*R[0]+ly2*R[1]+lz2*R[2] + cxp*CELL,
                   lx2*R[3]+ly2*R[4]+lz2*R[5] - cyp*CELL,
                   lx2*R[6]+ly2*R[7]+lz2*R[8],
                   u2[0], u2[1], s2, t2[0], t2[1], t2[2]);
          }
          I.push(vi, vi+1, vi+2, vi, vi+2, vi+3); vi += 4;
        }
        continue;
      }
      // entity items (chests, banners, beds, skulls) have no model here — a flat marker
      // rather than nothing, so the gap is visible and countable instead of invisible.
      var m0 = itemUV(0, 0, 0);
      var mq = 0.16;
      var mp = [[-mq,-mq,0],[mq,-mq,0],[mq,mq,0],[-mq,mq,0]];
      for (var mc = 0; mc < 4; mc++)
        V.push(mp[mc][0] + cxp*CELL, mp[mc][1] - cyp*CELL, 0, m0[0], m0[1], 0.35, 1,1,1);
      I.push(vi, vi+1, vi+2, vi, vi+2, vi+3); vi += 4;
      continue;
    }

    for (var a = 0; a < it.ids.length; a++){
      var qs = D.parts[it.ids[a]];
      for (var qi = 0; qi < qs.length; qi++){
        var q = qs[qi];
        // vanilla's fixed directional shading, except where the model says shade:false
        var sh1 = q.shade ? SHADE[q.d] : 1.0;
        var tn = q.tint >= 0 ? (TINTS[q.tint] || TINTS[0]) : [1,1,1];
        for (var c = 0; c < 4; c++){
          var uvp = tileUV(q.t, q.uv[c*2], q.uv[c*2+1]);
          // Each block is rotated about ITS OWN centre on the CPU, and only then placed in
          // the grid. Rotating the whole grid instead turned a neat table of blocks into a
          // diagonal smear — the blocks were right and the layout was wrong, which is the
          // most misleading way to be wrong.
          var lx = q.p[c*3]/16-0.5, ly = q.p[c*3+1]/16-0.5, lz = q.p[c*3+2]/16-0.5;
          V.push(lx*R[0] + ly*R[1] + lz*R[2] + cxp*CELL,
                 lx*R[3] + ly*R[4] + lz*R[5] - cyp*CELL,
                 lx*R[6] + ly*R[7] + lz*R[8],
                 uvp[0], uvp[1], sh1, tn[0], tn[1], tn[2]);
        }
        I.push(vi, vi+1, vi+2, vi, vi+2, vi+3); vi += 4;
      }
    }
  }
  geomCache = { V:new Float32Array(V), I:new Uint32Array(I), cols:cols, rows:rows, cells:cells, count:I.length };
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, geomCache.V, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geomCache.I, gl.STATIC_DRAW);
  document.getElementById('pg').textContent =
    'page ' + (page+1) + ' / ' + Math.max(1, Math.ceil(view.length/PER)) +
    '   ·   ' + n + ' shown   ·   ' + (geomCache.count/6) + ' quads';
}

/**
 * A plain orthographic projection over the grid. There is no camera rotation here at all —
 * every block was already rotated about its own centre in buildPage(), so this only has to
 * fit a cols-by-rows table of cells on screen without distorting them. Keeping the two concerns apart
 * is what makes the layout stay square while the blocks spin.
 */
function mat(out, cols, rows, aspect){
  var CELL = 1.75, pad = 1.2;
  var spanX = cols*CELL + pad, spanY = rows*CELL + pad;
  // one scale for both axes, so a cube never comes out as a rectangle
  var k = Math.min(2/spanX, (2/aspect)/spanY);
  var ox = (cols-1)*CELL*0.5, oy = -(rows-1)*CELL*0.5;
  for (var i=0;i<16;i++) out[i]=0;
  out[0]=k; out[5]=k*aspect; out[10]=-0.15; out[15]=1;
  out[12]=-ox*k; out[13]=-oy*k*aspect; out[14]=0.5;
  return out;
}
var M = new Float32Array(16);

function draw(){
  var dpr = Math.min(2, window.devicePixelRatio||1);
  var w = Math.floor(cv.clientWidth*dpr), h = Math.floor(cv.clientHeight*dpr);
  if (cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
  buildPage();
  gl.viewport(0,0,cv.width,cv.height);
  gl.clearColor(0.078,0.09,0.11,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  if (!texReady) return;
  mat(M, geomCache.cols, geomCache.rows, cv.width/cv.height);
  gl.useProgram(prog); gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniformMatrix4fv(uMVP,false,M);
  gl.drawElements(gl.TRIANGLES, geomCache.count, gl.UNSIGNED_INT, 0);
}

// ── interaction ─────────────────────────────────────────────────────────────
var tip = document.getElementById('tip');
cv.addEventListener('mousemove', function(ev){
  if (drag){ spin = drag.s + (ev.clientX-drag.x)*0.008; tilt = Math.max(-1.4, Math.min(1.4, drag.t + (ev.clientY-drag.y)*0.008)); draw(); return; }
  var r = cv.getBoundingClientRect();
  var fx = (ev.clientX-r.left)/r.width, fy = (ev.clientY-r.top)/r.height;
  var col = Math.floor(fx*geomCache.cols), row = Math.floor(fy*geomCache.rows);
  var cell = null;
  for (var i=0;i<geomCache.cells.length;i++){ var c=geomCache.cells[i]; if (c.col===col && c.row===row){ cell=c; break; } }
  if (!cell){ tip.style.display='none'; return; }
  if (tab === 'items'){
    var IT = cell.item;
    var bits = ['stacks to ' + IT.ss];
    if (IT.du) bits.push(IT.du + ' durability');
    if (IT.f) bits.push('food ' + IT.f[0] + ' / sat ' + IT.f[1]);
    bits.push(IT.k + (IT.k === 'entity' ? ' — no model yet' : ''));
    if (IT.nt) bits.push('⚠ awaiting its tint colour — renders grey');
    tip.innerHTML = '<div class="t">'+IT.d+'</div><div class="p">'+IT.n+'<br>'+bits.join(' · ')+'</div>';
    tip.style.display='block';
    tip.style.left = Math.min(window.innerWidth-350, ev.clientX+14)+'px';
    tip.style.top = (ev.clientY+14)+'px';
    return;
  }
  var B = D.blocks[cell.item.b], st = B.s[cell.item.s];
  var props = Object.keys(st).map(function(k){ return k+'='+st[k]; }).join(', ');
  tip.innerHTML = '<div class="t">'+B.d+'</div><div class="p">'+B.n+
    (props?'<br>'+props:'')+'<br>'+cell.item.nq+' quads'+(B.k?' · multipart':'')+'</div>';
  tip.style.display='block';
  tip.style.left = Math.min(window.innerWidth-350, ev.clientX+14)+'px';
  tip.style.top = (ev.clientY+14)+'px';
});
cv.addEventListener('mousedown', function(ev){ drag={x:ev.clientX,y:ev.clientY,s:spin,t:tilt}; tip.style.display='none'; });
window.addEventListener('mouseup', function(){ drag=null; });
cv.addEventListener('mouseleave', function(){ tip.style.display='none'; });
cv.addEventListener('wheel', function(ev){
  ev.preventDefault();
  var max = Math.max(0, Math.ceil(view.length/PER)-1);
  page = Math.max(0, Math.min(max, page + (ev.deltaY>0?1:-1)));
  draw();
}, {passive:false});
window.addEventListener('resize', draw);
document.getElementById('q').addEventListener('input', function(){ page=0; rebuild(); });
function setMode(m, id){
  mode=m; page=0;
  ['mAll','mDef','mNC'].forEach(function(x){ document.getElementById(x).className = x===id?'on':''; });
  rebuild();
}
function setTab(t){
  tab = t; page = 0;
  document.getElementById('note').textContent = t === 'items'
    ? '77 items (67 of them spawn eggs) render grey — their tint colours are compiled Java   ·   '
    : '';
  document.getElementById('tBlocks').className = t==='blocks'?'on':'';
  document.getElementById('tItems').className  = t==='items'?'on':'';
  document.getElementById('mAll').style.display = t==='items'?'none':'';
  document.getElementById('mDef').style.display = t==='items'?'none':'';
  document.getElementById('mNC').textContent = t==='items'?'3D items only':'non-cube only';
  rebuild();
}
document.getElementById('tBlocks').onclick=function(){ setTab('blocks'); };
document.getElementById('tItems').onclick=function(){ setTab('items'); };
document.getElementById('mAll').onclick=function(){ setMode('all','mAll'); };
document.getElementById('mDef').onclick=function(){ setMode('def','mDef'); };
document.getElementById('mNC').onclick=function(){ setMode('nc','mNC'); };
window.addEventListener('keydown', function(e){
  if (e.key==='ArrowRight'||e.key==='PageDown'){ page++; draw(); }
  if (e.key==='ArrowLeft'||e.key==='PageUp'){ page=Math.max(0,page-1); draw(); }
});
rebuild();
})();
</script></body></html>`;

writeFileSync(OUT, HTML);
const kb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log('');
console.log('================ build-gallery ================');
console.log(` blocks ............ ${blocks.length}`);
console.log(` visual states ..... ${blocks.reduce((a, b) => a + b.s.length, 0)}`);
console.log(` baked parts ....... ${geom.parts.length}`);
console.log(` atlas ............. ${atlasIdx.cols * atlasIdx.tile}x${atlasIdx.rows * atlasIdx.tile}, ${(atlasB64.length / 1024).toFixed(0)} KB base64`);
console.log(` output ............ ${kb(HTML.length)}  ->  ${OUT}`);
console.log('==============================================');
