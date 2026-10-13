#!/usr/bin/env node
// tools/shadercheck.mjs — headless validation of the two renderer backends.
//
// We cannot open a browser here, so this is the substitute: it loads the real source files,
// generates the REAL shader strings the backends will hand to the driver, and then
//
//   1. lexes and parses both languages far enough to catch the mistakes that actually happen —
//      an undeclared identifier, a misspelled varying, an unbalanced brace, a uniform the JS
//      looks up but the shader never declares, an entry point name that does not exist;
//   2. cross-checks the GLSL against the WGSL: same numeric constants, same bit decode, same
//      varyings — the D-3 "both backends render identically" claim, made testable (D-52);
//   3. runs the parts of the renderer that need no GPU at all: the camera and frustum maths,
//      the §8 vertex packing round-trip, and the atlas -> block name mapping.
//
// It is not a compiler. It will not catch a type error that is spelled correctly. It will catch
// every typo either of the two shaders has ever plausibly had.
//
// Usage: node tools/shadercheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const VERBOSE = process.argv.includes('--verbose');

let errors = 0, warnings = 0, checks = 0;
const fail = (what, detail) => { errors++; console.error('FAIL  ' + what + (detail ? '\n      ' + String(detail).split('\n').join('\n      ') : '')); };
const warn = (what) => { warnings++; console.warn('WARN  ' + what); };
const ok   = (what) => { checks++; if (VERBOSE) console.log('ok    ' + what); };
const need = (cond, what, detail) => { cond ? ok(what) : fail(what, detail); return cond; };

// ---------------------------------------------------------------------------
// Load the real modules into a sandbox and get the real shader strings out
// ---------------------------------------------------------------------------

const FILES = ['00_ns.js', '01_util.js', '02_blocks.js', '03_section.js', '04_worldgen.js',
               '05_mesher.js', '06_atlas.js', '10_camera.js', '10_gfx.js',
               '11_gfx_webgpu.js', '12_gfx_webgl2.js'];

const text = Object.fromEntries(FILES.map(f => [f, readFileSync(join(SRC, f), 'utf8')]));

let MCL;
try {
  const body = "'use strict';\n" + FILES.map(f => text[f]).join('\n') + '\nreturn MCL;\n';
  MCL = new Function(body)();
} catch (e) {
  fail('loading src modules', e.stack || e.message);
  process.exit(1);
}
ok('loaded ' + FILES.length + ' modules headlessly');

const GLSL = MCL.GfxGL.buildShaders();
const WGSL = MCL.GfxGPU.buildWGSL() + '\n' + MCL.GfxGPU.buildSkyWGSL() + '\n' + MCL.GfxGPU.buildRayWGSL();  // KW-24: the sky's own module, concatenated so its entry points are checked too
ok('generated GLSL (' + (GLSL.VS.length + GLSL.FS.length) + ' chars) and WGSL (' + WGSL.length + ' chars)');

// ---------------------------------------------------------------------------
// Shared lexing helpers
// ---------------------------------------------------------------------------

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

/** Identifier tokens, skipping numeric suffixes (63u), member access (.rgb) and @attributes. */
function identifiers(src) {
  const out = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(src))) {
    const prev = m.index > 0 ? src[m.index - 1] : '';
    if (prev === '.' || prev === '@' || /[0-9]/.test(prev)) continue;
    out.push({ name: m[0], index: m.index });
  }
  return out;
}

function lineOf(src, index) { return src.slice(0, index).split('\n').length; }

function balanced(label, src) {
  const pairs = { ')': '(', '}': '{', ']': '[' };
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') stack.push({ c, i });
    else if (pairs[c]) {
      const top = stack.pop();
      if (!top || top.c !== pairs[c]) return fail(label + ': unbalanced "' + c + '" at line ' + lineOf(src, i));
    }
  }
  if (stack.length) return fail(label + ': unclosed "' + stack[stack.length - 1].c + '" opened at line ' + lineOf(src, stack[stack.length - 1].i));
  ok(label + ': delimiters balanced');
  return true;
}

// ---------------------------------------------------------------------------
// GLSL ES 3.00
// ---------------------------------------------------------------------------

const GLSL_TYPES = new Set(['void','bool','int','uint','float','double',
  'vec2','vec3','vec4','ivec2','ivec3','ivec4','uvec2','uvec3','uvec4','bvec2','bvec3','bvec4',
  'mat2','mat3','mat4','mat2x2','mat3x3','mat4x4',
  'sampler2D','sampler2DArray','sampler3D','samplerCube','isampler2D','usampler2D']);

const GLSL_KEYWORDS = new Set(['in','out','inout','uniform','attribute','varying','const','flat',
  'smooth','noperspective','centroid','invariant','precision','highp','mediump','lowp','layout',
  'location','binding','if','else','for','while','do','return','break','continue','discard',
  'struct','switch','case','default','true','false']);

const GLSL_BUILTIN_FN = new Set(['texture','textureLod','textureGrad','textureProj','textureSize',
  'texelFetch','texelFetchOffset','textureOffset',
  'radians','degrees','sin','cos','tan','asin','acos','atan','sinh','cosh','tanh',
  'pow','exp','log','exp2','log2','sqrt','inversesqrt','abs','sign','floor','trunc','round',
  'roundEven','ceil','fract','mod','modf','min','max','clamp','mix','step','smoothstep',
  'isnan','isinf','floatBitsToInt','floatBitsToUint','intBitsToFloat','uintBitsToFloat',
  'length','distance','dot','cross','normalize','faceforward','reflect','refract',
  'matrixCompMult','outerProduct','transpose','determinant','inverse',
  'lessThan','lessThanEqual','greaterThan','greaterThanEqual','equal','notEqual','any','all','not',
  'dFdx','dFdy','fwidth','packSnorm2x16','unpackSnorm2x16']);

const GLSL_BUILTIN_VAR = new Set(['gl_Position','gl_PointSize','gl_VertexID','gl_InstanceID',
  'gl_FragCoord','gl_FrontFacing','gl_PointCoord','gl_FragDepth','gl_DepthRange']);

/** Declarations we can see without a real parser: globals, locals, functions and parameters. */
function glslDeclared(src) {
  const declared = new Map();     // name -> {kind, type}
  const typeAlt = [...GLSL_TYPES].join('|');

  // storage-qualified globals:  [flat] in|out|uniform  TYPE NAME ;
  const g = new RegExp('\\b(in|out|uniform|attribute|varying)\\s+(?:highp\\s+|mediump\\s+|lowp\\s+)*(' + typeAlt + ')\\s+([A-Za-z_]\\w*)', 'g');
  let m;
  while ((m = g.exec(src))) declared.set(m[3], { kind: m[1], type: m[2] });

  // function definitions and their parameter lists
  const fn = new RegExp('\\b(' + typeAlt + ')\\s+([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{', 'g');
  while ((m = fn.exec(src))) {
    declared.set(m[2], { kind: 'function', type: m[1] });
    const params = new RegExp('(?:in|out|inout\\s+)?(' + typeAlt + ')\\s+([A-Za-z_]\\w*)', 'g');
    let p;
    while ((p = params.exec(m[3]))) declared.set(p[2], { kind: 'param', type: p[1] });
  }

  // locals: TYPE NAME (= | ; | ,)
  const loc = new RegExp('\\b(' + typeAlt + ')\\s+([A-Za-z_]\\w*)\\s*(?:=|;|,|\\))', 'g');
  while ((m = loc.exec(src))) if (!declared.has(m[2])) declared.set(m[2], { kind: 'local', type: m[1] });

  return declared;
}

function checkGLSL(label, src, stage) {
  // Preprocessor lines are not GLSL expressions; "#version 300 es" is not two identifiers.
  const clean = stripComments(src).split('\n').map(l => l.trim().startsWith('#') ? '' : l).join('\n');
  balanced(label, clean);

  need(/^#version 300 es\s*$/m.test(src.split('\n')[0]),
       label + ': "#version 300 es" is the first line',
       'got: ' + JSON.stringify(src.split('\n')[0]));

  need(/\bprecision\s+(highp|mediump|lowp)\s+float\s*;/.test(clean),
       label + ': declares a float precision');

  if (stage === 'fragment') {
    need(/\bout\s+vec4\s+\w+\s*;/.test(clean), label + ': declares a vec4 fragment output');
  } else {
    need(/gl_Position\s*=/.test(clean), label + ': writes gl_Position');
  }

  // every statement-ish line inside main should end with ; { } or a comment
  const bad = [];
  clean.split('\n').forEach((ln, i) => {
    const t = ln.trim();
    if (!t || t.startsWith('#')) return;
    if (/[;{}]$/.test(t) || t.endsWith(',')) return;
    bad.push((i + 1) + ': ' + t);
  });
  need(bad.length === 0, label + ': every line terminates', bad.join('\n'));

  const declared = glslDeclared(clean);
  const unknown = [];
  for (const { name, index } of identifiers(clean)) {
    if (GLSL_TYPES.has(name) || GLSL_KEYWORDS.has(name) || GLSL_BUILTIN_FN.has(name) ||
        GLSL_BUILTIN_VAR.has(name) || declared.has(name)) continue;
    unknown.push('line ' + lineOf(clean, index) + ': ' + name);
  }
  need(unknown.length === 0, label + ': every identifier resolves',
       unknown.join('\n') + (unknown.length ? '\n(typo, or a declaration this checker cannot see)' : ''));

  return declared;
}

const glslVSDecl = checkGLSL('GLSL vertex', GLSL.VS, 'vertex');
const glslFSDecl = checkGLSL('GLSL fragment', GLSL.FS, 'fragment');
checkGLSL('GLSL vertex (position only)', GLSL.VS_POS, 'vertex');
checkGLSL('GLSL fragment (flat)', GLSL.FS_FLAT, 'fragment');
// PLAN G16b — the sky pass's own pair (D-303). ⚠ A shader the JS links and this file does not
// lex is a shader nothing checks: the FIRST run after adding it failed the "every uniform the
// JS looks up is declared" test, correctly, because the sky's four uniforms were declared in a
// source this list did not include. Adding the program means adding it HERE too.
checkGLSL('GLSL vertex (sky)', GLSL.VS_SKY, 'vertex');
checkGLSL('GLSL fragment (sky)', GLSL.FS_SKY, 'fragment');
// #1851 — the colour-ray layer's pair, and its WGSL twin is concatenated into WGSL above
const rayVSDecl = checkGLSL('GLSL vertex (colour ray)', GLSL.VS_RAY, 'vertex');
const rayFSDecl = checkGLSL('GLSL fragment (colour ray)', GLSL.FS_RAY, 'fragment');
need(WGSL.includes('fn vs_ray') && WGSL.includes('fn fs_ray') && /fragColor\s*=\s*vColor;/.test(GLSL.FS_RAY) && /return i\.color;/.test(WGSL) && /vColor\s*=\s*aColor;/.test(GLSL.VS_RAY) && /o\.color\s*=\s*color;/.test(WGSL), 'colour ray: GLSL and WGSL both pass the vertex colour straight through (untextured)');

// varyings must agree in name AND type across the stage boundary
{
  const outs = [...glslVSDecl].filter(([, v]) => v.kind === 'out');
  const ins  = new Map([...glslFSDecl].filter(([, v]) => v.kind === 'in'));
  const problems = [];
  for (const [name, v] of outs) {
    if (!ins.has(name)) problems.push('vertex "out ' + v.type + ' ' + name + '" has no matching fragment "in"');
    else if (ins.get(name).type !== v.type) problems.push(name + ': vertex ' + v.type + ' vs fragment ' + ins.get(name).type);
  }
  for (const [name, v] of ins) {
    if (!outs.some(([n]) => n === name)) problems.push('fragment "in ' + v.type + ' ' + name + '" is never written by the vertex shader');
  }
  need(problems.length === 0, 'GLSL: varyings match across stages', problems.join('\n'));

  // a flat qualifier on one side and not the other links, then reads garbage on some drivers
  const flatVS = new Set([...GLSL.VS.matchAll(/flat\s+out\s+\w+\s+(\w+)/g)].map(m => m[1]));
  const flatFS = new Set([...GLSL.FS.matchAll(/flat\s+in\s+\w+\s+(\w+)/g)].map(m => m[1]));
  need([...flatVS].every(n => flatFS.has(n)) && [...flatFS].every(n => flatVS.has(n)),
       'GLSL: flat qualifiers match across stages',
       'vertex flat: [' + [...flatVS] + '] fragment flat: [' + [...flatFS] + ']');
}

