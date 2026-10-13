// vanillamodel.mjs — the VANILLA mob model, built from the decompiled Java (.decomp), for mobshapecheck (#1166).
//
// Every `XEntityModel.getTexturedModelData()` in .decomp is a short straight-line program of
// ModelPartData.addChild(name, ModelPartBuilder.create().uv().cuboid()…, ModelTransform.pivot/of/NONE) calls. This
// translates each method body to JS (types stripped, casts dropped, `Cls.m(` routed to the translated method) and
// RUNS it against a tiny ModelPart tree, so the parent chain (head -> real_head, body -> mane, …) is kept — which
// the flat golden table `models-1.18.2.tsv` loses (it drops empty parents like the wolf's `head`/`tail`).
// `posedBoxes()` then returns every box's 8 corners in model px with ModelPart.rotate's exact order
// (translate pivot, then Rz, Ry, Rx; children inside their parent), Dilation grown in.
import { readFileSync, readdirSync } from 'node:fs';
import { MCLITE_ROOT } from './loadsrc.mjs';

const DIR = MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/';
const EXTRA = ['net/minecraft/client/render/block/entity/ChestBlockEntityRenderer.java'];

class Dilation {
  constructor(x = 0, y = x, z = x) { this.d = x; this.x = x; this.y = y; this.z = z; }
  add(x, y = x, z = x) { return new Dilation(this.x + x, this.y + y, this.z + z); }
}
Dilation.NONE = new Dilation(0);
class Xf { constructor(p, r) { this.p = p; this.r = r; } }
const MT = {
  pivot: (x, y, z) => new Xf([x, y, z], [0, 0, 0]), of: (x, y, z, rx, ry, rz) => new Xf([x, y, z], [rx, ry, rz]),
  rotation: (rx, ry, rz) => new Xf([0, 0, 0], [rx, ry, rz]), NONE: new Xf([0, 0, 0], [0, 0, 0]),
};
class Builder {
  constructor() { this.boxes = []; this.u = 0; this.v = 0; this.mir = false; }
  static create() { return new Builder(); }
  uv(u, v) { this.u = u; this.v = v; return this; }
  mirrored(m = true) { this.mir = m; return this; }
  // every ModelPartBuilder.cuboid overload (.decomp ModelPartBuilder): the NAMED ones ending in two ints set uv() first;
  // the unnamed (…, Dilation, float, float) one carries a texture SCALE; (…, boolean) mirrors this cuboid alone (#1505)
  cuboid(...a) {
    const named = typeof a[0] === 'string'; if (named) a.shift();
    const [x, y, z, w, h, d] = a, rest = a.slice(6); let g = [0, 0, 0], m = this.mir, ts = [1, 1];
    for (const e of rest) if (e instanceof Dilation) g = [e.x, e.y, e.z];
    if (typeof rest[0] === 'boolean') m = rest[0];
    const nums = rest.filter((e) => typeof e === 'number');
    if (nums.length === 2) { if (named) { this.u = nums[0]; this.v = nums[1]; } else ts = nums; }
    this.boxes.push({ x, y, z, w, h, d, g, tu: this.u, tv: this.v, m: !!m, ts }); return this;
  }
  copy() { const b = new Builder(); b.boxes = this.boxes.slice(); return b; }
}
class Part {
  constructor(b, xf) { this.boxes = b ? b.boxes.slice() : []; this.xf = xf || MT.NONE; this.kids = []; this.names = []; }
  addChild(name, b, xf) {
    const p = new Part(b, xf); const i = this.names.indexOf(name);
    if (i >= 0) { p.names = this.kids[i].names; p.kids = this.kids[i].kids; this.kids[i] = p; }   // ModelPartData.addChild keeps the replaced part's children (.decomp ModelPartData:25)
    else { this.names.push(name); this.kids.push(p); }
    return p;
  }
  getChild(n) { return this.kids[this.names.indexOf(n)]; }
  getRoot() { return this; }
}
const TMD = { of: (md, w, h) => { md.tw = w; md.th = h; return md; } };   // TexturedModelData.of(modelData, texW, texH)

function matching(src, open) {          // index just past the `}` that closes the `{` at `open`
  let d = 0;
  for (let i = open; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return i + 1; }
  throw new Error('unbalanced');
}
// java.util.Random (48-bit LCG), enough for Random(seed).nextInt(bound) as GhastEntityModel's tentacle heights use it
class JRandom {
  constructor(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); }
  next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, this.s >> (48n - BigInt(bits)))); }
  nextInt(b) {
    if ((b & -b) === b) return Number((BigInt(b) * BigInt(this.next(31))) >> 31n);
    let bits, v; do { bits = this.next(31); v = bits % b; } while (bits - v + (b - 1) > 0x7fffffff);
    return v;
  }
}
const classes = {};                     // Class -> { method: jsFunction }
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
function translate(body, cls) {
  return body
    .replace(/(?<![.\w])(get\w+)\s*\(/g, (m, f) => `S('${cls}','${f}')(`)
    .replace(/\(float\)\(\s*(\$\$\d+)\s*\/\s*(\d+)/g, '(Math.trunc($1 / $2)')   // (float)(i / 3 ...): java int division
    .replace(/\bRandom\s+(\$\$\d+)\s*=\s*new Random\(/g, 'let $1 = new JRandom(')
    .replace(/\(\s*(float|double|int)\s*\)\s*/g, '')
    .replace(/\b(?:float|int)\[\]\s+(\$\$\d+|[a-z]\w*)\s*=\s*new\s+(?:float|int)\[(\w+)\]\s*;/g, 'let $1 = new Array($2).fill(0);')
    .replace(/\b(ModelData|ModelPartData|ModelPartBuilder|TexturedModelData|Dilation|float|int|double|boolean|String|ModelTransform)\s+(\$\$\d+|[a-z]\w*)\s*=/g, 'let $2 =')
    .replace(/for\s*\(\s*(int|float)\s+/g, 'for (let ')
    .replace(/(\d)[FfLl]\b/g, '$1')
    .replace(/\bnew ModelData\(\)/g, 'new Part()')
    .replace(/\bnew Dilation\(/g, 'new Dilation(')
    .replace(/\b([A-Z]\w+)\.([a-z]\w*)\s*\(/g, (m, c, f) => (['ModelPartBuilder', 'ModelTransform', 'TexturedModelData', 'Math'].includes(c) ? m : `S('${c}','${f}')(`));
}
function loadClass(name, src) {
  const out = classes[name] = classes[name] || {};
  const re = /\bstatic\s+(?:final\s+)?(?:TexturedModelData|ModelData|String|float|int)\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
  let m;
  // static float[]/int[] constant tables (guardian SPIKE_PIVOTS_*): prepended to every method body as consts
  let consts = '';
  for (const a of src.matchAll(/\bstatic\s+final\s+(?:float|int)(?:\[\])+\s+(\w+)\s*=\s*new\s+(?:float|int)(?:\[\])+\s*(\{[^;]*\})\s*;/g)) consts += `const ${a[1]} = ${a[2].replace(/(\d)[FfLl]\b/g, '$1').replace(/\{/g, '[').replace(/\}/g, ']')};\n`;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1, end = matching(src, open);
    const params = m[2].split(',').map((s) => s.trim().split(/\s+/).pop()).filter(Boolean);
    const jsBody = consts + translate(src.slice(open + 1, end - 1), name);
    const key = m[1] + '/' + params.length;
    try { out[key] = new Function('JRandom', 'Part', 'Builder', 'Dilation', 'ModelPartBuilder', 'ModelTransform', 'TexturedModelData', 'S', ...params, jsBody); out[key].src = jsBody; }
    catch (e) { out[key] = () => { throw new Error('translate ' + name + '.' + key + ': ' + e.message); }; }
  }
}
let loaded = false;
function load() {
  if (loaded) return; loaded = true;
  for (const f of readdirSync(DIR)) if (/Model\.java$/.test(f)) loadClass(f.replace('.java', ''), readFileSync(DIR + f, 'utf8'));
  for (const f of EXTRA) loadClass(f.split('/').pop().replace('.java', ''), readFileSync(MCLITE_ROOT + '.decomp/' + f, 'utf8'));
}
const MathHelper = { cos: (a) => Math.cos(a), sin: (a) => Math.sin(a) };
function S(cls, meth) {
  if (cls === 'MathHelper') return MathHelper[meth];
  return (...a) => {
    const tbl = classes[cls] || classes[cls + 'EntityModel'] || classes[cls + 'Model'];
    const fn = tbl && tbl[meth + '/' + a.length];
    if (!fn) throw new Error(`no translated ${cls}.${meth}/${a.length}`);
    return fn(JRandom, Part, Builder, Dilation, Builder, MT, TMD, S, ...a);
  };
}
/** Load one more .decomp class (a renderer that builds its own model data), by path under .decomp/. */
export function loadDecomp(rel) { load(); const n = rel.split('/').pop().replace('.java', ''); if (!classes[n]) loadClass(n, readFileSync(MCLITE_ROOT + '.decomp/' + rel, 'utf8')); }
/** Evaluate one Java expression (types stripped, calls routed to the translated methods); `env` = local names -> values. */
export function vanillaEval(expr, env = {}, cls = 'EntityModels') {
  load();
  const names = Object.keys(env);
  return new Function('JRandom', 'Part', 'Builder', 'Dilation', 'ModelPartBuilder', 'ModelTransform', 'TexturedModelData', 'S', ...names, translate('return ' + expr + ';', cls))(
    JRandom, Part, Builder, Dilation, Builder, MT, TMD, S, ...names.map((k) => env[k]));
}
/** Run `Class.method(...args)` -> the root Part, or throws. */
export function vanillaRoot(cls, meth = 'getTexturedModelData', ...args) { load(); return S(cls, meth)(...args); }
export { Dilation };

const rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const mm = (A, B) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return o; };
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];

/** Every box of the tree as { part, corners: 8 x [x,y,z] } in model px (pre-flip), rotations composed down the chain. */
export function posedBoxes(root) {
  const out = [];
  (function walk(p, R, t, name) {
    const Rl = mm(mm(rz(p.xf.r[2]), ry(p.xf.r[1])), rx(p.xf.r[0]));
    const R2 = mm(R, Rl), t2 = mv(R, p.xf.p).map((v, i) => v + t[i]);
    for (const b of p.boxes) {
      const c = [];
      for (let i = 0; i < 8; i++) {
        const v = [(i & 1 ? b.x + b.w + b.g[0] : b.x - b.g[0]), (i & 2 ? b.y + b.h + b.g[1] : b.y - b.g[1]), (i & 4 ? b.z + b.d + b.g[2] : b.z - b.g[2])];
        const q = mv(R2, v); c.push([q[0] + t2[0], q[1] + t2[1], q[2] + t2[2]]);
      }
      out.push({ part: name, corners: c });
    }
    p.kids.forEach((k, i) => walk(k, R2, t2, p.names[i]));
  })(root, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], 'root');
  return out;
}
export { snake };