// the JS must only look up uniforms/attributes that exist
{
  const js = text['12_gfx_webgl2.js'];
  const wanted = [...js.matchAll(/getUniformLocation\(p,\s*'([^']+)'\)/g)].map(m => m[1]);
  const allDecl = new Set([...GLSL.VS.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1])
    .concat([...GLSL.FS.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]))
    .concat([...GLSL.VS_POS.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]))
    .concat([...GLSL.FS_FLAT.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]))
    .concat([...GLSL.VS_SKY.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]))
    .concat([...GLSL.VS_RAY.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]))
    .concat([...GLSL.FS_SKY.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]))
    // PLAN G10d — the hand's own pair (D-359). A shader left out of this union is a shader whose
    // uniforms this assertion cannot see, which is the same hole as a check not in the suite.
    .concat([...GLSL.VS_HAND.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]))
    .concat([...GLSL.FS_HAND.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1])));
  const missing = wanted.filter(n => !allDecl.has(n));
  need(missing.length === 0, 'GLSL: every uniform the JS looks up is declared somewhere',
       'not declared in any shader: ' + missing.join(', '));

  const attrs = [...js.matchAll(/bindAttribLocation\(p,\s*(\d+),\s*'([^']+)'\)/g)];
  const vsAttrs = new Set([...GLSL.VS.matchAll(/^in\s+\w+\s+(\w+);/gm)].map(m => m[1]));
  const posAttrs = new Set([...GLSL.VS_POS.matchAll(/^in\s+\w+\s+(\w+);/gm)].map(m => m[1]));
  need(attrs.length === 2 && attrs.every(([, , n]) => vsAttrs.has(n) && posAttrs.has(n)),
       'GLSL: both bound attributes are declared in both vertex shaders',
       'bound: ' + attrs.map(a => a[1] + '=' + a[2]).join(', ') +
       ' | main: [' + [...vsAttrs] + '] pos: [' + [...posAttrs] + ']');
}

// ---------------------------------------------------------------------------
// WGSL
// ---------------------------------------------------------------------------

const WGSL_TYPES = new Set(['f32','i32','u32','bool','f16',
  'vec2','vec3','vec4','mat2x2','mat3x3','mat4x4','mat2x3','mat3x2','mat4x3','mat3x4',
  'array','ptr','atomic','sampler','sampler_comparison',
  'texture_2d','texture_2d_array','texture_3d','texture_cube','texture_depth_2d']);

const WGSL_KEYWORDS = new Set(['fn','let','var','const','struct','return','if','else','discard',
  'for','while','loop','break','continue','switch','case','default','true','false','override',
  'uniform','storage','workgroup','private','function','read','write','read_write','alias']);

const WGSL_ATTRS = new Set(['vertex','fragment','compute','group','binding','location','builtin',
  'interpolate','flat','perspective','linear','center','centroid','sample','first','either',
  'size','align','invariant','workgroup_size','must_use']);

const WGSL_BUILTIN_FN = new Set(['textureSample','textureSampleLevel','textureSampleGrad',
  'textureSampleBias','textureLoad','textureStore','textureDimensions','textureNumLayers',
  'abs','acos','asin','atan','atan2','ceil','clamp','cos','cosh','cross','degrees','distance',
  'dot','exp','exp2','faceForward','floor','fma','fract','inverseSqrt','length','log','log2',
  'max','min','mix','modf','normalize','pow','radians','reflect','refract','round','saturate',
  'select','sign','sin','sinh','smoothstep','sqrt','step','tan','tanh','transpose','trunc',
  'all','any','dpdx','dpdy','fwidth','bitcast','arrayLength','determinant']);

// WGSL builtin value names that appear inside @builtin(...)
const WGSL_BUILTIN_VALUES = new Set(['position','vertex_index','instance_index','front_facing',
  'frag_depth','sample_index','sample_mask','local_invocation_id','global_invocation_id']);

/** Remove @attributes so "@builtin(position) pos : vec4<f32>" reduces to "pos : vec4<f32>". */
function stripAttrs(s) { return s.replace(/@\w+(\([^)]*\))?/g, ' '); }

function wgslDeclared(src) {
  const declared = new Map();
  const structs = new Map();   // struct name -> Set(member names)
  let m;

  // struct definitions and their members
  const st = /struct\s+([A-Za-z_]\w*)\s*\{([^}]*)\}/g;
  while ((m = st.exec(src))) {
    const members = new Set();
    const body = stripAttrs(m[2]);
    const mem = /([A-Za-z_]\w*)\s*:/g;
    let mm;
    while ((mm = mem.exec(body))) { members.add(mm[1]); declared.set(mm[1], { kind: 'member' }); }
    structs.set(m[1], members);
    declared.set(m[1], { kind: 'struct' });
  }

  // module-scope resources:  var<uniform> uFrame : Frame;   var uAtlas : texture_2d_array<f32>;
  const rv = /\bvar(?:<[^>]*>)?\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g;
  while ((m = rv.exec(src))) declared.set(m[1], { kind: 'var', type: m[2] });

  // functions and parameters. The parameter list has to be scanned with a paren counter:
  // "@location(0) data : vec2<u32>" contains parentheses of its own.
  const fn = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
  while ((m = fn.exec(src))) {
    declared.set(m[1], { kind: 'fn' });
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const params = stripAttrs(src.slice(start, i - 1));
    const p = /([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g;
    let pp;
    while ((pp = p.exec(params))) declared.set(pp[1], { kind: 'param', type: pp[2] });
  }

  // let/var/const locals
  const lv = /\b(?:let|const|var)\s+([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*))?\s*[=;]/g;
  while ((m = lv.exec(src))) declared.set(m[1], { kind: 'local', type: m[2] });

  return { declared, structs };
}

function checkWGSL(label, src) {
  const clean = stripComments(src);
  balanced(label, clean);

  const { declared, structs } = wgslDeclared(clean);

  // attribute names must be real
  const badAttrs = [];
  for (const m of clean.matchAll(/@([A-Za-z_]\w*)/g)) {
    if (!WGSL_ATTRS.has(m[1])) badAttrs.push('line ' + lineOf(clean, m.index) + ': @' + m[1]);
  }
  need(badAttrs.length === 0, label + ': every @attribute is a real WGSL attribute', badAttrs.join('\n'));

  // @builtin(x) values must be real
  const badBuiltins = [];
  for (const m of clean.matchAll(/@builtin\(\s*([A-Za-z_]\w*)\s*\)/g)) {
    if (!WGSL_BUILTIN_VALUES.has(m[1])) badBuiltins.push('@builtin(' + m[1] + ')');
  }
  need(badBuiltins.length === 0, label + ': every @builtin() names a real builtin', badBuiltins.join('\n'));

  const unknown = [];
  for (const { name, index } of identifiers(clean)) {
    if (WGSL_TYPES.has(name) || WGSL_KEYWORDS.has(name) || WGSL_BUILTIN_FN.has(name) ||
        WGSL_ATTRS.has(name) || WGSL_BUILTIN_VALUES.has(name) || declared.has(name)) continue;
    unknown.push('line ' + lineOf(clean, index) + ': ' + name);
  }
  need(unknown.length === 0, label + ': every identifier resolves', unknown.join('\n'));

  // member access against known struct-typed variables
  const varTypes = new Map();
  for (const [n, v] of declared) if (v.type && structs.has(v.type)) varTypes.set(n, v.type);
  // ⚠ A MEMBER ACCESS IS CHECKED AGAINST **EVERY** STRUCT THE NAME IS EVER DECLARED AS, NOT THE
  // LAST ONE (D-359). `varTypes` is a file-wide map keyed by variable NAME, so the moment a
  // second output struct appeared — the hand's `HandOut` beside the world's `VSOut`, both using
  // the conventional local `o` — every `o.fog` in the world's shader was judged against
  // `HandOut` and reported as wrong. The shader was correct and the checker's model of it was
  // not: one name, two types, and a map that can only hold one.
  // ⚠ RE-SCANNED FROM THE SOURCE, because `declared` is a Map keyed by NAME and the second
  // `var o : HandOut;` overwrites the first `var o : VSOut;`. Reading the same map that lost the
  // information cannot recover it — the scan has to see every declaration, not the last one.
  const varTypesAll = new Map();
  const addType = (n, t) => {
    if (!t || !structs.has(t)) return;
    if (!varTypesAll.has(n)) varTypesAll.set(n, new Set());
    varTypesAll.get(n).add(t);
  };
  for (const [n, v] of declared) addType(n, v.type);
  for (const mm of clean.matchAll(/\b(?:let|const|var)(?:<[^>]*>)?\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g)) {
    addType(mm[1], mm[2]);
  }
  for (const mm of clean.matchAll(/([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*[,)]/g)) addType(mm[1], mm[2]);
  const badMembers = [];
  for (const m of clean.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)) {
    const ts = varTypesAll.get(m[1]);
    if (!ts) continue;
    // the access is valid if ANY struct the name is declared as carries the member
    let okAny = false;
    for (const t of ts) if (structs.get(t).has(m[2])) { okAny = true; break; }
    if (!okAny) {
      badMembers.push('line ' + lineOf(clean, m.index) + ': ' + m[1] + '.' + m[2]
        + ' is not a member of ' + [...ts].join(' or '));
    }
  }
  need(badMembers.length === 0, label + ': struct member accesses are valid', badMembers.join('\n'));

  // statement termination, same crude rule as the GLSL side
  const bad = [];
  clean.split('\n').forEach((ln, i) => {
    const t = ln.trim();
    if (!t) return;
    if (/[;{}]$/.test(t) || t.endsWith(',')) return;
    if (/^@[A-Za-z_]/.test(t)) return;              // a stage attribute on its own line
    if (/^\)?\s*->/.test(t)) return;                // a wrapped return type
    bad.push((i + 1) + ': ' + t);
  });
  need(bad.length === 0, label + ': every line terminates', bad.join('\n'));

  return { declared, structs };
}

const wgsl = checkWGSL('WGSL', WGSL);

// entry points referenced from JS must exist with the right stage
{
  const js = text['11_gfx_webgpu.js'];
  const wanted = [...new Set([...js.matchAll(/entryPoint:\s*'([^']+)'/g)].map(m => m[1]))];
  const stages = new Map();
  for (const m of WGSL.matchAll(/@(vertex|fragment|compute)\s*\n\s*fn\s+([A-Za-z_]\w*)/g)) stages.set(m[2], m[1]);
  const missing = wanted.filter(n => !stages.has(n));
  need(missing.length === 0, 'WGSL: every entryPoint named in the JS exists (' + wanted.join(', ') + ')',
       'missing: ' + missing.join(', ') + ' | defined: ' + [...stages.keys()].join(', '));

  need(stages.get('vs_main') === 'vertex' && stages.get('vs_pos') === 'vertex' &&
       stages.get('fs_main') === 'fragment' && stages.get('fs_flat') === 'fragment',
       'WGSL: entry point stages are correct',
       [...stages].map(([k, v]) => k + '=' + v).join(', '));
}

// bind group / binding numbers must be exactly what the pipeline layout declares
{
  const found = new Set([...WGSL.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)/g)].map(m => m[1] + ':' + m[2]));
  // frame UBO, atlas, atlas sampler, tint map, tint sampler | per-draw UBO
  // ⚠ GROUP 2 IS THE HAND'S (D-359): its own projection UBO, the player-skin texture and that
  // texture's sampler. It is a THIRD group rather than three more entries in group 0 because the
  // hand is the only pass that binds it, and a group nothing else touches costs nothing to skip.
  const expected = new Set(['0:0', '0:1', '0:2', '0:3', '0:4', '1:0', '2:0', '2:1', '2:2']);
  need(found.size === expected.size && [...expected].every(k => found.has(k)),
       'WGSL: @group/@binding set matches the pipeline layout',
       'shader: [' + [...found].sort() + '] expected: [' + [...expected].sort() + ']');

  const js = text['11_gfx_webgpu.js'];
  const bindings = [...js.matchAll(/binding:\s*(\d+),\s*visibility/g)].map(m => m[1]);
  need(bindings.length === 13, 'WebGPU JS: thirteen bind group layout entries declared (six + the hand\'s three + the sky\'s three, KW-24, + the ray layer\'s one, #1851)',
       'found ' + bindings.length);
}

// ---------------------------------------------------------------------------
// Cross-backend: the two languages must encode the SAME maths (D-3, D-52)
// ---------------------------------------------------------------------------

// The GL wireframe colour is a uniform set from JS, not a literal in the shader.
const GL_WIRE = (() => {
  const m = text['12_gfx_webgl2.js'].match(/uniform4f\(locs\.uFlat,\s*([^)]+)\)/);
  return m ? m[1].split(',').map(s => parseFloat(s)).sort((a, b) => a - b) : [];
})();

function floatLits(src) {
  return [...stripComments(src).matchAll(/(?<![\w.])(\d+\.\d+)/g)].map(m => parseFloat(m[1])).sort((a, b) => a - b);
}
function bitOps(src) {
  const s = stripComments(src);
  const shifts = [...s.matchAll(/>>\s*(\d+)u?/g)].map(m => '>>' + m[1]);
  const masks  = [...s.matchAll(/&\s*(\d+)u?/g)].map(m => '&' + m[1]);
  return shifts.concat(masks).sort();
}
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Pull one WGSL function out by name, by brace matching.
 *
 * ⚠ This used to slice by "from `fn fs_main` to whatever function happens to come next",
 * which is only correct while nobody adds a function. Adding `vs_model` between `fs_main`
 * and `vs_pos` made the FRAGMENT slice swallow the whole model VERTEX shader, and the
 * cross-backend constant check reported a 38-constant "drift" that did not exist. A test
 * that fails when the file is merely rearranged is a test nobody will trust the third time.
 */
function wgslFn(name) {
  const at = WGSL.indexOf('fn ' + name);
  if (at < 0) return '';
  const open = WGSL.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < WGSL.length; i++) {
    if (WGSL[i] === '{') depth++;
    else if (WGSL[i] === '}') { depth--; if (depth === 0) return WGSL.slice(at, i + 1); }
  }
  return WGSL.slice(at);
}
const wgslVS = wgslFn('vs_main');
const wgslFS = wgslFn('fs_main');
const wgslPos = wgslFn('vs_pos');
const wgslFlat = wgslFn('fs_flat');
// ⚠ s16 is a separate `fn` in WGSL and an inline helper inside the GLSL model shader — the
// same code, split differently by the two languages. Comparing vs_model alone therefore
// showed a phantom one-mask difference. Join them so the comparison is like for like.
const wgslModel = wgslFn('s16') + '\n' + wgslFn('vs_model');
// PLAN G10d — the hand's pair (D-359).
const wgslHandVS = wgslFn('vs_hand');
const wgslHandFS = wgslFn('fs_hand');

// the extractor has to actually extract something, or every check below passes vacuously
need(wgslVS.length > 200 && wgslFS.length > 100 && wgslPos.length > 100 && wgslFlat.length > 50,
     'cross: the WGSL function extractor found all four core entry points',
     `vs_main ${wgslVS.length}  fs_main ${wgslFS.length}  vs_pos ${wgslPos.length}  fs_flat ${wgslFlat.length}`);
need((wgslFS.match(/\bfn /g) || []).length === 1,
     'cross: the fragment slice contains exactly one function',
     'found ' + (wgslFS.match(/\bfn /g) || []).length + ' in ' + wgslFS.slice(0, 90).replace(/\s+/g, ' '));

need(sameList(bitOps(GLSL.VS), bitOps(wgslVS)),
     'cross: vertex bit decode is identical',
     'GLSL ' + bitOps(GLSL.VS).join(' ') + '\nWGSL ' + bitOps(wgslVS).join(' '));

need(sameList(floatLits(GLSL.VS), floatLits(wgslVS)),
     'cross: vertex float constants are identical',
     'GLSL ' + floatLits(GLSL.VS).join(' ') + '\nWGSL ' + floatLits(wgslVS).join(' '));

// The MODEL vertex stage, cross-checked the same way. It is a second pair of shaders that
// must agree across the backends (D-3/D-52) — the whole reason it shares fs_main with the
// cube path is so the lighting cannot drift, and this is what says it has not.
need(wgslModel.length > 200, 'cross: the WGSL model vertex shader exists',
     'vs_model ' + wgslModel.length + ' chars');
need(sameList(bitOps(GLSL.VS_MODEL || ''), bitOps(wgslModel)),
     'cross: MODEL vertex bit decode is identical',
     'GLSL ' + bitOps(GLSL.VS_MODEL || '').join(' ') + '\nWGSL ' + bitOps(wgslModel).join(' '));
need(sameList(floatLits(GLSL.VS_MODEL || ''), floatLits(wgslModel)),
     'cross: MODEL vertex float constants are identical',
     'GLSL ' + floatLits(GLSL.VS_MODEL || '').join(' ') + '\nWGSL ' + floatLits(wgslModel).join(' '));

need(sameList(floatLits(GLSL.FS), floatLits(wgslFS)),
     'cross: fragment float constants are identical',
     'GLSL ' + floatLits(GLSL.FS).join(' ') + '\nWGSL ' + floatLits(wgslFS).join(' '));

need(sameList(bitOps(GLSL.VS_POS), bitOps(wgslPos)),
     'cross: position-only bit decode is identical',
     'GLSL ' + bitOps(GLSL.VS_POS).join(' ') + '\nWGSL ' + bitOps(wgslPos).join(' '));

need(sameList(floatLits(GLSL.FS_FLAT).concat(GL_WIRE), floatLits(wgslFlat)),
     'cross: the wireframe colour is the same in both backends',
     'GLSL ' + GL_WIRE.join(' ') + '\nWGSL ' + floatLits(wgslFlat).join(' '));

// ── PLAN G10d: the HAND's pair, and it is the only proof this project can have ─────────────
// ⚠⚠ **THE WEBGPU HAND CANNOT BE RUN ON ANY MACHINE THIS PROJECT HAS.** Headless Chromium here
// has `navigator.gpu` and no adapter (D-310), and Dan's own WebGPU path still renders a black
// world. So the WGSL below has never executed, and the honest thing is to say so and to assert
// what CAN be asserted: that the two languages encode the same maths, which is exactly the
// mechanism D-3 and D-52 set up for the cube and model shaders.
need(wgslHandVS.length > 100 && wgslHandFS.length > 100,
     'cross: the WGSL hand shaders exist',
     'vs_hand ' + wgslHandVS.length + ' fs_hand ' + wgslHandFS.length + ' chars');
need(sameList(floatLits(GLSL.VS_HAND), floatLits(wgslHandVS)),
     'cross: HAND vertex float constants are identical',
     'GLSL ' + floatLits(GLSL.VS_HAND).join(' ') + '\nWGSL ' + floatLits(wgslHandVS).join(' '));
need(sameList(floatLits(GLSL.FS_HAND), floatLits(wgslHandFS)),
     'cross: HAND fragment float constants are identical — the cutout threshold above all',
     'GLSL ' + floatLits(GLSL.FS_HAND).join(' ') + '\nWGSL ' + floatLits(wgslHandFS).join(' '));
// ⚠ AND THE BRANCH THAT PICKS THE TEXTURE. `layer < 0` means "the player skin"; a backend that
// lost that test would draw the arm out of the block atlas and look like garbage in one backend
// and fine in the other — the exact asymmetry this section exists to prevent.
need(/[lL]ayer\s*<\s*0\.0/.test(GLSL.FS_HAND) && /[lL]ayer\s*<\s*0\.0/.test(wgslHandFS),
     'cross: both hand fragment shaders branch on layer < 0 to sample the skin');
need(/discard/.test(GLSL.FS_HAND) && /discard/.test(wgslHandFS),
     'cross: both hand fragment shaders discard below the cutout threshold');

// every constant in Gfx.SHADE has to actually reach both shaders
{
  const S = MCL.Gfx.SHADE, f = MCL.Gfx.f;
  const wanted = [f(S.AO_BASE), f(S.AO_STEP), f(S.AMBIENT), f(S.CUTOUT), f(S.SCROLL), f(S.FOG_CURVE)]
    .concat(S.FACE.map(f)).concat(S.TINT.flat().map(f));
  const glslAll = GLSL.VS + GLSL.FS;
  const missGL = [...new Set(wanted)].filter(v => glslAll.indexOf(v) < 0);
  const missGPU = [...new Set(wanted)].filter(v => WGSL.indexOf(v) < 0);
  need(missGL.length === 0, 'cross: every Gfx.SHADE constant appears in the GLSL', missGL.join(', '));
  need(missGPU.length === 0, 'cross: every Gfx.SHADE constant appears in the WGSL', missGPU.join(', '));
}

// the vertex attribute layout must be the same 8 bytes on both sides
{
  const gpu = text['11_gfx_webgpu.js'];
  need(/arrayStride:\s*NS\.CFG\.VERTEX_BYTES/.test(gpu) && /format:\s*'uint32x2'/.test(gpu),
       'cross: WebGPU vertex buffer is stride VERTEX_BYTES, uint32x2');
  const gl = text['12_gfx_webgl2.js'];
  need(/vertexAttribIPointer\(0,\s*1,\s*gl\.UNSIGNED_INT,\s*8,\s*0\)/.test(gl) &&
       /vertexAttribIPointer\(1,\s*1,\s*gl\.UNSIGNED_INT,\s*8,\s*4\)/.test(gl),
       'cross: WebGL2 vertex attributes are two uint32 at stride 8, offsets 0 and 4');
  need(MCL.CFG.VERTEX_BYTES === 8, 'cross: CFG.VERTEX_BYTES is 8');
}

// ---------------------------------------------------------------------------
// Headless runtime checks — the parts of the renderer that need no GPU
// ---------------------------------------------------------------------------

// camera + frustum
{
  const cam = MCL.Cam.create();
  cam.x = 0; cam.y = 0; cam.z = 0; cam.yaw = 0; cam.pitch = 0;
  cam.aspect = 16 / 9; cam.near = 0.1; cam.far = 256;

  for (const zeroToOne of [false, true]) {
    cam.zeroToOne = zeroToOne;
    MCL.Cam.update(cam);
    const tag = zeroToOne ? 'webgpu clip' : 'webgl clip';
    need(MCL.Cam.aabbVisible(cam, -1, -1, -21, 1, 1, -19), 'camera (' + tag + '): a box 20 ahead is visible');
    need(!MCL.Cam.aabbVisible(cam, -1, -1, 19, 1, 1, 21), 'camera (' + tag + '): a box 20 behind is culled');
    need(!MCL.Cam.aabbVisible(cam, -1, -1, -1001, 1, 1, -999), 'camera (' + tag + '): a box past the far plane is culled');
    need(!MCL.Cam.aabbVisible(cam, 999, -1, -21, 1001, 1, -19), 'camera (' + tag + '): a box far to the right is culled');

    // The extracted near plane must sit exactly cam.near in front of the camera, in BOTH clip
    // conventions. This is the one thing that silently breaks when the [0,1] vs [-1,1] near-row
    // special case in Cam.extractPlanes is wrong: culling still "works", just at the wrong depth.
    const pl = cam.planes;
    const atCam = (i) => pl[i * 4] * cam.x + pl[i * 4 + 1] * cam.y + pl[i * 4 + 2] * cam.z + pl[i * 4 + 3];
    need(Math.abs(atCam(4) + cam.near) < 1e-4,
         'camera (' + tag + '): the near plane is exactly cam.near in front of the eye',
         'signed distance ' + atCam(4) + ', expected ' + (-cam.near));
    need(Math.abs(atCam(5) - cam.far) < 0.5,
         'camera (' + tag + '): the far plane is cam.far in front of the eye',
         'signed distance ' + atCam(5) + ', expected ' + cam.far);
    // the four side planes all pass through the eye
    for (let i = 0; i < 4; i++) {
      need(Math.abs(atCam(i)) < 1e-4, 'camera (' + tag + '): side plane ' + i + ' passes through the eye',
           'signed distance ' + atCam(i));
    }

    // a point on the near plane must map to the convention's near depth
    const p = [0, 0, -cam.near, 1];
    const m = cam.viewProj;
    const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const cz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const ndc = cz / cw;
    need(Math.abs(ndc - (zeroToOne ? 0 : -1)) < 1e-4,
         'camera (' + tag + '): near plane maps to ndc z ' + (zeroToOne ? '0' : '-1'), 'got ' + ndc);
  }

  // pitch clamp: an unclamped +-90 degrees collapses the view basis (forward parallel to up)
  MCL.Cam.setLook(cam, 0, 10);
  need(Math.abs(cam.pitch - MCL.Cam.PITCH_LIMIT) < 1e-12, 'camera: pitch is clamped looking up',
       cam.pitch + ' vs ' + MCL.Cam.PITCH_LIMIT);
  MCL.Cam.setLook(cam, 0, -10);
  need(Math.abs(cam.pitch + MCL.Cam.PITCH_LIMIT) < 1e-12, 'camera: pitch is clamped looking down');
  need(MCL.Cam.PITCH_LIMIT < Math.PI / 2, 'camera: the clamp stops SHORT of vertical');
  MCL.Cam.update(cam);
  {
    const b = MCL.Cam.basis(cam), u = cam.up;
    const len = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
    need(Math.abs(len - 1) < 1e-5 && cam.view.every(Number.isFinite),
         'camera: at the pitch limit the basis is still orthonormal and the view matrix finite',
         'up length ' + len);
    void b;
  }
  MCL.Cam.setLook(cam, 0, 0);

  // forward vector convention: yaw 0 looks -Z, +yaw turns toward +X
  cam.yaw = 0; cam.pitch = 0;
  let f = MCL.Cam.forward(cam);
  need(Math.abs(f[0]) < 1e-6 && Math.abs(f[2] + 1) < 1e-6, 'camera: yaw 0 looks down -Z', [...f].join(','));
  cam.yaw = Math.PI / 2;
  f = MCL.Cam.forward(cam);
  need(Math.abs(f[0] - 1) < 1e-6, 'camera: +yaw turns toward +X', [...f].join(','));
}

// §8 vertex packing round-trip through the real test mesh
{
  MCL.Blocks.init();
  const buf = MCL.Gfx.testMesh();
  need(!!buf, 'mesh: Gfx.testMesh() produced a buffer');
  const hdr = MCL.Mesher.readHeader(buf);
  need(!!hdr, 'mesh: header magic is MSH1');
  const total = hdr.quads[0] + hdr.quads[1] + hdr.quads[2];
  need(buf.byteLength === MCL.CFG.MESH_HEADER_BYTES + total * MCL.CFG.QUAD_BYTES,
       'mesh: buffer length matches the quad counts');
  need(total > 0 && hdr.quads[0] > 0 && hdr.quads[1] > 0 && hdr.quads[2] > 0,
       'mesh: the test mesh exercises all three layers', JSON.stringify(hdr.quads));
  need(total <= MCL.CFG.MAX_QUADS, 'mesh: the test mesh fits the shared index buffer');

  // decode the first opaque quad exactly as the shaders do
  const dv = new Uint32Array(buf, hdr.off[0], hdr.quads[0] * 8);
  const problems = [];
  for (let q = 0; q < hdr.quads[0]; q++) {
    const faces = new Set();
    for (let v = 0; v < 4; v++) {
      const d0 = dv[q * 8 + v * 2], d1 = dv[q * 8 + v * 2 + 1];
      const x = d0 & 63, y = (d0 >>> 6) & 63, z = (d0 >>> 12) & 63;
      const face = (d0 >>> 18) & 7, ao = (d0 >>> 21) & 3;
      const sky = (d0 >>> 23) & 15, blk = (d0 >>> 27) & 15;
      const tile = d1 & 4095, uRep = (d1 >>> 12) & 255, vRep = (d1 >>> 20) & 255;
      const corner = (d1 >>> 28) & 3, tint = (d1 >>> 30) & 3;
      faces.add(face);
      if (face > 5) problems.push('quad ' + q + ' vertex ' + v + ': face ' + face + ' is out of range');
      if (x > 32 || y > 32 || z > 32) problems.push('quad ' + q + ' vertex ' + v + ': position out of a section');
      if (uRep < 1 || vRep < 1) problems.push('quad ' + q + ': uRep/vRep must be at least 1');
      if (tile === 0) problems.push('quad ' + q + ': tile 0 is the missing-texture tile');
      void ao; void sky; void blk; void corner; void tint;
    }
    if (faces.size !== 1) problems.push('quad ' + q + ': all four vertices must share one face id');
    const cs = new Set();
    for (let v = 0; v < 4; v++) cs.add((dv[q * 8 + v * 2 + 1] >>> 28) & 3);
    if (cs.size !== 4) problems.push('quad ' + q + ': the four corner ids must be 0,1,2,3, got ' + [...cs]);
  }
  need(problems.length === 0, 'mesh: every packed field decodes back in range', problems.join('\n'));

  // winding: every face must be counter-clockwise seen from outside
  const windProblems = [];
  for (let face = 0; face < 6; face++) {
    const c = MCL.Gfx.faceCorners(face, 1, 1);
    const a = c[0], b = c[1], d = c[2];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const want = [MCL.CFG.FACE_DX[face], MCL.CFG.FACE_DY[face], MCL.CFG.FACE_DZ[face]];
    const dot = n[0] * want[0] + n[1] * want[1] + n[2] * want[2];
    if (dot <= 0) windProblems.push('face ' + face + ': normal ' + n.join(',') + ' should point ' + want.join(','));
    // corner ids must give (0,0) (1,0) (1,1) (0,1) in some rotation
    const ids = c.map(e => e[3]).sort().join('');
    if (ids !== '0123') windProblems.push('face ' + face + ': corner ids are ' + ids);
  }
  need(windProblems.length === 0, 'mesh: all six faces wind counter-clockwise from outside', windProblems.join('\n'));
}

// atlas -> blocks wiring
{
  const map = MCL.Atlas.map();
  const bad = Object.keys(map).filter(n => MCL.Blocks.ids[n] === undefined);
  need(bad.length === 0, 'atlas: every mapped name is a registered block', bad.join(', '));

  const tiles = [];
  const walk = (v) => { if (typeof v === 'number') tiles.push(v); else for (const k in v) tiles.push(v[k]); };
  Object.values(map).forEach(walk);
  need(tiles.every(t => t > 0 && t < MCL.Atlas.tiles), 'atlas: every mapped tile index is in range',
       tiles.join(','));
  need(!tiles.includes(0), 'atlas: nothing is mapped to the missing-texture tile');

  // every non-air block ends up with a real tile once bindAtlas has run
  MCL.Blocks.bindAtlas(map);
  const untextured = [];
  for (let id = 1; id < MCL.Blocks.count; id++) {
    if (MCL.Blocks.tiles[id * 6] === 0) untextured.push(MCL.Blocks.names[id]);
  }
  need(untextured.length === 0, 'atlas: every registered block has a tile', untextured.join(', '));

  // cutout/translucent blocks must point at tiles whose generator writes a real alpha channel
  const cutout = [];
  for (let id = 1; id < MCL.Blocks.count; id++) {
    if (MCL.Blocks.layer[id] === MCL.CFG.LAYER_CUTOUT && MCL.Blocks.tiles[id * 6] === MCL.Atlas.T.STONE) {
      cutout.push(MCL.Blocks.names[id]);
    }
  }
  need(cutout.length === 0, 'atlas: no cutout block points at an opaque tile', cutout.join(', '));
}

// ===========================================================================
// Smoke test: run BOTH backends against mock graphics contexts.
//
// This is not a rendering test — nothing is rasterised. It is the thing that catches everything
// between "the shader source is well formed" and "a GPU is involved": a method that does not
// exist, a uniform location never fetched, a draw offset computed in indices where the API wants
// bytes, a dynamic-offset ring that does not advance, the fallback chain not falling back.
// Every one of those is a black screen you cannot debug from a double-clicked file.
// ===========================================================================

/** Load a SECOND, independent MCL with browser globals shadowed by fakes. */
function loadMCL(fakes) {
  const names = Object.keys(fakes);
  const body = "'use strict';\n" + FILES.map(f => text[f]).join('\n') + '\nreturn MCL;\n';
  return new Function(...names, body)(...names.map(n => fakes[n]));
}

function fakeCanvas(getContext) {
  return { width: 320, height: 200, addEventListener() {}, getContext };
}
function fakeDocument(canvasFactory) {
  return { createElement: (t) => (t === 'canvas' ? canvasFactory() : {}), addEventListener() {} };
}
const fakeWindow = { addEventListener() {} };

// --- a 2D canvas good enough for 06_atlas.js -------------------------------
function fake2DCanvas() {
  const c = { width: 0, height: 0, _img: null, addEventListener() {} };
  c.getContext = (kind) => (kind !== '2d' ? null : {
    imageSmoothingEnabled: true,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img) => { c._img = img; },
    clearRect() {}, fillRect() {}, set fillStyle(v) {}
  });
  return c;
}

// --- atlas ------------------------------------------------------------------
let atlasMCL;
{
  atlasMCL = loadMCL({ document: fakeDocument(fake2DCanvas), window: fakeWindow, navigator: { hardwareConcurrency: 4 } });
  atlasMCL.Blocks.init();
  atlasMCL.Atlas.build(1);
  const A = atlasMCL.Atlas;
  const sum1 = A.checksum();

  need(A.mips.length === 5, 'atlas: mip chain is 16,8,4,2,1', A.mips.map(m => m.size).join(','));
  need(A.mips.every(m => m.data.length === A.tiles * m.size * m.size * 4),
       'atlas: every mip level is layers x size x size x RGBA');
  need(A.mips[0].data.length === A.tiles * 16 * 16 * 4, 'atlas: level 0 is ' + A.mips[0].data.length + ' bytes for ' + A.tiles + ' tiles');

  // determinism: a second build from the same seed must produce the same texels
  const B = loadMCL({ document: fakeDocument(fake2DCanvas), window: fakeWindow, navigator: { hardwareConcurrency: 4 } });
  B.Blocks.init(); B.Atlas.build(1);
  need(B.Atlas.checksum() === sum1, 'atlas: same seed -> byte-identical texels (checksum ' +
       sum1.toString(16) + ')', 'second build gave ' + B.Atlas.checksum().toString(16));
  B.Atlas.build(2);
  need(B.Atlas.checksum() !== sum1, 'atlas: a different seed produces different texels');

  // alpha-channel semantics (D-51) — these are what the shaders actually branch on
  const T = A.T, lvl0 = A.mips[0].data, TX = A.TILE;
  const alphaOf = (tile) => {
    const a = new Set();
    for (let i = 0; i < TX * TX; i++) a.add(lvl0[(tile * TX * TX + i) * 4 + 3]);
    return a;
  };
  const rgbSum = (tile) => {
    let s = 0;
    for (let i = 0; i < TX * TX; i++) s += lvl0[(tile * TX * TX + i) * 4] + lvl0[(tile * TX * TX + i) * 4 + 1] + lvl0[(tile * TX * TX + i) * 4 + 2];
    return s;
  };
  need([...alphaOf(T.STONE)].every(v => v === 0), 'atlas: stone is an untinted opaque tile (alpha 0)');
  need([...alphaOf(T.GRASS_TOP)].every(v => v === 255), 'atlas: grass_top is fully tint-masked (alpha 255)');
  const gs = alphaOf(T.GRASS_SIDE);
  need(gs.has(0) && gs.has(255), 'atlas: grass_side has both a tinted strip and untinted dirt',
       [...gs].join(','));
  const lv = alphaOf(T.OAK_LEAVES);
  need(lv.has(0) && lv.has(255) && lv.size === 2, 'atlas: leaves are a hard cutout (alpha only 0 or 255)',
       [...lv].join(','));
  need([...alphaOf(T.WATER)].every(v => v > 0 && v < 255), 'atlas: water is translucent',
       [...alphaOf(T.WATER)].join(','));
  const sgAlpha = alphaOf(T.SHORT_GRASS);
  need(sgAlpha.has(0) && sgAlpha.has(255), 'atlas: short_grass is a cutout');

  // cutout tiles must carry real colour inside their holes, or mipping fringes them black
  const holes = [];
  for (let i = 0; i < TX * TX; i++) {
    const o = (T.OAK_LEAVES * TX * TX + i) * 4;
    if (lvl0[o + 3] === 0 && lvl0[o] + lvl0[o + 1] + lvl0[o + 2] < 30) holes.push(i);
  }
  need(holes.length === 0, 'atlas: leaf holes still carry leaf colour (no black mip fringe)',
       holes.length + ' texels are transparent AND black');

  need(rgbSum(T.MISSING) > 0, 'atlas: tile 0 is the visible missing-texture marker');
  // #1329: the dynamic pool at the end of the atlas is blank until Atlas.dynWrite fills it
  const flat = [];
  for (let t = 1; t < A.tiles - (A.dynTiles | 0); t++) {
    const vals = new Set();
    for (let i = 0; i < TX * TX; i++) vals.add(lvl0[(t * TX * TX + i) * 4]);
    if (vals.size < 3) flat.push(t);
  }
  need(flat.length === 0, 'atlas: every tile has real texture variation, not a flat fill',
       'flat tiles: ' + flat.join(','));
}

// --- WebGL2 backend ---------------------------------------------------------
function mockWebGL2() {
  const rec = { calls: [], draws: [], uniforms: [], tex: [], sub: [], state: {} };
  const gl = {};
  let id = 0x1000;
  for (const k of ['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ARRAY_BUFFER',
    'ELEMENT_ARRAY_BUFFER','STATIC_DRAW','UNSIGNED_INT','UNSIGNED_SHORT','TRIANGLES','LINES',
    'TEXTURE_2D_ARRAY','RGBA8','RGBA','UNSIGNED_BYTE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER',
    'NEAREST','NEAREST_MIPMAP_LINEAR','TEXTURE_WRAP_S','TEXTURE_WRAP_T','REPEAT','TEXTURE_BASE_LEVEL',
    'TEXTURE_MAX_LEVEL','NO_ERROR','DEPTH_TEST','CULL_FACE','BACK','CCW','BLEND','SCISSOR_TEST',
    'UNPACK_ALIGNMENT','TEXTURE0','COLOR_BUFFER_BIT','DEPTH_BUFFER_BIT','LESS','LEQUAL','EQUAL','SRC_ALPHA','DYNAMIC_DRAW',
    'ONE_MINUS_SRC_ALPHA','VENDOR','RENDERER','SHADING_LANGUAGE_VERSION','MAX_TEXTURE_SIZE',
    'MAX_ARRAY_TEXTURE_LAYERS']) gl[k] = id++;

  for (const k of ['shaderSource','compileShader','deleteShader','attachShader','bindAttribLocation',
    'linkProgram','deleteProgram','bindBuffer','bufferData','bindVertexArray','enableVertexAttribArray',
    'vertexAttribIPointer','bindTexture','texParameteri','useProgram','uniform1i','uniformMatrix4fv',
    'activeTexture','enable','disable','cullFace','frontFace','pixelStorei','viewport','colorMask',
    'depthMask','depthFunc','blendFunc','clearColor','clear','deleteVertexArray','deleteBuffer',
    'deleteTexture']) gl[k] = (...a) => rec.calls.push([k, ...a]);

  gl.createShader = () => ({ shader: id++ });
  gl.createProgram = () => ({ program: id++ });
  gl.createBuffer  = () => ({ buffer: id++ });
  gl.createVertexArray = () => ({ vao: id++ });
  gl.createTexture = () => ({ texture: id++ });
  gl.getShaderParameter = () => true;
  gl.getProgramParameter = () => true;
  gl.getShaderInfoLog = () => '';
  gl.getProgramInfoLog = () => '';
  gl.getUniformLocation = (p, n) => ({ p, n });
  gl.getError = () => gl.NO_ERROR;
  gl.getExtension = () => null;
  gl.getParameter = () => 'mock';
  gl.texStorage3D = (...a) => { rec.tex.push(['storage', ...a]); };
  gl.texSubImage3D = (...a) => { rec.tex.push(['sub', a[1], a[4], a[5], a[6]]); };
  gl.uniform4f = (loc, a, b, c, d) => rec.uniforms.push([loc.n, a, b, c, d]);
  gl.uniform1f = (loc, v) => rec.uniforms.push([loc.n, v]);   // D-380 -- uAtlasSplit
  gl.drawElements = (mode, count, type, offset) => rec.draws.push({ mode, count, type, offset });
  gl.bufferSubData = (target, offset, data) => rec.sub.push([offset, data.byteLength]);
  gl.readPixels = (x, y, w, h, f, t, out) => { out.fill(7); };
  return { gl, rec };
}

{
  const { gl, rec } = mockWebGL2();
  const canvas = fakeCanvas((t) => (t === 'webgl2' ? gl : null));
  const M = loadMCL({ document: fakeDocument(fake2DCanvas), window: fakeWindow, navigator: { hardwareConcurrency: 4 } });
  M.Blocks.init(); M.Atlas.build(1);
  const L = M.GfxGL;

  need(L.init(canvas, M.Atlas.canvas) === true, 'webgl2: init() succeeds against a mock context', L.failReason);

  const storage = rec.tex.find(r => r[0] === 'storage');
  need(storage && storage[2] === 5 && storage[4] === 16 && storage[5] === 16 && storage[6] === M.Atlas.tiles,
       'webgl2: texStorage3D(2D_ARRAY, 5 levels, RGBA8, 16, 16, ' + M.Atlas.tiles + ' layers)',
       JSON.stringify(storage));
  // D-380: uploadAtlas() always makes TWO TEXTURE_2D_ARRAYs now -- a real one and, when the
  // atlas does not need sharding (as here: the mock's MAX_ARRAY_TEXTURE_LAYERS is unmeasurable
  // and treated as "no cap"), a harmless 1-layer stand-in so uAtlas2 is never incomplete. Both
  // get their full 5-level mip chain uploaded, so 10 'sub' calls is the real count, not 5 --
  // the forced-split block below proves the SPLIT arithmetic itself, which this count cannot.
  // D-589: four arrays now (one real + three 1-layer stand-ins), 5 levels each.
  need(rec.tex.filter(r => r[0] === 'sub').length === 20,
       'webgl2: all five mip levels are uploaded to ALL FOUR atlas arrays (D-380, D-589)');
  need(rec.calls.some(c => c[0] === 'texParameteri' && c[2] === gl.TEXTURE_WRAP_S && c[3] === gl.REPEAT),
       'webgl2: the atlas array wraps with REPEAT (greedy uRep depends on it)');
  need(rec.calls.some(c => c[0] === 'texParameteri' && c[2] === gl.TEXTURE_MIN_FILTER && c[3] === gl.NEAREST_MIPMAP_LINEAR),
       'webgl2: minification is NEAREST_MIPMAP_LINEAR');
  need(rec.calls.filter(c => c[0] === 'vertexAttribIPointer').length === 0,
       'webgl2: no vertex attributes are set up before a mesh exists');
}

// D-589: the atlas outgrew TWO shards (4158 layers vs 2x2048 — session 107's villager clothing) and
// the game refused to start on every WebGL2 machine. Force a cap that needs THREE real shards and
// prove each gets exactly its slice; then force one that needs FIVE and prove it refuses by name.
{
  const { gl, rec } = mockWebGL2();
  const realGetParameter = gl.getParameter;
  const canvas = fakeCanvas((t) => (t === 'webgl2' ? gl : null));
  const M = loadMCL({ document: fakeDocument(fake2DCanvas), window: fakeWindow, navigator: { hardwareConcurrency: 4 } });
  M.Blocks.init(); M.Atlas.build(1);
  const L = M.GfxGL;
  const tiles = M.Atlas.tiles;
  const CAP = Math.ceil(tiles / 3) + 1;            // 3 shards: CAP, CAP, tiles-2*CAP (>0 while tiles >= 7)
  need(tiles - 2 * CAP > 0, 'D-589 setup: the test atlas splits into three real shards', 'tiles=' + tiles + ' cap=' + CAP);
  gl.getParameter = (p) => (p === gl.MAX_ARRAY_TEXTURE_LAYERS) ? CAP : realGetParameter(p);
  need(L.init(canvas, M.Atlas.canvas) === true, 'D-589: init() succeeds when the atlas needs THREE arrays', L.failReason);
  const st = rec.tex.filter(r => r[0] === 'storage' && r[4] === 16 && r[5] === 16).map(r => r[6]);
  need(JSON.stringify(st) === JSON.stringify([CAP, CAP, tiles - 2 * CAP, 1]),
       'D-589: the arrays hold [cap, cap, remainder, stand-in] — no layer dropped or doubled', JSON.stringify(st));
  // the shader addresses the third and fourth shards by the same split
  const fs = rec.calls.filter(c => c[0] === 'shaderSource').map(c => c[2]).join('\n');
  need(/texture\(uAtlas3, vec3\(vUV, vLayer - \(uAtlasSplit \+ uAtlasSplit\)\)\)/.test(fs),
       'D-589: the fragment shader samples shard 3 at vLayer - 2*split');
  need(/texture\(uAtlas4, vec3\(vUV, vLayer - \(uAtlasSplit \+ uAtlasSplit \+ uAtlasSplit\)\)\)/.test(fs),
       'D-589: the fragment shader samples shard 4 at vLayer - 3*split');
}
{
  const { gl } = mockWebGL2();
  const realGetParameter = gl.getParameter;
  const canvas = fakeCanvas((t) => (t === 'webgl2' ? gl : null));
  const M = loadMCL({ document: fakeDocument(fake2DCanvas), window: fakeWindow, navigator: { hardwareConcurrency: 4 } });
  M.Blocks.init(); M.Atlas.build(1);
  const L = M.GfxGL;
  const CAP = Math.max(1, Math.floor((M.Atlas.tiles - 1) / 4));   // 4*CAP < tiles: needs a fifth
  gl.getParameter = (p) => (p === gl.MAX_ARRAY_TEXTURE_LAYERS) ? CAP : realGetParameter(p);
  need(L.init(canvas, M.Atlas.canvas) === false && /fifth shard/.test(L.failReason || ''),
       'D-589 break: an atlas past FOUR arrays refuses by name instead of truncating', L.failReason);
}

// D-380 anti-vacuity: FORCE the atlas past a driver's array-layer ceiling and prove uploadAtlas()
// actually shards rather than merely having code that would, in principle, run. A mock whose
// MAX_ARRAY_TEXTURE_LAYERS always answers "mock" (as above) can never exercise this branch --
// D-30 requires a check that can fail, so this one manufactures the exact failure D-379 found on
// real hardware: a cap smaller than the atlas.
{
  const { gl, rec } = mockWebGL2();
  const realGetParameter = gl.getParameter;
  const canvas = fakeCanvas((t) => (t === 'webgl2' ? gl : null));
  const M = loadMCL({ document: fakeDocument(fake2DCanvas), window: fakeWindow, navigator: { hardwareConcurrency: 4 } });
  M.Blocks.init(); M.Atlas.build(1);
  const L = M.GfxGL;
  const tiles = M.Atlas.tiles;
  need(tiles >= 2, 'D-380 setup: the test atlas has at least 2 layers to split', 'tiles=' + tiles);
  const CAP = Math.max(1, tiles - 1);   // guarantees layers > cap, whatever tiles really is
  gl.getParameter = (p) => (p === gl.MAX_ARRAY_TEXTURE_LAYERS) ? CAP : realGetParameter(p);

  need(L.init(canvas, M.Atlas.canvas) === true,
       'D-380: init() still succeeds when the atlas needs more layers than one array holds',
       L.failReason);

  // filter to just the atlas arrays (16x16 tiles) -- createTintTexture also calls
  // texStorage3D, for an unrelated 256x256x3 array, and must not be counted here.
  const storages = rec.tex.filter(r => r[0] === 'storage' && r[4] === 16 && r[5] === 16);
  need(storages.length === 4, 'D-380/D-589: a capped driver gets four TEXTURE_2D_ARRAYs (two real, two stand-ins)',
       JSON.stringify(storages));
  need(storages[0] && storages[0][6] === CAP,
       'D-380: the first array holds exactly the driver\'s own cap, ' + CAP + ' layers',
       JSON.stringify(storages[0]));
  need(storages[1] && storages[1][6] === (tiles - CAP),
       'D-380: the second array holds exactly the remainder, ' + (tiles - CAP) + ' layers',
       JSON.stringify(storages[1]));
  need(L.atlasSplit === CAP, 'D-380: L.atlasSplit records the real boundary, not a guess',
       'atlasSplit=' + L.atlasSplit);

  const splitUniform = rec.uniforms.find((u) => u[0] === 'uAtlasSplit');
  need(splitUniform && splitUniform[1] === CAP,
       'D-380: uAtlasSplit is uploaded to the shader as the SAME number the arrays were built with',
       JSON.stringify(splitUniform));

  const subs = rec.tex.filter(r => r[0] === 'sub');
  need(subs.length === 20,
       'D-380: every shard gets its full 5-level mip chain (4x5), no layer silently dropped');

  const buf = M.Gfx.testMesh();
  const hdr = M.Mesher.readHeader(buf);
  const h = L.createSectionMesh(buf);
  need(!!h, 'webgl2: createSectionMesh returns a handle');
  need(h.firstQuad[0] === 0 && h.firstQuad[1] === hdr.quads[0] &&
       h.firstQuad[2] === hdr.quads[0] + hdr.quads[1],
       'webgl2: layer quad offsets are cumulative', JSON.stringify(h.firstQuad));
  const ip = rec.calls.filter(c => c[0] === 'vertexAttribIPointer');
  need(ip.length === 2 && ip[0][4] === 8 && ip[0][5] === 0 && ip[1][4] === 8 && ip[1][5] === 4,
       'webgl2: the VAO binds two uint32 attributes at stride 8, offsets 0 and 4',
       JSON.stringify(ip));

  // one full frame, every pass
  rec.draws.length = 0; rec.uniforms.length = 0;
  const state = M.Gfx.testCameraState(null, false);
  L.resize(320, 200);
  L.beginFrame(state);
  L.setPass('depth');       L.drawSection(h, 16, -64, 32, 0);
  L.setPass('opaque');      L.drawSection(h, 16, -64, 32, 0);
  L.setPass('cutout');      L.drawSection(h, 16, -64, 32, 1);
  L.setPass('translucent'); L.drawSection(h, 16, -64, 32, 2);
  L.setPass('wire');        L.drawSection(h, 16, -64, 32, 0);
  L.endFrame();

  need(rec.draws.length === 5, 'webgl2: one frame issued five draws', rec.draws.length + '');
  const tri = rec.draws.slice(0, 4);
  need(tri.every(d => d.mode === gl.TRIANGLES && d.type === gl.UNSIGNED_SHORT),
       'webgl2: the shaded passes draw indexed triangles');
  need(tri[1].count === hdr.quads[0] * 6 && tri[1].offset === 0,
       'webgl2: the opaque draw is quads*6 indices at byte offset 0', JSON.stringify(tri[1]));
  need(tri[2].count === hdr.quads[1] * 6 && tri[2].offset === hdr.quads[0] * 12,
       'webgl2: the cutout draw starts at firstQuad*12 bytes', JSON.stringify(tri[2]));
  need(tri[3].count === hdr.quads[2] * 6 && tri[3].offset === (hdr.quads[0] + hdr.quads[1]) * 12,
       'webgl2: the translucent draw starts after both earlier layers', JSON.stringify(tri[3]));
  const wire = rec.draws[4];
  need(wire.mode === gl.LINES && wire.count === hdr.quads[0] * 8 &&
       wire.offset === M.CFG.MAX_QUADS * 12,
       'webgl2: the wireframe draw is a line list in the second index region', JSON.stringify(wire));

  const origins = rec.uniforms.filter(u => u[0] === 'uOrigin');
  need(origins.length === 5 && origins.every(u => u[1] === 16 && u[2] === -64 && u[3] === 32),
       'webgl2: every draw got the section origin', JSON.stringify(origins));
  need(origins[1][4] === 0 && origins[2][4] === 1 && origins[3][4] === 2,
       'webgl2: the layer mode passed to the shader is 0/1/2 per pass',
       origins.map(o => o[4]).join(','));

  // Per-pass state, checked ONE PASS AT A TIME. Asserting "some call somewhere turned depth
  // writes off" is not an assertion, because a later pass can satisfy it for an earlier one.
  const passState = (name) => {
    rec.calls.length = 0;
    L.setPass(name);
    const last = (fn) => {
      const c = rec.calls.filter(x => x[0] === fn);
      return c.length ? c[c.length - 1].slice(1) : null;
    };
    return {
      depthWrite: last('depthMask') && last('depthMask')[0],
      colorWrite: last('colorMask') && last('colorMask')[0],
      depthFunc: last('depthFunc') && last('depthFunc')[0],
      blend: rec.calls.some(c => c[0] === 'enable' && c[1] === gl.BLEND),
      cull: rec.calls.some(c => c[0] === 'enable' && c[1] === gl.CULL_FACE)
    };
  };
  const expect = {
    depth:       { colorWrite: false, depthWrite: true,  depthFunc: gl.LESS,   blend: false, cull: true  },
    opaque:      { colorWrite: true,  depthWrite: true,  depthFunc: gl.LEQUAL, blend: false, cull: true  },
    cutout:      { colorWrite: true,  depthWrite: true,  depthFunc: gl.LEQUAL, blend: false, cull: true  },
    translucent: { colorWrite: true,  depthWrite: false, depthFunc: gl.LEQUAL, blend: true,  cull: false },
    decal:       { colorWrite: true,  depthWrite: false, depthFunc: gl.EQUAL,  blend: false, cull: true  },
    wire:        { colorWrite: true,  depthWrite: false, depthFunc: gl.LEQUAL, blend: false, cull: false }
  };
  L.beginFrame(state);
  for (const name of Object.keys(expect)) {
    const got = passState(name), want = expect[name];
    const diff = Object.keys(want).filter(k => got[k] !== want[k]);
    need(diff.length === 0, 'webgl2: the "' + name + '" pass sets exactly the right state (ARCH §9 table)',
         diff.map(k => k + ': got ' + got[k] + ', want ' + want[k]).join('; '));
  }
  L.endFrame();

  // capture resolves after the next endFrame
  let captured = null;
  L.capture(0, 0, 4, 4).then(px => { captured = px; });
  L.beginFrame(state); L.endFrame();
  await new Promise(r => setTimeout(r, 0));
  need(captured && captured.length === 64, 'webgl2: capture() resolves after the next endFrame',
       captured ? captured.length + ' bytes' : 'never resolved');

  // --- vertex arenas (ARCH 9.2, D-86) ---------------------------------------
  // Sections share one GPU buffer and one VAO; a second mesh must land in the SAME buffer at a
  // non-overlapping quad offset, and destroying one must recycle a slot rather than delete
  // anything — deleting per section is exactly the driver churn the arena exists to remove.
  {
    const before = rec.calls.filter(c => c[0] === 'deleteBuffer' || c[0] === 'deleteVertexArray').length;
    const h2 = L.createSectionMesh(M.Gfx.testMesh());
    need(!!h2 && h2.vbo === h.vbo && h2.vao === h.vao,
         'webgl2: a second section is sub-allocated into the SAME arena buffer and VAO');
    need(h2.batch === h.batch, 'webgl2: both report the same batch id, so the frontend groups them');
    const cls = M.Gfx.QUAD_CLASSES[M.Gfx.classFor(hdr.quads[0] + hdr.quads[1] + hdr.quads[2])];
    need(h2.firstQuad[0] === cls && h.firstQuad[0] === 0,
         'webgl2: the two slots do not overlap (slot 1 starts one size class in)',
         h.firstQuad[0] + ' then ' + h2.firstQuad[0]);
    const subs = rec.sub.filter(x => x[1] > 0);
    need(subs.length >= 2 && subs[subs.length - 1][0] === cls * M.CFG.QUAD_BYTES,
         'webgl2: the upload is a bufferSubData at the slot byte offset', JSON.stringify(subs.slice(-2)));
    L.destroySectionMesh(h2);
    need(rec.calls.filter(c => c[0] === 'deleteBuffer' || c[0] === 'deleteVertexArray').length === before,
         'webgl2: destroying a section deletes NO GPU object — the slot goes on a free list');
    const h3 = L.createSectionMesh(M.Gfx.testMesh());
    need(h3 && h3.firstQuad[0] === cls, 'webgl2: the freed slot is handed straight back out');
    L.destroySectionMesh(h3);
  }

  L.destroySectionMesh(h);
  need(L.arenas.used === 0, 'webgl2: every arena slot is accounted for after the meshes are gone',
       'in use: ' + L.arenas.used);

  // --- the allocator itself, exhaustively -----------------------------------
  {
    let live = 0, freed = 0;
    const A = new M.Gfx.Arenas(q => { live++; return { q }; }, () => { freed++; });
    const held = [];
    const occupied = new Map();      // arena id -> Set of covered quad indices
    let overlap = 0, oob = 0;
    const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
    for (let i = 0; i < 4000; i++) {
      if (held.length && rng() < 0.45) {
        const k = (rng() * held.length) | 0;
        const e = held.splice(k, 1)[0];
        const set = occupied.get(e.id);
        for (let v = e.rec.quadOfs; v < e.rec.quadOfs + e.n; v++) set.delete(v);
        A.release(e.rec);
        continue;
      }
      const n = 1 + ((rng() * 3000) | 0);
      const rec2 = A.alloc(n);
      if (!rec2) { oob++; continue; }
      if (rec2.quadOfs + M.Gfx.QUAD_CLASSES[rec2.cls] > rec2.arena.q) oob++;
      let set = occupied.get(rec2.id);
      if (!set) occupied.set(rec2.id, set = new Set());
      for (let v = rec2.quadOfs; v < rec2.quadOfs + n; v++) {
        if (set.has(v)) overlap++;
        set.add(v);
      }
      held.push({ rec: rec2, id: rec2.id, n });
    }
    need(overlap === 0, 'arena: 4000 mixed alloc/free operations never overlap two sections', overlap + ' collisions');
    need(oob === 0, 'arena: no allocation runs past the end of its arena');
    need(A.used === held.length, 'arena: the in-use slot count matches what is held');
    while (held.length) { const e = held.pop(); A.release(e.rec); }
    need(A.used === 0, 'arena: everything is released');
    need(freed > 0 && A.count <= M.Gfx.QUAD_CLASSES.length,
         'arena: empty arenas beyond one spare per class are handed back',
         'live ' + A.count + ' of ' + live + ' created, ' + freed + ' freed');
  }
}

// --- WebGPU backend ---------------------------------------------------------
function mockWebGPU(opts) {
  opts = opts || {};
  const rec = { pipelines: [], setPipeline: [], draws: [], dynOffsets: [], writeBuffer: [],
                writeTexture: [], submits: 0, configure: null, passes: 0 };
  const buf = (d) => ({
    size: d.size, usage: d.usage, label: d.label, destroy() {},
    mapAsync: () => Promise.resolve(),
    getMappedRange: (o, sz) => {
      const a = new Uint8Array(sz);
      if (opts.mapPattern) { for (let i = 0; i < sz; i++) a[i] = i & 255; } else a.fill(7);
      return a.buffer;
    },
    unmap() {}
  });
  const tex = (d) => ({ label: d.label, mipLevelCount: d.mipLevelCount, size: d.size,
                        createView: () => ({}), destroy() {} });
  const pass = {
    setPipeline: (p) => { rec.setPipeline.push(p.label); },
    setBindGroup: (i, g, off) => { if (off) rec.dynOffsets.push(off[0]); },
    setVertexBuffer() {}, setIndexBuffer() {},
    drawIndexed: (a, b, c, d, e) => rec.draws.push([a, b, c, d, e]),
    end() {}
  };
  const device = {
    lost: new Promise(() => {}),
    pushErrorScope() {}, popErrorScope: () => Promise.resolve(opts.validationError || null),
    createShaderModule: (d) => ({
      code: d.code,
      getCompilationInfo: () => Promise.resolve({ messages: opts.compileError
        ? [{ type: 'error', lineNum: 1, linePos: 1, message: opts.compileError }] : [] })
    }),
    createBuffer: buf, createTexture: tex, createSampler: () => ({}),
    createBindGroupLayout: (d) => d, createBindGroup: (d) => d, createPipelineLayout: (d) => d,
    createRenderPipeline: (d) => { rec.pipelines.push(d.label); return { label: d.label, desc: d }; },
    createCommandEncoder: () => ({
      beginRenderPass: () => { rec.passes++; return pass; },
      copyTextureToBuffer() {}, finish: () => ({})
    }),
    queue: {
      writeBuffer: (b, o, src, so, sz) => rec.writeBuffer.push([b.label, o, sz]),
      writeTexture: (dst, data, layout, size) => rec.writeTexture.push([dst.mipLevel, size.slice()]),
      submit: () => { rec.submits++; }
    }
  };
  const gpu = {
    requestAdapter: () => Promise.resolve(opts.noAdapter ? null
      : { info: { vendor: 'mock', device: 'mock-gpu' }, requestDevice: () => Promise.resolve(device) }),
    getPreferredCanvasFormat: () => 'bgra8unorm'
  };
  const ctx = { configure: (d) => { rec.configure = d; },
                getCurrentTexture: () => ({ createView: () => ({}) }) };
  return { rec, gpu, ctx, device };
}

const GPU_GLOBALS = {
  GPUTextureUsage: { RENDER_ATTACHMENT: 1, COPY_SRC: 2, TEXTURE_BINDING: 4, COPY_DST: 8 },
  GPUBufferUsage:  { UNIFORM: 1, COPY_DST: 2, VERTEX: 4, INDEX: 8, MAP_READ: 16 },
  GPUShaderStage:  { VERTEX: 1, FRAGMENT: 2 },
  GPUMapMode:      { READ: 1 }
};

{
  const { rec, gpu, ctx } = mockWebGPU({ mapPattern: true });
  const canvas = fakeCanvas((t) => (t === 'webgpu' ? ctx : null));
  const M = loadMCL(Object.assign({
    document: fakeDocument(fake2DCanvas), window: fakeWindow,
    navigator: { gpu, hardwareConcurrency: 8 }
  }, GPU_GLOBALS));
  M.Blocks.init(); M.Atlas.build(1);
  const P = M.GfxGPU;

  const okInit = await P.init(canvas, M.Atlas.canvas);
  need(okInit === true, 'webgpu: init() succeeds against a mock device', P.failReason);

  need(rec.configure && (rec.configure.usage & GPU_GLOBALS.GPUTextureUsage.COPY_SRC) !== 0,
       'webgpu: the canvas is configured COPY_SRC so selfTest can read it back');
  need(rec.writeTexture.length === 5 && rec.writeTexture[0][1][0] === 16 && rec.writeTexture[4][1][0] === 1,
       'webgpu: all five atlas mip levels are written (16..1, ' + M.Atlas.tiles + ' layers)',
       JSON.stringify(rec.writeTexture));
  need(rec.writeTexture.every(w => w[1][2] === M.Atlas.tiles),
       'webgpu: every mip write covers all ' + M.Atlas.tiles + ' layers');
  // Updated when the MODEL stream landed: the cube path's five, plus one model pipeline per
  // layer. They are listed by name rather than counted so that adding a sixth cube pipeline
  // and forgetting a model one still fails.
  need(rec.pipelines.length === 15 &&
       ['opaque','cutout','translucent','depth-prepass','wireframe',
        'model-opaque','model-cutout','model-translucent', 'model-additive', 'model-decal', 'model-watermask', 'hand',
        'sky-alpha', 'sky-additive', 'colour-ray'].every(n => rec.pipelines.includes(n)),
       'webgpu: fifteen pipelines created (#5723 water mask + three shaded + depth prepass + wireframe + three model + the #2627 additive swirl + the #1850 decal + the hand + the sky, KW-24, + the colour ray, #1851)',
       rec.pipelines.join(','));

  // KW-24: the sky's own two pipelines exist and carry the right depth/blend state — no
  // depth writes, always passes (it is the first thing drawn each frame, D-303), and the
  // additive variant really does differ from the alpha one (stars/sun/moon vs. the discs).
  need(!!P.pipelines.skyAlpha && !!P.pipelines.skyAdd,
       'webgpu: KW-24 — both sky pipelines (skyAlpha, skyAdd) were created');
  need(P.pipelines.skyAlpha.desc.depthStencil.depthWriteEnabled === false &&
       P.pipelines.skyAlpha.desc.depthStencil.depthCompare === 'always',
       'webgpu: KW-24 — the sky pipelines write no depth and always pass (D-303)');
  need(P.pipelines.skyAlpha.desc.fragment.targets[0].blend.color.dstFactor === 'one-minus-src-alpha' &&
       P.pipelines.skyAdd.desc.fragment.targets[0].blend.color.dstFactor === 'one',
       'webgpu: KW-24 — skyAlpha blends like the discs, skyAdd like the stars/sun/moon (additive)');

  need(P.pipelines.modelDecal.desc.depthStencil.depthCompare === 'equal' &&
       P.pipelines.modelDecal.desc.depthStencil.depthWriteEnabled === false,
       'webgpu: #1850 the decal pipeline compares EQUAL and writes no depth');
  const depthPipe = null;
  need(!!P.pipelines.depth && !P.pipelines.depth.desc.fragment,
       'webgpu: the depth prepass pipeline has NO fragment stage');
  need(P.pipelines.translucent.desc.depthStencil.depthWriteEnabled === false &&
       P.pipelines.translucent.desc.primitive.cullMode === 'none',
       'webgpu: translucent does not write depth and is double sided');
  need(P.pipelines.wire.desc.primitive.topology === 'line-list',
       'webgpu: the wireframe pipeline is a line list');
  need(P.pipelines.opaque.desc.depthStencil.depthCompare === 'less-equal',
       'webgpu: opaque compares LEQUAL so the prepass is optional (D-53)');
  need(P.pipelines.opaque.desc.vertex.buffers[0].arrayStride === 8 &&
       P.pipelines.opaque.desc.vertex.buffers[0].attributes[0].format === 'uint32x2',
       'webgpu: the vertex buffer layout is the §8 8-byte uint32x2');

  const buf = M.Gfx.testMesh();
  const hdr = M.Mesher.readHeader(buf);
  const h = P.createSectionMesh(buf);
  need(!!h && h.bytes === buf.byteLength - M.CFG.MESH_HEADER_BYTES,
       'webgpu: createSectionMesh uploads the vertex data without the 32-byte header');

  rec.setPipeline.length = 0; rec.draws.length = 0; rec.dynOffsets.length = 0; rec.writeBuffer.length = 0;
  const state = M.Gfx.testCameraState(null, true);
  P.resize(320, 200);
  P.beginFrame(state);
  P.setPass('depth');       P.drawSection(h, 16, -64, 32, 0);
  P.setPass('opaque');      P.drawSection(h, 16, -64, 32, 0);
  P.setPass('cutout');      P.drawSection(h, 16, -64, 32, 1);
  P.setPass('translucent'); P.drawSection(h, 16, -64, 32, 2);
  P.setPass('wire');        P.drawSection(h, 16, -64, 32, 0);
  P.endFrame();

  need(rec.passes === 1, 'webgpu: one render pass per frame, pipelines switched inside it');
  need(rec.setPipeline.join(',') === 'depth-prepass,opaque,cutout,translucent,wireframe',
       'webgpu: setPass selects the right pipeline each time', rec.setPipeline.join(','));
  need(rec.draws.length === 5, 'webgpu: one frame issued five draws');
  need(rec.draws[1][0] === hdr.quads[0] * 6 && rec.draws[1][2] === 0,
       'webgpu: the opaque draw is quads*6 indices from index 0', JSON.stringify(rec.draws[1]));
  need(rec.draws[2][0] === hdr.quads[1] * 6 && rec.draws[2][2] === hdr.quads[0] * 6,
       'webgpu: the cutout draw starts at firstQuad*6 INDICES (not bytes)', JSON.stringify(rec.draws[2]));
  need(rec.draws[4][0] === hdr.quads[0] * 8 && rec.draws[4][2] === M.CFG.MAX_QUADS * 6,
       'webgpu: the wireframe draw indexes the second region', JSON.stringify(rec.draws[4]));
  need(rec.dynOffsets.join(',') === '0,256,512,768,1024',
       'webgpu: the per-draw uniform ring advances by the 256-byte stride', rec.dynOffsets.join(','));

  const dynWrite = rec.writeBuffer.find(w => w[0] === 'draw-uniforms');
  need(dynWrite && dynWrite[2] === 5 * 256,
       'webgpu: all per-draw uniforms go up in ONE writeBuffer at endFrame', JSON.stringify(dynWrite));
  need(rec.writeBuffer.filter(w => w[0] === 'frame').length === 1,
       'webgpu: the frame uniform is written exactly once per frame');
  need(rec.submits === 1, 'webgpu: exactly one queue submit per frame');

  // the origin + layer mode actually reach the buffer the shader reads
  need(P.dynData[0] === 16 && P.dynData[1] === -64 && P.dynData[2] === 32,
       'webgpu: the section origin lands in the dynamic uniform');
  const modes = [0, 1, 2, 3, 4].map(i => P.dynData[i * 64 + 3]);
  need(modes.join(',') === '0,0,1,2,0', 'webgpu: layer mode per draw is 0(depth),0,1,2,0(wire)',
       modes.join(','));

  // capture(): the canvas format is bgra8unorm here, and copyTextureToBuffer pads rows to 256
  // bytes. Both have to be undone or selfTest compares nonsense against the WebGL2 capture.
  {
    const cap = P.capture(0, 0, 2, 2);
    P.beginFrame(state); P.endFrame();
    const px = await cap;
    need(px.length === 2 * 2 * 4, 'webgpu: capture returns exactly w*h*4 bytes', px.length + '');
    need(px[0] === 2 && px[1] === 1 && px[2] === 0 && px[3] === 3,
         'webgpu: capture swizzles BGRA back to RGBA', [...px.slice(0, 4)].join(','));
    need(px[8] === 2 && px[9] === 1,
         'webgpu: capture strips the 256-byte row padding', [...px.slice(8, 12)].join(','));
  }

  P.destroySectionMesh(h);
  need(P.meshCount === 0, 'webgpu: destroySectionMesh releases the vertex buffer');
}

// --- the fallback chain -----------------------------------------------------
{
  // WGSL that will not compile must not take the renderer down: Gfx has to fall back to WebGL2
  // and keep a readable reason for the debug overlay.
  const { gpu, ctx } = mockWebGPU({ compileError: 'unresolved identifier "uFrmae"' });
  const { gl } = mockWebGL2();
  const canvas = fakeCanvas((t) => (t === 'webgpu' ? ctx : (t === 'webgl2' ? gl : null)));
  const M = loadMCL(Object.assign({
    document: fakeDocument(fake2DCanvas), window: fakeWindow,
    navigator: { gpu, hardwareConcurrency: 8 }
  }, GPU_GLOBALS));
  M.Blocks.init(); M.Atlas.build(1);

  // ⚠ WebGL2 is the default now (D-15), so an unforced init never touches WebGPU and there
  // is no fallback to observe. The fallback still MATTERS — someone who opts into WebGPU on
  // a driver that cannot compile the WGSL must land on WebGL2 with a readable reason — so
  // the test opts in the way that person would.
  M.Gfx.force = 'webgpu';
  const okInit = await M.Gfx.init(canvas, M.Atlas.canvas);
  M.Gfx.force = null;
  need(okInit === true, 'fallback: a WGSL compile error still leaves a working renderer');
  need(M.Gfx.name === 'webgl2', 'fallback: the active backend is WebGL2', M.Gfx.name);
  need(/WGSL compile error/.test(M.Gfx.fallbackReason) && /uFrmae/.test(M.Gfx.fallbackReason),
       'fallback: the reason names the actual WGSL error', M.Gfx.fallbackReason);
}

{
  // No adapter at all -> same outcome, different reason.
  const { gpu, ctx } = mockWebGPU({ noAdapter: true });
  const { gl } = mockWebGL2();
  const canvas = fakeCanvas((t) => (t === 'webgpu' ? ctx : (t === 'webgl2' ? gl : null)));
  const M = loadMCL(Object.assign({
    document: fakeDocument(fake2DCanvas), window: fakeWindow,
    navigator: { gpu, hardwareConcurrency: 8 }
  }, GPU_GLOBALS));
  M.Blocks.init(); M.Atlas.build(1);
  // opt in, for the same reason as the compile-error case above
  M.Gfx.force = 'webgpu';
  await M.Gfx.init(canvas, M.Atlas.canvas);
  M.Gfx.force = null;
  need(M.Gfx.name === 'webgl2' && /no WebGPU adapter/.test(M.Gfx.fallbackReason),
       'fallback: no adapter falls back with an honest reason', M.Gfx.fallbackReason);
}

{
  // Neither backend: the player must get a report, not a black rectangle.
  const canvas = fakeCanvas(() => null);
  let fatal = null;
  const M = loadMCL({ document: fakeDocument(fake2DCanvas), window: fakeWindow, navigator: { hardwareConcurrency: 2 } });
  M.Blocks.init(); M.Atlas.build(1);
  M.Hud = { fatal: (msg) => { fatal = msg; } };   // 15_hud.js is not loaded here; Gfx only needs .fatal
  const okInit = await M.Gfx.init(canvas, M.Atlas.canvas);
  need(okInit === false, 'fallback: with no backend at all, init() resolves false');
  need(M.Gfx.backend === null && M.Gfx.name === 'none', 'fallback: no backend is left half-installed');
  need(fatal && /No usable GPU backend/.test(fatal) && /WebGL2 context/.test(fatal) && /driver/.test(fatal),
       'fallback: the fatal screen says what the machine is missing', fatal);
}

// --- Gfx frontend end to end ------------------------------------------------
{
  const { rec, gpu, ctx } = mockWebGPU();
  const canvas = fakeCanvas((t) => (t === 'webgpu' ? ctx : null));
  const M = loadMCL(Object.assign({
    document: fakeDocument(fake2DCanvas), window: fakeWindow,
    navigator: { gpu, hardwareConcurrency: 8 }
  }, GPU_GLOBALS));
  M.Blocks.init(); M.Atlas.build(1);
  const G = M.Gfx;
  G.resize(320, 200);
  // ⚠ This block tests the FRONTEND — the upload budget, the culling, the draw list — and
  // its harness mocks only WebGPU. WebGL2 is the default now (D-15), so an unforced init
  // finds no backend at all and every assertion below reports zero. Force the backend this
  // harness actually provides; which backend is DEFAULT is asserted in the fallback block,
  // where both mocks exist.
  G.force = 'webgpu';
  await G.init(canvas, M.Atlas.canvas);
  need(G.name === 'webgpu', 'frontend: asking for WebGPU explicitly gets WebGPU',
       'got ' + G.name + '  reason: ' + G.fallbackReason);

  // hand it ten sections; the upload budget must spread them over frames (D-43)
  for (let i = 0; i < 10; i++) G.setSectionMesh(i, 0, 4, M.Gfx.testMesh());
  // the ten sections sit at world y 0..16, x 0..160, z 0..16; stand off to the +Z side of them
  G.cam.x = 80; G.cam.y = 8; G.cam.z = 60; G.cam.yaw = 0; G.cam.pitch = 0;
  G.render(0);
  need(G.meshes.size === M.CFG.UPLOADS_PER_FRAME,
       'frontend: only UPLOADS_PER_FRAME sections are uploaded per frame', G.meshes.size + '');
  G.render(0.016); G.render(0.032);
  need(G.meshes.size === 10 && G.uploadQueue.length === 0,
       'frontend: the upload queue drains over subsequent frames', G.meshes.size + '');

  // culling has to actually reject something
  G.cam.yaw = Math.PI;
  G.render(0.05);
  const behind = G.culled;
  G.cam.yaw = 0;
  G.render(0.06);
  need(behind > 0 && behind > G.culled,
       'frontend: turning around culls the sections that are now behind the camera',
       'facing away culled ' + behind + ', facing toward culled ' + G.culled);
  need(G.draws > 0 && G.tris > 0, 'frontend: something is actually drawn', JSON.stringify(G.stats()));

  // wireframe adds the line passes without disturbing the shaded ones
  rec.setPipeline.length = 0;
  G.wireframe = true;
  G.render(0.07);
  need(rec.setPipeline.includes('wireframe'), 'frontend: F4 wireframe reaches the backend');
  G.wireframe = false;

  rec.setPipeline.length = 0;
  G.depthPrepass = true;
  G.render(0.08);
  need(rec.setPipeline[0] === 'depth-prepass',
       'frontend: F6 depth prepass runs before the shaded passes', rec.setPipeline.join(','));
  G.depthPrepass = false;

  // dropping everything must release every handle
  G.dropAll();
  need(G.meshes.size === 0 && M.GfxGPU.meshCount === 0, 'frontend: dropAll releases every mesh');
}

// --- Gfx.selfTest: the D-3 cross-backend comparison ------------------------
{
  // One document whose canvases answer BOTH contexts, so selfTest can stand the two backends
  // side by side: the live one on the main canvas, the other on a scratch canvas.
  const gpuMock = mockWebGPU();
  const glMock = mockWebGL2();
  const anyCanvas = () => {
    const c = fake2DCanvas();
    const get2d = c.getContext;
    c.getContext = (k) => (k === '2d' ? get2d('2d')
                         : k === 'webgl2' ? glMock.gl
                         : k === 'webgpu' ? gpuMock.ctx : null);
    return c;
  };
  const canvas = anyCanvas();
  canvas.width = 320; canvas.height = 200;
  const M = loadMCL(Object.assign({
    document: { createElement: (t) => (t === 'canvas' ? anyCanvas() : {}), addEventListener() {} },
    window: fakeWindow, navigator: { gpu: gpuMock.gpu, hardwareConcurrency: 8 }
  }, GPU_GLOBALS));
  M.Blocks.init(); M.Atlas.build(1);
  const G = M.Gfx;
  G.resize(320, 200);
  await G.init(canvas, M.Atlas.canvas);
  // ⚠ The two roles swapped when WebGL2 became the default (D-15, blocker B1). selfTest
  // captures the LIVE backend as `a` and brings the OTHER one up on a scratch canvas as
  // `b`, so `a` is now webgl2 and `b` is webgpu. What the test is actually for is that the
  // two agree — asserting WHICH is live was never the point, and hard-coding it is what
  // made a deliberate default change look like four failures.
  need(G.name === 'webgl2', 'selfTest: the live backend is the default one', 'got ' + G.name);

  const r = await G.selfTest();
  need(r.a && r.a.name === G.name, 'selfTest: captured a frame from the live backend', JSON.stringify(r));
  need(r.b && r.b.name !== r.a.name && ['webgl2', 'webgpu'].indexOf(r.b.name) >= 0,
       'selfTest: brought the OTHER backend up on a scratch canvas and captured it', JSON.stringify(r));
  need(r.match === true && r.maxDiff === 0,
       'selfTest: reports the two captures as matching when they do', JSON.stringify(r));
  need(typeof r.a.hash === 'string' && r.a.hash.length > 0,
       'selfTest: each capture carries a hash for the debug overlay');
  // the LIVE backend is the one that must be restored; it is GfxGL now, not GfxGPU
  const live = G.name === 'webgpu' ? M.GfxGPU : M.GfxGL;
  need(live.vw === 320 && live.vh === 200,
       'selfTest: the live backend is restored to the real drawing-buffer size afterwards',
       G.name + ' ' + live.vw + 'x' + live.vh);
  need(M.GfxGPU.meshCount === 0 && M.GfxGL.meshCount === 0,
       'selfTest: the test meshes are destroyed on both backends');
}

// ---------------------------------------------------------------------------

console.log('');
// ---------------------------------------------------------------------------
// ANTI-VACUITY (D-30). Session 4: shadercheck was one of the four checks with no such section,
// and it is the one where a vacuous pass is easiest to write — every assertion here is a REGEX
// over generated source, and a regex that matches nothing passes an empty file. So each break
// feeds this file's own patterns a shader that is wrong in exactly the way the pattern claims
// to catch, and requires the pattern to reject it.
// ---------------------------------------------------------------------------
{
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  brk('a GLSL source with no #version line', () => {
    const broken = 'precision highp float;\nvoid main(){}\n';
    if (!/^#version 300 es\s*$/m.test(broken.split('\n')[0])) throw 0;
  });

  brk('a vertex shader that never writes gl_Position', () => {
    const broken = '#version 300 es\nvoid main(){ float x = 1.0; }\n';
    if (!/gl_Position\s*=/.test(broken)) throw 0;
  });

  brk('a fragment shader with no vec4 output declared', () => {
    const broken = '#version 300 es\nprecision highp float;\nvoid main(){}\n';
    if (!/\bout\s+vec4\s+\w+\s*;/.test(broken)) throw 0;
  });

  brk('a line that does not terminate', () => {
    // The "every line terminates" scan is what catches a statement missing its semicolon.
    const broken = 'float a = 1.0\nfloat b = 2.0;\n';
    const bad = broken.split('\n').filter((l) => l.trim() && !/[;{}():,]\s*$/.test(l.trim()) && !l.trim().startsWith('//') && !l.trim().startsWith('#'));
    if (bad.length > 0) throw 0;
  });

  brk('the real shaders being empty, which would pass every pattern above', () => {
    // The patterns are only worth anything if there is source for them to run over.
    const total = Object.values(GLSL).map((v) => (typeof v === 'string' ? v.length : 0)).reduce((a, b) => a + b, 0);
    if (total > 2000) throw 0;
  });

  for (const [label, caught] of av) need(caught, 'anti-vacuity: ' + label);
}

// ---------------------------------------------------------------------------
// 11. THE CONTEXT ATTRIBUTES ARE A RULING, NOT A PREFERENCE (D-247)
// ---------------------------------------------------------------------------
// ⚠ Why a check exists for six lines of object literal. `desynchronized: true` was in this file
// from session 1 and no instrument this project owns could ever have seen what it does: it asks
// the browser for a low-latency swap chain that skips the compositor, and on real hardware that
// can put a frame on screen the game did not draw. Every check we have reads the buffer the
// ENGINE wrote — counters, readPixels, screenshots — so all of them keep reporting a healthy
// frame while the screen blinks. Dan played a build that differed by this one line and stopped
// seeing the flash. A fence that is not a check is a comment, so this is the check.
{
  const gl2 = readFileSync(join(SRC, '12_gfx_webgl2.js'), 'utf8');
  const m = gl2.match(/getContext\('webgl2',\s*\{([\s\S]*?)\}\)/);
  need(!!m, 'the webgl2 context attributes can be found in the source at all');
  if (m) {
    // ⚠ comments stripped FIRST: the ruling is written above the flag in that file, and the
    // words "desynchronized: true" inside it made this section's own negative test fail on the
    // fixed source. A reader that cannot tell code from prose is not reading the code.
    const attrs = m[1].replace(/\/\/[^\n]*/g, '');
    const has = (k, v) => new RegExp(k + '\\s*:\\s*' + v + '\\s*[,}]').test(attrs);
    need(has('alpha', 'false'), 'alpha is false — the page behind the canvas is never composited through it');
    need(has('preserveDrawingBuffer', 'false'), 'preserveDrawingBuffer is false');
    need(has('desynchronized', 'false'), 'desynchronized is FALSE (D-247) — the low-latency swap chain is off');
    need(!/desynchronized\s*:\s*true/.test(attrs), 'desynchronized: true has not come back');
    need(has('antialias', 'false'), 'antialias is false — MSAA is not affordable on the 2200G (D-12 hardware ladder)');
  }
  // anti-vacuity: the same reader over a source that HAS the flag must fail it
  {
    const bad = "gl = canvas.getContext('webgl2', {\n  alpha: false, desynchronized: true,\n})";
    const bm = bad.match(/getContext\('webgl2',\s*\{([\s\S]*?)\}\)/);
    need(!!bm && /desynchronized\s*:\s*true/.test(bm[1]),
         'anti-vacuity: the attribute reader detects desynchronized: true when it is there');
  }
}

console.log('shadercheck: ' + checks + ' checks passed, ' + warnings + ' warnings, ' + errors + ' failures');
process.exit(errors ? 1 : 0);
