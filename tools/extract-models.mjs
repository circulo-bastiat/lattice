#!/usr/bin/env node
// extract-models.mjs — PLAN G10c. EVERY MODEL LAYER IN THE GAME, as boxes, out of the BYTECODE.
//
//   node tools/extract-models.mjs   -> tools/golden/models-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. Sixty items in the creative inventory draw NOTHING — every chest, all 17
// shulker boxes, all 16 beds, all 16 banners, the six heads, the conduit and the shield. They are
// `builtin/entity` in vanilla: no item sprite, no block model, drawn by running a BLOCK-ENTITY
// RENDERER into the slot. That renderer needs one thing this game does not have: the boxes.
//
// ⚠⚠ **AND THE BOXES EXIST ONLY AS COMPILED JAVA.** There is no JSON for a chest's lid anywhere
// in the jar, in any version. `ChestRenderer.createSingleBodyLayer()` is
// `CubeListBuilder.create().texOffs(0, 19).addBox(1, 0, 1, 14, 10, 14)` and that is the whole
// source of truth. D-263's referee technique reads it structurally, trusting no name. This is the
// FOURTEENTH table that route has produced, and it is the one that unblocks both the sixty blank
// icons and G17c's entity rendering — which is why it extracts ALL 155 layers rather than the ten
// needed today (a hand-picked subset would be the typed roster D-313 caught).
//
// ── HOW EACH CLASS IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE ────────────────────────
//   1. `CubeListBuilder` is the ONLY class in the jar with a `(int, int) -> itself` method. It
//      also has `(float x6) -> itself` and a no-arg static factory, which is `texOffs`, `addBox`
//      and `create` — the three calls every model in the game is built out of.
//   2. `PartPose` is the class `CubeListBuilder`'s consumers pass alongside it, with a
//      `(float, float, float) -> itself` static factory and a ZERO constant.
//   3. `PartDefinition` is the class with an `(String, CubeListBuilder, PartPose) -> itself`
//      method — `addOrReplaceChild`, and the reason the part tree can nest.
//   4. `LayerDefinition` is the class with a `(MeshDefinition, int, int) -> itself` static —
//      `LayerDefinition.create(mesh, textureWidth, textureHeight)`.
//   5. `ModelLayers` is the class whose `<clinit>` is 155 `ldc "<name>"; invokestatic; putstatic`
//      triples of one type. `LayerDefinitions.createRoots` is the ONE class that reads 155 of
//      those fields and pairs each with a static call returning a LayerDefinition.
//
// ⚠ CLOSED IN BOTH DIRECTIONS: every layer `ModelLayers` names must be built by exactly one
// method, and every method that builds one must be named by exactly one layer.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

// GhastEntityModel.getTexturedModelData builds its nine tentacles in a `new Random(1660L)` loop
// (.decomp GhastEntityModel.java) that the walk above cannot read; this replays that loop exactly
// (java.util.Random LCG, nextInt(7)+8 per tentacle, in order) and emits the rows it would have.
export function ghastTentacleRows() {
  const MASK = (1n << 48n) - 1n;
  let s = (1660n ^ 0x5DEECE66Dn) & MASK;
  const next = (b) => { s = (s * 0x5DEECE66Dn + 0xBn) & MASK; return Number(BigInt.asIntN(32, s >> (48n - BigInt(b)))); };
  const nextInt = (n) => { let r = next(31), u = r; for (; ((u - (r = u % n) + (n - 1)) | 0) < 0; u = next(31)); return r; };
  const rows = [];
  for (let i = 0; i < 9; i++) {
    const px = (((i % 3) - (Math.trunc(i / 3) % 2) * 0.5 + 0.25) / 2 * 2 - 1) * 5;
    const pz = (Math.trunc(i / 3) / 2 * 2 - 1) * 5;
    rows.push(['ghast', 'tentacle' + i, 0, 0, -1, 0, -1, 2, nextInt(7) + 8, 2, px, 24.6, pz, 0, 0, 0, 0, 64, 32]);
  }
  return rows;
}


// GuardianEntityModel.getTexturedModelData adds its twelve spikes in a `for` loop over the SPIKE_*
// arrays (.decomp GuardianEntityModel.java); the walk cannot read it, so this replays the loop.
// Each spike is cuboid(-1,-4.5,-1,2,9,2) uv(0,0), pivot SPIKE_PIVOTS_*, rotation PI * SPIKE_{PITCHES,YAWS,ROLLS}.
export function guardianSpikeRows(layer) {
  const P = [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0];
  const Y = [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0];
  const R = [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25];
  const X = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8];
  const PY = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8];
  const Z = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0];
  const pi = Math.fround(Math.PI), ang = (a) => Math.fround(pi * a);
  // getSpikePivotX/Y/Z(i, 0, 0): PIVOT * getAngle (1 + cos(i * 1 ... ) * 0.01 - 0), Y offset by 16
  const f = Math.fround, A = (i) => f(f(1 + f(f(Math.cos(f(f(0 * 1.5) + i))) * 0.01)) - 0);
  return P.map((_, i) => [layer, 'spike' + i, 0, 0, -1, -4.5, -1, 2, 9, 2, f(X[i] * A(i)), f(16 + f(PY[i] * A(i))), f(Z[i] * A(i)), ang(P[i]), ang(Y[i]), ang(R[i]), 0, 64, 64]);
}

// SquidEntityModel.getTexturedModelData adds its eight tentacles in a `for` loop (.decomp
// SquidEntityModel.java): one shared builder uv(48,0).cuboid(-1,0,-1,2,18,2), pivot
// (cos(a)*5, 15, sin(a)*5) with a = i*PI*2/8 (double, then float), yaw (float)(i*PI*-2/8 + PI/2).
export function squidTentacleRows(layer) {
  const rows = [];
  const f32 = (x) => { for (let p = 1; p < 10; p++) { const t = Number(x.toPrecision(p)); if (Math.fround(t) === x) return t; } return x; };
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI * 2.0 / 8.0;
    const px = Math.fround(Math.fround(Math.cos(a)) * 5), pz = Math.fround(Math.fround(Math.sin(a)) * 5);
    const yaw = Math.fround(i * Math.PI * -2.0 / 8.0 + (Math.PI / 2));
    rows.push([layer, 'tentacle' + i, 48, 0, -1, 0, -1, 2, 18, 2, f32(px), 15, f32(pz), 0, f32(yaw), 0, 0, 64, 32]);
  }
  return rows;
}

// WitherEntityModel.getTexturedModelData: part "tail" uv(12,22) cuboid(0,0,0,3,6,3), pivot
// (-2, 6.9+cos(0.20420352)*10, -0.5+sin(0.20420352)*10), pitch 0.265*PI. The pivot is a
// MathHelper.cos/sin expression the walk cannot read, so this evaluates it (float math).
export function witherTailRows() {
  const f32 = (x) => { for (let p = 1; p < 10; p++) { const t = Number(x.toPrecision(p)); if (Math.fround(t) === x) return t; } return x; };
  const a = Math.fround(0.20420352);
  const py = Math.fround(6.9 + Math.fround(Math.cos(a) * 10)), pz = Math.fround(-0.5 + Math.fround(Math.sin(a) * 10));
  return [['wither', 'tail', 12, 22, 0, 0, 0, 3, 6, 3, -2, f32(py), f32(pz), f32(Math.fround(0.265 * Math.fround(Math.PI))), 0, 0, 0, 64, 64]];
}

// BlazeEntityModel.getTexturedModelData adds its twelve rods in three `for` loops (.decomp
// BlazeEntityModel.java): one shared builder uv(0,16).cuboid(0,0,0,2,8,2), pivot (cos(a)*R, Y0+cos(..), sin(a)*R);
// rings i=0..3 R9 a0=0, i=4..7 R7 a0=PI/4, i=8..11 R5 a0=0.47123894, a += 1 per rod. The walk cannot read the loops.
export function blazeRodRows() {
  const f = Math.fround, f32 = (x) => { for (let p = 1; p < 10; p++) { const t = Number(x.toPrecision(p)); if (f(t) === x) return t; } return x; };
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const ring = i < 4 ? 0 : i < 8 ? 1 : 2, a = f([0, f(Math.PI / 4), 0.47123894][ring] + (i - ring * 4)), R = [9, 7, 5][ring];
    const y = ring === 0 ? f(-2 + f(Math.cos(f(f(i * 2) * 0.25)))) : ring === 1 ? f(2 + f(Math.cos(f(f(i * 2) * 0.25)))) : f(11 + f(Math.cos(f(f(f(i * 1.5)) * 0.5))));
    rows.push(['blaze', 'part' + i, 0, 16, 0, 0, 0, 2, 8, 2, f32(f(f(Math.cos(a)) * R)), f32(y), f32(f(f(Math.sin(a)) * R)), 0, 0, 0, 0, 64, 32]);
  }
  return rows;
}

// MagmaCubeEntityModel.getTexturedModelData adds cube0..cube7 in a `for` loop: cuboid(-4,16+i,-4,8,1,8),
// uv (0,i) except i==2 -> (24,10) and i==3 -> (24,19) (.decomp MagmaCubeEntityModel.java).
export function magmaCubeSliceRows() {
  return Array.from({ length: 8 }, (_, i) => ['magma_cube', 'cube' + i, ...(i === 2 ? [24, 10] : i === 3 ? [24, 19] : [0, i]), -4, 16 + i, -4, 8, 1, 8, 0, 0, 0, 0, 0, 0, 0, 64, 32]);
}

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'models-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const esc = (s) => s.replace(/[$]/g, '\\$');
const resolveParam = (v, args) => (typeof v === 'function' ? v(args) : v);

/**
 * Map a static call's collected literal operands onto the LOCAL SLOTS its callee will read them
 * from (D-415). `desc` is the descriptor's parameter list, e.g. `Lemc;F` or `ILemc;`.
 *
 * ⚠ IT REFUSES RATHER THAN GUESSES. When the count of numeric parameters and the count of
 * literals disagree — an argument computed rather than written down, or one this walk did not
 * recognise — the old positional list is returned unchanged, so a caller this rule cannot align
 * is no worse off than before and an unresolved sentinel still reaches the loud failure path at
 * merge time instead of being quietly filled with the wrong number.
 */
// The two literal-push shapes, shared by the builder walk and the shared-definition pairing
// walk (D-415) so the two cannot drift about what counts as a written-down number.
const LIT_FLOAT = /^\s*\d+:\s+(?:fconst_(\d)|ldc(?:_w)?\s+#\d+\s+\/\/ float (-?[\d.]+)f?)\s*$/;
const LIT_INT = /^\s*\d+:\s+(?:iconst_(\d)|bipush\s+(-?\d+)|sipush\s+(-?\d+)|ldc(?:_w)?\s+#\d+\s+\/\/ int (-?\d+))\s*$/;

function slotArgs(desc, nums) {
  const params = [];
  for (let i = 0; i < desc.length; i++) {
    const c = desc[i];
    if (c === '[') continue;                                  // array prefix: the element decides
    if (c === 'L') { params.push({ numeric: false, width: 1 }); i = desc.indexOf(';', i); continue; }
    params.push({ numeric: 'IFDJSBCZ'.indexOf(c) >= 0, width: (c === 'D' || c === 'J') ? 2 : 1 });
  }
  const slots = [];
  let slot = 0;
  for (const pm of params) { if (pm.numeric) slots.push(slot); slot += pm.width; }
  if (slots.length !== nums.length) return nums.slice();
  const out = new Array(slot);
  for (let i = 0; i < slots.length; i++) out[slots[i]] = nums[i];
  return out;
}

// D-6xx (KW-33): does a part built inside a boolean branch (`cond`, set alongside `push` in
// the box walk above) belong to THIS caller? `args` is the caller's own literal argument list
// (`p.args` for a direct pair, `delegateArgs` one hop down) indexed the same way `cond.slot`
// is — by the callee's OWN parameter slot, via `slotArgs`. An untagged part (`cond` null/
// undefined) is unconditional and always matches. A tagged part whose slot this walk could
// not resolve a literal for (an unresolved sentinel, or a caller that never reached this far)
// is KEPT rather than dropped — silently losing a real box because of a gap in `args` would
// be a worse wrong answer than an extra one that should not be there.
function condMatches(part, args) {
  if (!part.cond) return true;
  return part.cond.every((c) => {
    const v = args && args[c.slot];
    if (v === undefined) return true;
    return !!v === c.truthy;
  });
}

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' models-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-mdl-'));
try {
  execFileSync('unzip', ['-o', '-q', JAR, '-d', work]);
  const all = execFileSync('bash', ['-c',
    'cd ' + JSON.stringify(work) + " && find . -name '*.class' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
    { maxBuffer: 1 << 28 }).toString().trim().split('\n');
  say(' classes ............ ' + all.length);

  const javap = (args, names) => {
    let out = '';
    for (let i = 0; i < names.length; i += 300) {
      out += execFileSync('javap', [...args, '-cp', work, ...names.slice(i, i + 300)],
        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    }
    return out.split('\n').filter((l) => !l.startsWith('Picked up'));
  };

  // ── 1. the five classes, by shape ─────────────────────────────────────────────────────────
  const sigs = javap(['-p'], all);
  const members = new Map();
  {
    let cur = null;
    for (const l of sigs) {
      const d = l.trim().match(/^(?:public |final |abstract |static |)*(?:class|interface|enum) ([\w.$]+)/);
      if (d && l.trimEnd().endsWith('{')) { cur = d[1]; members.set(cur, []); continue; }
      if (cur && /^\s{2}\S/.test(l)) members.get(cur).push(l.trim());
    }
  }
  const has = (c, re) => (members.get(c) || []).some((m) => re.test(m));

  let CUBE = null;
  for (const [c, ms] of members) {
    if (!ms.some((m) => m === 'public ' + c + ' a(int, int);' || new RegExp('^public ' + esc(c) + ' \\w+\\(int, int\\);$').test(m))) continue;
    if (!ms.some((m) => new RegExp('^public ' + esc(c) + ' \\w+\\(float, float, float, float, float, float\\);$').test(m))) continue;
    CUBE = c; break;
  }
  ok(!!CUBE, 'no CubeListBuilder: no class with both (int,int)->self and (float x6)->self');
  if (!CUBE) throw new Error('stop');
  say(' CubeListBuilder .... ' + CUBE);

  // ⚠ CubeDeformation, found the same STRUCTURAL way: the class CubeListBuilder's own inflate
  // overload takes as its seventh argument — `addBox(x,y,z,w,h,d, CubeDeformation)`. Naming it
  // by SHAPE (an eighth positional argument on the box adder) rather than guessing at a name
  // means the box walk below can tell "this invokespecial builds the box's own inflate amount"
  // from "this invokespecial builds something else entirely" without trusting any name.
  let DEFORM = null;
  {
    const PRIMS = new Set(['boolean', 'int', 'float', 'double', 'long', 'short', 'byte', 'char']);
    for (const x of members.get(CUBE) || []) {
      const mm = x.match(new RegExp('^public ' + esc(CUBE)
        + ' \\w+\\(float, float, float, float, float, float, ([\\w.$]+)\\);$'));
      if (mm && !PRIMS.has(mm[1])) { DEFORM = mm[1]; break; }
    }
  }
  ok(!!DEFORM, 'no CubeDeformation: CubeListBuilder has no (float x6, X)->self overload');
  say(' CubeDeformation ..... ' + DEFORM);

  let PART = null, POSE = null;
  for (const [c, ms] of members) {
    const m = ms.find((x) => new RegExp('^public ' + esc(c) + ' \\w+\\(java\\.lang\\.String, ' + esc(CUBE) + ', ([\\w.$]+)\\);$').test(x));
    if (m) {
      PART = c;
      POSE = m.match(new RegExp('java\\.lang\\.String, ' + esc(CUBE) + ', ([\\w.$]+)\\)'))[1];
      break;
    }
  }
  ok(!!PART, 'no PartDefinition: nothing takes (String, CubeListBuilder, X)');
  if (!PART) throw new Error('stop');
  say(' PartDefinition ..... ' + PART + '   PartPose = ' + POSE);
  ok(has(POSE, new RegExp('static ' + esc(POSE) + ' \\w+\\(float, float, float\\);')),
     POSE + ' has no (float,float,float) factory — it is probably not PartPose');

  // ⚠⚠ **`PartPose` HAS TWO THREE-FLOAT FACTORIES AND THEY MEAN OPPOSITE THINGS.** `offset(x, y,
  // z)` and `rotation(rx, ry, rz)` have the SAME descriptor, and treating either as the other
  // gives a bed whose legs are translated instead of turned. They are told apart BY USE and not
  // by name: both delegate to the six-float constructor, and `offset` pushes its arguments FIRST
  // then three zeroes, while `rotation` pushes three zeroes first. That is visible in four lines
  // of bytecode and is not a thing an obfuscator can disguise.
  let POSE_OFFSET = null, POSE_ROT = null;
  {
    const code = javap(['-p', '-c'], [POSE]);
    let m = null, seq = [];
    const flush = () => {
      if (!m || seq.length < 6) { seq = []; return; }
      const head = seq.slice(0, 3).join(',');
      if (head === 'load,load,load') POSE_OFFSET = m;
      else if (head === 'zero,zero,zero') POSE_ROT = m;
      seq = [];
    };
    for (const l of code) {
      const ms = l.match(/^\s{2}(?:public |private |)?static [\w.$]+ (\w+)\(float, float, float\);\s*$/);
      if (ms) { flush(); m = ms[1]; continue; }
      if (/^\s{2}\S/.test(l)) { flush(); m = null; continue; }
      if (!m) continue;
      if (/^\s*\d+:\s+fload/.test(l)) seq.push('load');
      else if (/^\s*\d+:\s+fconst_0/.test(l)) seq.push('zero');
    }
    flush();
  }
  ok(!!POSE_OFFSET && !!POSE_ROT && POSE_OFFSET !== POSE_ROT,
     'could not tell PartPose.offset from PartPose.rotation (' + POSE_OFFSET + ' / ' + POSE_ROT + ')');
  say(' PartPose ........... ' + POSE + '.' + POSE_OFFSET + ' = offset · '
      + POSE + '.' + POSE_ROT + ' = rotation');

  // MeshDefinition: the class with a ()->PartDefinition method
  let MESH = null;
  for (const [c, ms] of members) {
    if (ms.some((m) => new RegExp('^public ' + esc(PART) + ' \\w+\\(\\);$').test(m))) { MESH = c; break; }
  }
  ok(!!MESH, 'no MeshDefinition: nothing returns a PartDefinition with no arguments');
  say(' MeshDefinition ..... ' + MESH);

  let LAYER = null;
  for (const [c, ms] of members) {
    if (ms.some((m) => new RegExp('^public static ' + esc(c) + ' \\w+\\(' + esc(MESH) + ', int, int\\);$').test(m))) { LAYER = c; break; }
  }
  ok(!!LAYER, 'no LayerDefinition: nothing is (MeshDefinition,int,int)->self');
  if (!LAYER) throw new Error('stop');
  say(' LayerDefinition .... ' + LAYER);

  // ── 2/3. `LayerDefinitions` AND `ModelLayers`, FOUND TOGETHER AND BY USE ─────────────────
  // ⚠ NEITHER CAN BE FOUND ALONE BY COUNTING FIELDS, and the first version of this tool tried:
  // "the class with 100+ static finals of one type" is `SoundEvents`, which has 1,203 of them.
  // What is unique is the PAIR — one class that reads another class's static fields and hands
  // each straight to a no-argument method returning a LayerDefinition. That happens in exactly
  // one place in the jar, 155 times, and it names both classes at once.
  let ROOTS = null, LAYERS = null, LOCTYPE = null, pairs = [];
  {
    const short = all.filter((n) => n.indexOf('$') < 0 && n.length <= 5);
    const code = javap(['-p', '-c'], short);
    let cur = null, pendingOwner = null, pendingField = null, pendingType = null;
    const per = new Map();
    for (const l of code) {
      const d = l.trim().match(/^(?:public |final |abstract |static |)*class ([\w.$]+)/);
      if (d && l.trimEnd().endsWith('{')) { cur = d[1]; pendingField = null; continue; }
      if (!cur) continue;
      const gs = l.match(/getstatic\s+#\d+\s+\/\/ Field ([\w.$]+)\.(\w+):L([\w/$]+);/);
      if (gs) { pendingOwner = gs[1]; pendingField = gs[2]; pendingType = gs[3]; continue; }
      // ⚠ ANY DESCRIPTOR, not just `()`. Half the layers are built by a factory that takes an
      // argument — `createArmorLayer(CubeDeformation)`, `createBodyLayer(float)` — and demanding
      // a no-argument method read 68 of the game's 155 layers and called that the roster.
      const iv = l.match(new RegExp('invokestatic\\s+#\\d+\\s+// Method ([\\w.$]+)\\.(\\w+):\\([^)]*\\)L' + esc(LAYER) + ';'));
      if (iv && pendingField) {
        const key = cur + '|' + pendingOwner + '|' + pendingType;
        if (!per.has(key)) per.set(key, []);
        per.get(key).push({ field: pendingField, klass: iv[1], method: iv[2] });
        pendingField = null;
      }
    }
    const best = [...per].sort((a, b) => b[1].length - a[1].length)[0];
    if (best) {
      const bits = best[0].split('|');
      ROOTS = bits[0]; LAYERS = bits[1]; LOCTYPE = bits[2].replace(/\//g, '.');
      pairs = best[1];
    }
  }
  ok(!!ROOTS, 'no LayerDefinitions: nothing pairs one class\'s static fields with LayerDefinition builders');
  if (!ROOTS) throw new Error('stop');

  // ── 2b. THE SHARED DEFINITIONS, HELD IN LOCALS ────────────────────────────────────────────
  //
  // ⚠⚠ **THE NOTE THAT USED TO BE HERE SAID THESE LAYERS WERE "REGISTERED BY LOOPS OVER AN ENUM"
  // AND THAT WAS WRONG.** It was written from the shape of the gap rather than from the
  // bytecode, and it stood for a session as the reason 73 of 155 layers could not be read — the
  // exact failure D-263 exists to prevent, in the file that enforces D-263. `createRoots` has
  // **no loop in it at all**: 157 puts, of which 89 take their LayerDefinition from a direct
  // call and **68 take it from a LOCAL VARIABLE** hoisted earlier in the method, because one
  // definition is shared by many layers. The humanoid 64x64 body is one local and it serves
  // player, zombie, husk, drowned, stray, skeleton, piglin, giant and the rest; the quadruped is
  // another and it serves cow, pig and mooshroom; one more is every skull.
  //
  // ⚠ SO THE WALK NEEDS A TWO-SLOT MEMORY AND NOTHING MORE. Track what each `astore` stored and
  // resolve the `aload` at the put. The one wrinkle is that a hoisted definition is usually
  // built as `LayerDefinition.create(SomeModel.createMesh(...), w, h)` — the LAST call before the
  // store belongs to `LayerDefinition` itself, which builds nothing. The producer is the MESH
  // factory one step further back, and the boxes are in that.
  {
    const code = javap(['-p', '-c'], [ROOTS]);
    const reLayerCall = new RegExp('invokestatic\\s+#\\d+\\s+// Method ([\\w.$]+)\\.(\\w+):\\([^)]*\\)L' + esc(LAYER) + ';');
    const reMeshCall = new RegExp('invokestatic\\s+#\\d+\\s+// Method ([\\w.$]+)\\.(\\w+):\\(([^)]*)\\)L' + esc(MESH) + ';');
    const reGet = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(LAYERS) + '\\.(\\w+):L' + esc(LOCTYPE.replace(/\./g, '/')) + ';');
    const locals = new Map();
    let lastLayer = null, lastMesh = null, prevWasLayerCall = false;
    // ⚠⚠ **THE SHARED FACTORY'S ARGUMENTS LIVE HERE, AND ONLY HERE (D-415).** A layer paired
    // through this walk is bound STRAIGHT to the shared mesh factory — there is no
    // `createBodyLayer` in between to carry a `delegateArgs` — so `HumanoidModel.createMesh(
    // CubeDeformation.NONE, 0.0F)`'s own `0.0F` is written down at THIS call site and nowhere
    // else. Without it every `yOffset` the factory adds stays an unresolved sentinel and the
    // whole layer is dropped: 65 layers, which is every humanoid in the game.
    let lit = [];
    let pendingField = null, pendingLocal = null;
    const before = pairs.length;
    for (const raw of code) {
      const l = raw.trim();
      const lc = l.match(reLayerCall);
      if (lc) {
        // ⚠ THE SHEET SIZE IS THE CALLER'S (D-415). `LayerDefinition.create(mesh, 64, 64)` is
        // where a hoisted humanoid's 64x64 is written down — the factory that built the boxes
        // never sees it — so the two literals in front of THIS call are the only copy. Without
        // them every shared layer shipped a 0x0 sheet, and a UV divided by a zero-wide sheet is
        // how a zombie ends up wearing vertical stripes.
        if (lc[1] === LAYER && lastMesh && lit.length >= 2) {
          lastMesh.tw = lit[lit.length - 2]; lastMesh.th = lit[lit.length - 1];
        }
        lastLayer = { klass: lc[1], method: lc[2] }; lit = []; prevWasLayerCall = true; continue;
      }
      const mc = l.match(reMeshCall);
      if (mc) {
        lastMesh = { klass: mc[1], method: mc[2], args: slotArgs(mc[3], lit) };
        lit = []; prevWasLayerCall = false; continue;
      }
      { const fv = l.match(LIT_FLOAT);
        if (fv) { lit.push(parseFloat(fv[1] !== undefined ? fv[1] : fv[2])); continue; } }
      { const iv = l.match(LIT_INT);
        if (iv) { lit.push(parseInt(iv[1] !== undefined ? iv[1] : iv[2] !== undefined ? iv[2]
                     : iv[3] !== undefined ? iv[3] : iv[4], 10)); continue; } }
      const st = l.match(/^\d+:\s+astore(?:_(\d+)|\s+(\d+))\b/);
      if (st) {
        const slot = +(st[1] !== undefined ? st[1] : st[2]);
        // the producer is the mesh factory when the layer call was LayerDefinition.create itself
        let src = prevWasLayerCall ? lastLayer : null;
        if (src && src.klass === LAYER) src = lastMesh;
        if (src) locals.set(slot, src);
        prevWasLayerCall = false;
        continue;
      }
      const gs = l.match(reGet);
      if (gs) { pendingField = gs[1]; pendingLocal = null; prevWasLayerCall = false; continue; }
      const ld = l.match(/^\d+:\s+aload(?:_(\d+)|\s+(\d+))\b/);
      if (ld && pendingField !== null) {
        pendingLocal = +(ld[1] !== undefined ? ld[1] : ld[2]);
        continue;
      }
      if (l.indexOf('ImmutableMap$Builder.put') >= 0) {
        if (pendingField !== null && pendingLocal !== null && locals.has(pendingLocal)) {
          const src = locals.get(pendingLocal);
          if (!pairs.some((q) => q.field === pendingField)) {
            pairs.push({ field: pendingField, klass: src.klass, method: src.method, shared: true,
                         args: src.args, tw: src.tw, th: src.th });
          }
        }
        pendingField = null; pendingLocal = null;
        continue;
      }
      if (l.indexOf('invokestatic') >= 0 || l.indexOf('invokevirtual') >= 0 ||
          l.indexOf('invokespecial') >= 0) { prevWasLayerCall = false; lit = []; }
    }
    say(' shared definitions . ' + locals.size + ' hoisted into locals, pairing '
        + (pairs.length - before) + ' more layers');
    // ⚠ A RANGE, NOT A NUMBER: the point is that the shared path finds MOST of the gap, and a
    // future version of the game moving one definition in or out of a local must not go red.
    ok(pairs.length - before >= 50,
       'only ' + (pairs.length - before) + ' layers came from shared definitions — the local walk has stopped working');
  }
  // ── 2c. RECOVERY PASS — a builder call that takes a CONSTANT ARGUMENT fetched from a static
  // field (`CubeDeformation.NONE` and its siblings) was losing its named field entirely: the
  // pairing walk above tracks "the last getstatic seen" as the named field, and a `getstatic
  // CubeDeformation.NONE` between the named `getstatic ModelLayers.X` and the `invokestatic
  // ...->LayerDefinition` call OVERWRITES that tracking before the call is reached, so the pair
  // is bucketed under the ARGUMENT's owner/type instead of `ModelLayers`/`LOCTYPE` and vanishes
  // from the majority-vote roster entirely (D-324's own class of bug, one level further out).
  // ⚠ THIS IS WHY `creeper`, `pig`, `wither` AND `tropical_fish_*` HAD NO BUILDER AT ALL — not a
  // loop, not a helper: an argument getstatic standing in the way of the one that matters.
  // Now that ROOTS/LAYERS/LOCTYPE are known, re-walk `createRoots` keyed ONLY on getstatic of the
  // KNOWN named-field type — any other getstatic in between cannot break the association.
  {
    const code = javap(['-p', '-c'], [ROOTS]);
    const reNamedGet = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(LAYERS) + '\\.(\\w+):L'
      + esc(LOCTYPE.replace(/\./g, '/')) + ';');
    const reLayerCall = new RegExp('invokestatic\\s+#\\d+\\s+// Method ([\\w.$]+)\\.(\\w+):\\([^)]*\\)L'
      + esc(LAYER) + ';');
    let pendingField = null;
    const before = pairs.length;
    for (const raw of code) {
      const l = raw.trim();
      const ng = l.match(reNamedGet);
      if (ng) { pendingField = ng[1]; continue; }
      const lc = l.match(reLayerCall);
      if (lc && pendingField) {
        if (!pairs.some((q) => q.field === pendingField)) {
          pairs.push({ field: pendingField, klass: lc[1], method: lc[2], recovered: true });
        }
        pendingField = null;
        continue;
      }
      // reaching a put with the named field still pending means its value came from somewhere
      // this pass does not model (a hoisted local, already caught in 2b) — do not carry it over.
      if (l.indexOf('ImmutableMap$Builder.put') >= 0) pendingField = null;
    }
    say(' recovered .......... ' + (pairs.length - before)
        + ' more layers whose builder call takes an argument fetched from a static field');
    ok(pairs.length - before <= 20,
       (pairs.length - before) + ' layers recovered this way — that is too many to be the '
       + 'CubeDeformation-argument case alone; check the pattern has not widened');
  }
  // ── 2d. A LAYER BUILT INLINE: `LayerDefinition.create(<mesh factory>(args), w, h)` ────────────
  // `ModelLayers.PLAYER`/`PLAYER_SLIM` are `TexturedModelData.of(PlayerEntityModel.
  // getTexturedModelData(Dilation.NONE, thinArms), 64, 64)` with no `createBodyLayer` in
  // between, so the pairing above bound them to `LayerDefinition.create` itself -- a method that
  // builds nothing -- and both layers came out empty. Re-walk `createRoots`, remember the last
  // mesh factory call with its slot-indexed literals (the `thinArms` boolean is one) and the two
  // sheet-size literals in front of the create, and re-point every pair bound to `create`.
  {
    const code = javap(['-p', '-c'], [ROOTS]);
    const reNamedGet = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(LAYERS) + '\\.(\\w+):L'
      + esc(LOCTYPE.replace(/\./g, '/')) + ';');
    const reLayerCall = new RegExp('invokestatic\\s+#\\d+\\s+// Method ([\\w.$]+)\\.(\\w+):\\([^)]*\\)L' + esc(LAYER) + ';');
    const reMeshCall = new RegExp('invokestatic\\s+#\\d+\\s+// Method ([\\w.$]+)\\.(\\w+):\\(([^)]*)\\)L' + esc(MESH) + ';');
    let pendingField = null, lit = [], mesh = null, fixed = 0;
    for (const raw of code) {
      const l = raw.trim();
      const ng = l.match(reNamedGet);
      if (ng) { pendingField = ng[1]; lit = []; mesh = null; continue; }
      const mc = l.match(reMeshCall);
      if (mc) { mesh = { klass: mc[1], method: mc[2], args: slotArgs(mc[3], lit) }; lit = []; continue; }
      const lc = l.match(reLayerCall);
      if (lc) {
        if (lc[1] === LAYER && pendingField && mesh && lit.length >= 2) {
          const q = pairs.find((x) => x.field === pendingField);
          if (q && q.klass === LAYER) {
            q.klass = mesh.klass; q.method = mesh.method; q.args = mesh.args;
            q.tw = lit[lit.length - 2]; q.th = lit[lit.length - 1]; fixed++;
          }
        }
        pendingField = null; mesh = null; lit = []; continue;
      }
      const fv = l.match(LIT_FLOAT);
      if (fv) { lit.push(parseFloat(fv[1] !== undefined ? fv[1] : fv[2])); continue; }
      const iv = l.match(LIT_INT);
      if (iv) { lit.push(parseInt(iv[1] !== undefined ? iv[1] : iv[2] !== undefined ? iv[2]
                 : iv[3] !== undefined ? iv[3] : iv[4], 10)); continue; }
      if (l.indexOf('ImmutableMap$Builder.put') >= 0) { pendingField = null; mesh = null; lit = []; }
    }
    say(' inline layers ...... ' + fixed + ' pairs re-pointed from LayerDefinition.create to their mesh factory');
  }
  say(' LayerDefinitions ... ' + ROOTS);
  say(' ModelLayers ........ ' + LAYERS + ' of ' + LOCTYPE + '  (' + pairs.length + ' layers built)');
  // ⚠ 82 OF 155, AND THAT IS THE HONEST NUMBER RATHER THAN A SHORTFALL TO HIDE. The remaining
  // layers are registered by LOOPS — `for (SkullBlock.Types t : values()) put(byType(t), …)` —
  // so there is no `getstatic ModelLayers.PLAYER_HEAD` anywhere to pair with a builder. Reading
  // them needs a different walk, and pretending this one had is how a table gets trusted for
  // rows it never contained. The count is asserted as a RANGE and printed every run.
  ok(pairs.length >= 140, 'only ' + pairs.length + ' layers are built — that is not the roster');

  // ── the layer NAMES, out of ModelLayers' own <clinit> ─────────────────────────────────────
  const layerName = new Map();
  {
    const code = javap(['-p', '-c'], [LAYERS]);
    const ci = code.findIndex((l) => l.trim().startsWith('static {}'));
    ok(ci >= 0, LAYERS + ' has no <clinit>');
    let nm = null, fac = null, prevNm = null;
    const facs = new Map();
    const reFac = new RegExp('invokestatic\\s+#\\d+\\s+// Method (\\w+):\\(Ljava/lang/String;\\)L' + esc(LOCTYPE.replace(/\./g, '/')) + ';');
    const rePut = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(LOCTYPE.replace(/\./g, '/')) + ';');
    for (const l of code.slice(ci)) {
      const s2 = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z][a-z0-9_]*)$/);
      // register("tropical_fish_small", "pattern") pushes two strings; the last one is the layer name
      // and alone collides across both fish (and the banner/shield `pattern`), so keep the entity prefix (#1760)
      if (s2) { prevNm = nm; nm = s2[1]; if (nm === 'pattern' && /^tropical_fish_/.test(prevNm || '')) nm = prevNm + '_pattern'; if (nm === 'outer' && prevNm === 'drowned') nm = 'drowned_outer'; continue; }
      const iv = l.match(reFac);
      if (iv) { fac = iv[1]; facs.set(fac, (facs.get(fac) || 0) + 1); continue; }
      const pu = l.match(rePut);
      if (pu && nm) { layerName.set(pu[1], { name: nm, factory: fac }); nm = null; fac = null; }
    }
    // ⚠ THE FACTORY IS THE VARIANT. `ModelLayers` builds `armor_stand`, `armor_stand/inner_armor`
    // and `armor_stand/outer_armor` from the same string through three different helpers, so the
    // helper's name is the only thing separating them. The commonest one is the plain layer.
    const main = [...facs].sort((a, b) => b[1] - a[1])[0];
    for (const v of layerName.values()) if (main && v.factory !== main[0]) v.name += '#' + v.factory;
    say(' layers named ....... ' + layerName.size + '  (' + facs.size + ' factories, main = '
        + (main ? main[0] : '?') + ')');
    ok(layerName.size >= 100, 'only ' + layerName.size + ' layers have a name');
    if (process.env.MODELDEBUG) {
      for (const q of pairs) {
        const nm = layerName.get(q.field);
        if (nm && /head|skull|conduit/.test(nm.name)) console.log('DBG', nm.name, '->', q.klass + '.' + q.method, q.shared ? '(shared)' : '');
      }
    }
  }

  // ── 4. walk each builder method ───────────────────────────────────────────────────────────
  // ⚠ A LINEAR WALK WITH A TINY STACK MODEL, not a decompiler. The pattern every model uses is
  // `ldc <name>; CubeListBuilder.create(); .texOffs(u,v); .addBox(x,y,z,w,h,d); PartPose...;
  // addOrReplaceChild`, laid out in that order, so the operands can be collected as they are
  // pushed. Anything that does not fit — a loop, a conditional, a helper — is REPORTED rather
  // than guessed at, and the counts at the end say how much was read.
  const wanted = [...new Set(pairs.map((p) => p.klass))];
  const FLOAT = /^\s*\d+:\s+(?:fconst_(\d)|ldc(?:_w)?\s+#\d+\s+\/\/ float (-?[\d.]+)f?)\s*$/;
  const INT = /^\s*\d+:\s+(?:iconst_(\d)|bipush\s+(-?\d+)|sipush\s+(-?\d+)|ldc(?:_w)?\s+#\d+\s+\/\/ int (-?\d+))\s*$/;
  const built = new Map();           // "klass.method" -> { parts: [...], tw, th, odd }
  const seenClasses = new Set();
  // ⚠ A DELEGATE CAN POINT AT A CLASS NOTHING ELSE NAMES. `pig`'s own method never appears as a
  // `pairs` target directly for its BODY — only its "head" — because the body+legs live in a
  // SHARED quadruped mesh factory (`ekr.a`) reached only via `cur.delegate` one level in. The
  // first fetch only ever asked javap for the classes `pairs` names, so a delegate target like
  // that was never in the batch and the merge two steps down found nothing to merge — a
  // plausible-looking pig (a real head) that was quietly missing its whole body. Walk in ROUNDS:
  // fetch what is wanted, see what NEW classes the walk's own delegates now point at, fetch
  // those too, and stop once a round finds nothing new (capped, so a cycle cannot spin forever).
  function walkClasses(classList) {
    const fresh = classList.filter((c) => c && !seenClasses.has(c));
    if (!fresh.length) return;
    fresh.forEach((c) => seenClasses.add(c));
    const bodies = javap(['-p', '-c'], fresh);
  {
    let klass = null, method = null;
    let nums = [], name = null, tex = null, box = null, pose = null, rot = null, mirror = false;
    // ⚠⚠ D-694 (session 137): THE DEFORMATION'S OWN FLOAT(S) WERE DISCARDED, NEVER APPLIED.
    // `cdInit`/`cdExt` below correctly stop a `CubeDeformation` construction from wiping the
    // six box floats it sits next to in the operand run (D-415's fix), but they only ever
    // TRUNCATE `nums` by the deformation's float count -- the grow amount itself (0.5F for
    // every humanoid hat, a per-axis triple for a couple of others) was never kept anywhere,
    // so the box that got built was IDENTICAL to an undilated one: the zombie's (and every
    // other biped's) hat/overlay layer came out as the exact same six numbers as the head it
    // sits on -- two EXACTLY coincident cubes, the hole-in-the-head z-fighting bug. `pendingGrow`
    // carries the parsed grow float(s) from the `cdInit`/`cdExt` line forward to the very next
    // box capture (nothing else lands between a deformation call and the `addBox` it feeds, in
    // any 1.18.2 model), which then inflates the box the way `CubeListBuilder.addBox`'s seven
    // argument overload really does: position pulled in by the grow, size let out by twice the
    // grow, per axis.
    let pendingGrow = null;
    // #1602: a CubeDeformation held in a local (snow golem's one Dilation(-0.5F)) feeds every later addBox
    // that `aload`s it; `cdJust` is the grow of a deformation built by the instruction just before.
    let localGrow = new Map(), cdJust = null, localPose = new Map();
    // #633 (KW-49b): the grow is kept beside the box (`lastG`) -- ModelPart.Cuboid lays the texture
    // out from the UN-grown size, so the TSV needs both.
    let lastG = [0, 0, 0];
    const applyGrow = (b) => {
      if (!pendingGrow || !b || b.length !== 6) { pendingGrow = null; lastG = [0, 0, 0]; return b; }
      const [gx, gy, gz] = pendingGrow.length === 3 ? pendingGrow : [pendingGrow[0], pendingGrow[0], pendingGrow[0]];
      pendingGrow = null; lastG = [gx, gy, gz];
      return [b[0] - gx, b[1] - gy, b[2] - gz, b[3] + 2 * gx, b[4] + 2 * gy, b[5] + 2 * gz];
    };
    // ⚠⚠ **THE PART'S NAME IS THE FIRST STRING OF THE CHAIN, NOT THE LAST (D-415).**
    // `addOrReplaceChild("head", create()...addBox("right_horn", ...).addBox("left_horn",
    // ...), pose)` pushes THREE strings, and the one the part call consumes is the one
    // pushed FIRST. Tracking only "the last ldc String" named the cow's head `left_horn`,
    // which is a part no animation, no check and no reader could ever match.
    let nameList = [];
    let namedBoxes = [];
    let boxAccum = [];
    let localBox = new Map();
    let cur = null;
    // ⚠⚠ D-6xx (KW-33): A BOOLEAN PARAMETER (`thinArms`) GATES TWO MUTUALLY EXCLUSIVE PART
    // LISTS UNDER THE SAME NAMES, AND THIS WALK HAS NO NOTION OF CONTROL FLOW — it reads every
    // instruction top to bottom regardless of `ifeq`/`ifne`/`goto`. `PlayerEntityModel
    // .getTexturedModelData(Dilation, boolean thinArms)` builds `left_arm`/`right_arm`/
    // `left_sleeve`/`right_sleeve` ONE WAY when thinArms, a DIFFERENT way (and, for
    // `right_arm`, NOT AT ALL — it falls through to BipedEntityModel's own) when not — real
    // vanilla source, `.decomp/.../PlayerEntityModel.java`. Reading both branches and
    // picking "whichever ran last in the listing" (an earlier version of this fix) got
    // `left_arm` right by coincidence and `right_arm` wrong: it kept the SLIM one even for
    // thinArms=false callers, because a name that appears in only ONE branch still looks
    // unconditional to a walk with no notion of "branch" at all.
    // ⚠ So: track the ONE if/else shape these methods use (a boolean local loaded, tested,
    // one side ending in `goto` to the join point) and tag every part built inside it with
    // which VALUE of that parameter it needs. `iload_N` immediately followed by `ifeq`/
    // `ifne` is a branch TEST, not a box operand — the sentinel already pushed for it is
    // popped back off. A `goto` while inside the true side flips the tag to the false side;
    // reaching the join offset (the `goto`'s own target) pops the branch and resumes
    // untagged. Parts are resolved against the ACTUAL caller argument at merge time
    // (`condMatches`, D-6xx) — not discarded here, since the same shared `built` entry is
    // read by callers that pass thinArms=true and callers that pass thinArms=false alike.
    let branchStack = [];
    let pendingBranchSlot = null;
    const flush = () => {
      if (cur && (cur.parts.length || cur.tw || cur.delegate)) built.set(klass + '.' + method, cur);
      cur = null;
    };
    for (const l of bodies) {
      if (cdJust && !/invokespecial/.test(l) && !/^\s*\d+:\s+astore/.test(l)) cdJust = null;
      const d = l.trim().match(/^(?:public |final |abstract |static |)*class ([\w.$]+)/);
      if (d && l.trimEnd().endsWith('{')) { flush(); klass = d[1]; continue; }
      const ms = l.match(/^\s{2}(?:public |private |protected |static |final |)*([\w.$<>,\[\] ]+) (\w+)\(([^)]*)\);\s*$/);
      if (ms) {
        flush();
        method = ms[2];
        // ⚠⚠ **A MESH FACTORY IS READ TOO, AND NOT READING ONE IS WHY FIFTY LAYERS WERE "BUILT BY
        // A SHAPE THIS WALK CANNOT READ".** It was never a shape: the walk accepted only methods
        // whose RETURN TYPE is LayerDefinition, and half the game's models put their boxes in a
        // `createMesh()` that returns a MeshDefinition, with the layer method doing nothing but
        // `LayerDefinition.create(createMesh(), 64, 32)`. Every skull in the game is one of
        // those, which is why the six heads were blank in the creative inventory (D-324).
        const ret = ms[1].trim();
        cur = (ret === LAYER || ret === MESH) ? { parts: [], tw: 0, th: 0, odd: 0, ret: ret } : null;
        nums = []; name = null; tex = null; box = null; pose = null; rot = null; mirror = false; pendingGrow = null; namedBoxes = []; nameList = [];
        boxAccum = [];
        localBox = new Map();
        localGrow = new Map(); cdJust = null; localPose = new Map();
        branchStack = []; pendingBranchSlot = null;
        continue;
      }
      if (!cur) continue;
      // ⚠ D-6xx: the offset this line is AT, used to notice when a tracked if/else has been
      // walked past its join point (see the branchStack comment above `flush`).
      {
        const offM = l.match(/^\s*(\d+):/);
        const off = offM ? parseInt(offM[1], 10) : null;
        while (branchStack.length && off !== null
               && branchStack[branchStack.length - 1].mergeAt !== undefined
               && off >= branchStack[branchStack.length - 1].mergeAt) branchStack.pop();
      }
      // an `iload_N` immediately followed by `ifeq`/`ifne` is the boolean branch TEST, not a
      // box operand — pop the sentinel `il` (below) pushed for it and start tracking the branch.
      if (pendingBranchSlot !== null) {
        const brTest = l.trim().match(/^\d+:\s+if(eq|ne)\s+(\d+)\s*$/);
        if (brTest) {
          if (nums.length && typeof nums[nums.length - 1] === 'function') nums.pop();
          // `ifeq target` jumps away when the value is FALSE, so the code immediately after
          // requires it TRUE; `ifne` is the mirror. `mergeAt` is filled in once this side's
          // own `goto` (the join point past the other side) is seen.
          branchStack.push({ slot: pendingBranchSlot, truthy: brTest[1] === 'eq' });
        }
        pendingBranchSlot = null;
        if (brTest) continue;
      }
      {
        const gt = l.trim().match(/^\d+:\s+goto\s+(\d+)\s*$/);
        if (gt && branchStack.length) {
          const top = branchStack[branchStack.length - 1];
          top.truthy = !top.truthy;                 // now inside the else side
          top.mergeAt = parseInt(gt[1], 10);         // the join point, past both sides
          continue;
        }
      }
      // ⚠⚠ **A CUBE CAN BE HOISTED INTO A LOCAL TOO, ONE LEVEL BELOW THE MESH/LAYER LOCALS
      // SECTION 2b ALREADY HANDLES.** `creeper`/`pig` each build ONE leg shape, `astore` it, then
      // `aload` it four times for four differently-posed legs — the same "one definition, many
      // names" shape D-324 found at the LayerDefinition level, recurring at the CubeListBuilder
      // level. Losing it kept three of every four legs silently — a plausible-looking model (one
      // real leg, of the right size) that was still wrong. Remember what an `astore` saw the last
      // FINISHED box as; restore it on the matching `aload` if nothing fresher has been built.
      // ⚠⚠ **A STORED BUILDER TAKES ITS WHOLE `boxAccum` WITH IT, AND LEAVES NONE BEHIND
      // (D-415).** This used to record only `box` — the raw six numbers — and read `tex`/`mirror`
      // from variables the `addBox` handler had ALREADY consumed and reset, so every reuse of a
      // hoisted builder came out at texOffs (0, 0) with no mirror flag. Worse, it left the boxes
      // themselves on `boxAccum`, so the FIRST part to use a hoisted builder emitted every box
      // built so far under its own name: the spider ships `right_hind_leg` twice — once at
      // x −15 and once at x −1, which is the LEFT leg's box wearing the right leg's name — and
      // then seven legs at the wrong texture. A builder that is stored is a builder that is
      // finished: take its boxes, clear the accumulator, and hand the whole list back on each
      // `aload` so a multi-box hoisted builder (nothing in 1.18.2 yet, but the shape is free)
      // works the same way.
      const bst = l.match(/^\s*\d+:\s+astore(?:_(\d+)|\s+(\d+))\s*$/);
      if (bst) {
        const slot = +(bst[1] !== undefined ? bst[1] : bst[2]);
        if (cdJust) { localGrow.set(slot, cdJust); cdJust = null; pendingGrow = null; continue; }
        // a PartPose hoisted into a local and reused by several parts (enderman hat + head share offset(0,-13,0)); the first
        // addOrReplaceChild resets `pose`, so the later aload must restore it
        if (pose && !boxAccum.length) { localPose.set(slot, { pose, rot }); continue; }
        if (boxAccum.length) {
          localBox.set(slot, boxAccum.slice());
          boxAccum = [];
          box = null; tex = null; mirror = false;
        }
        continue;
      }
      const bld = l.match(/^\s*\d+:\s+aload(?:_(\d+)|\s+(\d+))\s*$/);
      if (bld) {
        const slot = +(bld[1] !== undefined ? bld[1] : bld[2]);
        if (localGrow.has(slot)) pendingGrow = localGrow.get(slot);
        if (localPose.has(slot)) { pose = localPose.get(slot).pose; rot = localPose.get(slot).rot; }
        if (localBox.has(slot) && !boxAccum.length) {
          const v = localBox.get(slot);
          for (const be of v) boxAccum.push({ tex: be.tex, box: be.box, mirror: be.mirror, g: be.g });
          const last = v[v.length - 1];
          box = last.box; tex = last.tex; mirror = last.mirror;
        }
        continue;
      }
      // ⚠⚠ **A SHARED MESH FACTORY CAN TAKE ITS OWN BOX DIMENSION AS A PARAMETER, AND THAT VALUE
      // LIVES WITH THE CALLER, NOT THE CALLEE.** `ekr.a(int legHeight, CubeDeformation)` builds
      // the quadruped body pig/cow/mooshroom all share, and a leg's height is `iload_0; i2f` —
      // the CALLER's own literal (pig passes 6) substituted at the call site, not a constant this
      // method owns. Dropping it silently (no rule below recognised `iload`) turned a leg's
      // height into a HOLE in the operand list, which shifted every number after it by one and
      // wrote the DEPTH into the height column — wrong, and not even caught, since five numbers
      // where six were wanted still LOOKED like a box until the columns were checked by hand. A
      // sentinel keeps the slot exactly where it belongs; `resolveParam` fills it in once the
      // caller's own literal argument is known, at merge time.
      const il = l.match(/^\s*\d+:\s+iload(?:_(\d+)|\s+(\d+))\s*$/);
      if (il) { const slot = +(il[1] !== undefined ? il[1] : il[2]); nums.push((args) => args[slot]); pendingBranchSlot = slot; continue; }
      // ⚠⚠ **AND THE SAME THING FOR A `float` PARAMETER, WHICH WAS MISSING AND COST EVERY
      // HUMANOID ITS LEGS (D-415).** `HumanoidModel.createMesh(CubeDeformation, float yOffset)`
      // writes `PartPose.offset(1.9F, 12.0F + yOffset, 0.0F)`, whose bytecode is
      // `ldc 1.9; ldc 12.0; fload_1; fadd; fconst_0`. With no `fload` rule the parameter was
      // INVISIBLE, so `fadd` popped the two literals either side of the hole and folded
      // `1.9 + 12.0 = 13.9` — one number where there should have been two. Every humanoid layer
      // in the game then had a pose list one short: the leg's X became 13.9, its Y became 0 and
      // its Z fell off the end, which is a zombie whose arms hang in the air beside it and whose
      // legs are buried in its chest. The `iload` rule above has been right since it was
      // written; this is its float twin, and nothing else was wrong.
      const fl = l.match(/^\s*\d+:\s+fload(?:_(\d+)|\s+(\d+))\s*$/);
      if (fl) { const slot = +(fl[1] !== undefined ? fl[1] : fl[2]); nums.push((args) => args[slot]); continue; }
      // ⚠ The value can be COMBINED before it reaches the box call — `24 - legHeight`, not just
      // `legHeight` alone. A lazy function closes over whatever is already on `nums`, numeric or
      // itself a pending function, and is not evaluated until the caller's real arguments (from
      // `cur.delegateArgs`, captured at the call site) are known — see `resolveParam` at merge time.
      const arith = l.trim().match(/^\d+:\s+(isub|fsub|iadd|fadd|imul|fmul)\s*$/);
      if (arith) {
        const bnum = nums.pop(), anum = nums.pop();
        const op = /sub$/.test(arith[1]) ? ((x, y) => x - y) : /add$/.test(arith[1]) ? ((x, y) => x + y) : ((x, y) => x * y);
        const lazy = (typeof anum === 'function' || typeof bnum === 'function');
        nums.push(lazy ? ((args) => op(resolveParam(anum, args), resolveParam(bnum, args))) : op(anum, bnum));
        continue;
      }
      const fv = l.match(FLOAT);
      if (fv) { nums.push(parseFloat(fv[1] !== undefined ? fv[1] : fv[2])); continue; }
      const iv = l.match(INT);
      if (iv) { nums.push(parseInt(iv[1] !== undefined ? iv[1] : iv[2] !== undefined ? iv[2] : iv[3] !== undefined ? iv[3] : iv[4], 10)); continue; }
      const st = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Za-z][A-Za-z0-9_]*)$/);
      if (st) { name = st[1]; nameList.push(st[1]); nums = []; continue; }
      if (new RegExp('Method ' + esc(CUBE) + '\\.\\w+:\\(II\\)L' + esc(CUBE) + ';').test(l)) {
        tex = nums.slice(-2); nums = []; continue;
      }
      if (new RegExp('Method ' + esc(CUBE) + '\\.\\w+:\\(Z\\)L' + esc(CUBE) + ';').test(l)) {
        mirror = nums.length ? !!nums[nums.length - 1] : true; nums = []; continue;
      }
      // ⚠⚠ **`mirror()` HAS A NO-ARGUMENT FORM AND IT IS THE ONE THE GAME ACTUALLY WRITES**
      // (D-415). `CubeListBuilder.mirror()` is `mirror(true)`, and every left arm and left leg
      // in the game is built with it: `create().texOffs(40, 16).mirror().addBox(...)`. Only the
      // `(Z)` form above was recognised, so the flag was FALSE for every one of them and the
      // two side faces of each mirrored box took the other side's patch of skin. On the class
      // it is the one INSTANCE method taking nothing and returning a builder (`create()` is the
      // static one, `getCubes()` returns a List), which is what makes `invokevirtual` the
      // discriminator rather than a name this walk would have to guess.
      if (new RegExp('invokevirtual\\s+#\\d+\\s+// Method ' + esc(CUBE) + '\\.\\w+:\\(\\)L'
                     + esc(CUBE) + ';').test(l)) {
        mirror = true; nums = []; continue;
      }
      // ⚠⚠ **AND A FOURTH `addBox` SHAPE: `addBox(String name, float x,y,z, float w,h,d)`.**
      // The cow's two horns, the mooshroom's, the goat's — a NAMED cube with float dimensions,
      // chained onto the same builder as the unnamed head cube before one `addOrReplaceChild`.
      // Nothing recognised it, so the catch-all below wiped the operand run and both horns were
      // LOST; worse, the cube's own name was still sitting in `name` when the part call arrived,
      // so the cow's HEAD shipped under the name `left_horn`. It is an ordinary box of the part
      // its `addOrReplaceChild` names — vanilla's cube names are for lookup, not for splitting a
      // part in two — so it goes on `boxAccum` exactly like the unnamed form.
      // ⚠ #675: TWO MORE NAMED SHAPES CARRYING A `CubeDeformation` (llama head 'neck'/'ear'/'ear',
      // ocelot/cat head 'main'/'nose'/'ear1'/'ear2'): `addBox(String,FFFFFF,CD)` and
      // `addBox(String,FFF,III,CD,II)` (position, size, deformation, texOffs in one call). The
      // catch-all dropped them, so those heads shipped with only their first unnamed box.
      if (new RegExp('Method ' + esc(CUBE) + '\\.\\w+:\\(Ljava/lang/String;FFFFFFL' + esc(DEFORM) + ';\\)L'
                     + esc(CUBE) + ';').test(l)) {
        box = applyGrow(nums.slice(-6)); nums = [];
        boxAccum.push({ tex: tex || [0, 0], box: box, mirror: mirror });
        tex = null;
        continue;
      }
      if (new RegExp('Method ' + esc(CUBE) + '\\.\\w+:\\(Ljava/lang/String;FFFIIIL' + esc(DEFORM) + ';II\\)L'
                     + esc(CUBE) + ';').test(l)) {
        const eight = nums.slice(-8);
        box = applyGrow(eight.slice(0, 6)); nums = [];
        boxAccum.push({ tex: [eight[6], eight[7]], box: box, mirror: mirror });
        tex = null;
        continue;
      }
      if (new RegExp('Method ' + esc(CUBE) + '\\.\\w+:\\(Ljava/lang/String;FFFFFF\\)L'
                     + esc(CUBE) + ';').test(l)) {
        box = applyGrow(nums.slice(-6)); nums = [];
        boxAccum.push({ tex: tex || [0, 0], box: box, mirror: mirror, g: lastG });
        tex = null;
        continue;
      }
      if (new RegExp('Method ' + esc(CUBE) + '\\.\\w+:\\(FFFFFF').test(l)) {
        // `cuboid(FFFFFFZ)` (guardian's mirrored east plate) carries its mirror flag as a 7th operand
        if (new RegExp('Method ' + esc(CUBE) + '\\.\\w+:\\(FFFFFFZ\\)').test(l) && nums.length >= 7) { mirror = !!nums.pop(); }
        box = applyGrow(nums.slice(-6)); nums = [];
        // ⚠⚠ **A CUBE CAN CARRY MORE THAN ONE BOX, AND ONE-BOX-PER-PART WAS THROWING THE REST
        // AWAY.** `pig`'s "head" is TWO `addBox` calls — the skull, then the snout — onto the
        // SAME builder before its ONE `addOrReplaceChild`, and keeping only the LAST box turned
        // "head" into a snout with no skull. Every finished box goes on `boxAccum`; the eventual
        // `addOrReplaceChild` walks all of them under the one shared name and pose, and the
        // ordinary one-box case is just `boxAccum.length === 1`.
        boxAccum.push({ tex: tex || [0, 0], box: box, mirror: mirror, g: lastG });
        tex = null;
        continue;
      }
      // ⚠ TWO POSE FACTORIES, AND DROPPING THE SECOND LOSES EVERY ROTATION IN THE GAME.
      // `PartPose.offset(x, y, z)` is three floats; `PartPose.offsetAndRotation(x, y, z, rx, ry,
      // rz)` is six, and it is what turns a bed's legs, a banner's crossbar and half of every
      // mob. Reading only the three-float form gave a bed whose legs point the wrong way and
      // nothing that said so.
      if (new RegExp('Method ' + esc(POSE) + '\\.\\w+:\\(FFFFFF\\)L' + esc(POSE) + ';').test(l)) {
        var six = nums.slice(-6);
        pose = six.slice(0, 3); rot = six.slice(3); nums = []; continue;
      }
      const p3 = l.match(new RegExp('Method ' + esc(POSE) + '\\.(\\w+):\\(FFF\\)L' + esc(POSE) + ';'));
      if (p3) {
        if (p3[1] === POSE_ROT) { rot = nums.slice(-3); pose = [0, 0, 0]; }
        else { pose = nums.slice(-3); rot = [0, 0, 0]; }
        nums = []; continue;
      }
      // ⚠⚠ **A THIRD SHAPE, AND IT IS THE ENDER DRAGON'S OWN.** `CubeListBuilder.addBox(String
      // name, float x, float y, float z, int w, int h, int d, int texU, int texV)` bundles a
      // whole named box — position, size and texture offset — into ONE call, with no separate
      // `.texOffs()`/`.addBox()` pair, and the dragon's head/body/wings each chain SEVERAL of
      // these onto one builder before its single `addOrReplaceChild` — six boxes share one pose
      // for the head alone. Read each one as its own box the instant it is seen (there is no
      // later point where they could be told apart), and let the eventual `addOrReplaceChild`
      // apply the ONE shared pose to all of them, exactly as the bytecode does.
      const named = l.match(new RegExp('Method ' + esc(CUBE)
        + '\\.\\w+:\\(Ljava/lang/String;FFFIIIII\\)L' + esc(CUBE) + ';'));
      if (named) {
        if (name && nums.length >= 8) {
          const eight = nums.slice(-8);
          namedBoxes.push({ name: name, tex: [eight[6], eight[7]],
                             box: [eight[0], eight[1], eight[2], eight[3], eight[4], eight[5]], mirror: mirror });   // #1519: mirrored() is sticky (dragon_skull)
        } else cur.odd++;
        name = null; nums = [];
        continue;
      }
      // ⚠ `PartDefinition.getChild(String)` CONSUMES A STRING THAT IS NOT A PART NAME (D-415).
      // `SkullModel`'s hat layer is `root.getChild("head").addOrReplaceChild("hat", ...)`: the
      // FIRST string of that statement belongs to the lookup, not to the part being defined, so
      // it has to be taken back off the list or the hat ships under the name `head` and silently
      // REPLACES the head it was meant to sit on top of — one 8x8x8 cube at the hat's own
      // texOffs, which is exactly what this file's own skull assertion caught.
      if (new RegExp('Method ' + esc(PART) + '\\.\\w+:\\(Ljava/lang/String;\\)L' + esc(PART) + ';').test(l)) {
        nameList = []; name = null; nums = []; continue;
      }
      if (new RegExp('Method ' + esc(PART) + '\\.\\w+:\\(Ljava/lang/String;L' + esc(CUBE) + ';L' + esc(POSE) + ';\\)').test(l)) {
        // ⚠ `partName` IS `nameList[0]` — see the declaration above. The cube names that follow
        // it in the chain are lookup keys inside the part, never parts of their own.
        const partName = nameList.length ? nameList[0] : name;
        // ⚠ D-6xx: this addOrReplaceChild call is inside `branchStack`'s if/else exactly when
        // that array is non-empty right now — tag every box it produces with which value of
        // which parameter slot the call needing it. `condMatches` (merge time) drops a tagged
        // part whose caller passed the other value; an untagged part (branchStack empty) is
        // unconditional, as almost every part in the game is.
        const cond = branchStack.length ? branchStack.map((b) => ({ slot: b.slot, truthy: b.truthy })) : null;
        if (namedBoxes.length) {
          for (const nb of namedBoxes) {
            cur.parts.push({ name: partName || nb.name, tex: nb.tex, box: nb.box,
                             pose: pose || [0, 0, 0], rot: rot || [0, 0, 0], mirror: nb.mirror, cond });
          }
        } else if (boxAccum.length) {
          for (const be of boxAccum) {
            cur.parts.push({ name: partName, tex: be.tex, box: be.box, pose: pose || [0, 0, 0],
                             rot: rot || [0, 0, 0], mirror: be.mirror, g: be.g, cond });
          }
        } else if (partName && box && box.length === 6) {
          cur.parts.push({ name: partName, tex: tex || [0, 0], box: box, pose: pose || [0, 0, 0],
                           rot: rot || [0, 0, 0], mirror: mirror, g: lastG, cond });
        } else cur.odd++;
        name = null; tex = null; box = null; pose = null; rot = null; mirror = false; nums = []; pendingGrow = null;
        namedBoxes = []; boxAccum = []; nameList = [];
        continue;
      }
      if (new RegExp('Method ' + esc(LAYER) + '\\.\\w+:\\(L' + esc(MESH) + ';II\\)').test(l)) {
        const two = nums.slice(-2);
        cur.tw = two[0] || 0; cur.th = two[1] || 0; nums = [];
        continue;
      }
      // ⚠ WHERE A LAYER METHOD GOT ITS MESH. One level of delegation is the commonest shape in
      // the game and the sheet size lives in the CALLER, so both halves have to be kept.
      {
        const dg = l.match(new RegExp('invokestatic\\s+#\\d+\\s+// Method (?:([\\w.$]+)\\.)?(\\w+):\\(([^)]*)\\)L' + esc(MESH) + ';'));
        // ⚠⚠ D-6xx (KW-33): A MESH-RETURNING METHOD CAN DELEGATE TO ANOTHER MESH-RETURNING
        // METHOD TOO, AND RESTRICTING THIS TO `cur.ret === LAYER` MISSED THE WHOLE CHAIN.
        // `PiglinEntityModel.getModelData(CubeDeformation)` returns emj (MESH), not emh
        // (LAYER) — it calls `PlayerEntityModel.getTexturedModelData(dilation, false)`,
        // itself MESH-returning, which calls `BipedEntityModel.getModelData(dilation, 0)`,
        // MESH-returning again. With the old `cur.ret === LAYER` guard, NEITHER hop of that
        // chain was ever recorded as a delegate: piglin/piglin_brute/zombified_piglin (and
        // player/player_slim's own base) kept their own head/body/ears but lost every
        // limb BipedEntityModel builds — a piglin with a floating head and torso, no arms,
        // no legs. A method only reaches this point at all when `cur` exists, which line
        // ~486 already restricts to `ret === LAYER || ret === MESH` — so once `dg` (itself
        // anchored to a MESH-returning callee) has matched, there is no further class of
        // caller left to exclude, and the `cur.ret === LAYER` clause was excluding real work.
        if (dg) {
          cur.delegate = (dg[1] || klass) + '.' + dg[2];
          // ⚠⚠ **THE CALLEE READS ITS PARAMETERS BY LOCAL SLOT, SO THE ARGUMENTS MUST BE
          // INDEXED BY SLOT, NOT BY THE ORDER THE LITERALS HAPPENED TO ARRIVE (D-415).** The old
          // `nums.slice()` worked only while the numeric parameter was the FIRST one:
          // `createBodyMesh(int legHeight, CubeDeformation)` puts its int in slot 0, and
          // `nums[0]` is the same cell by luck. `HumanoidModel.createMesh(CubeDeformation,
          // float yOffset)` puts its float in slot 1 — an object parameter pushed by `getstatic`
          // leaves no literal behind — so `args[1]` read `undefined` and every `12.0F + yOffset`
          // resolved to NaN. `slotArgs` walks the call's own DESCRIPTOR instead: when the number
          // of numeric parameters matches the number of literals collected, each literal lands
          // in the slot its parameter actually occupies (`D`/`J` take two, as the JVM says).
          cur.delegateArgs = slotArgs(dg[3], nums);
          nums = []; continue;
        }
      }
      // ⚠⚠ **`addBox` HAS A SEVEN-ARGUMENT SIBLING AND IT WAS SILENTLY EATING BOXES.**
      // `CubeListBuilder.addBox(x,y,z,w,h,d,CubeDeformation)` inflates a box (a sheep's fur over
      // its body, an endermite/silverfish segment) and its call site is `new CubeDeformation;
      // dup; <float(s)>; invokespecial "<init>"; invokevirtual addBox(FFFFFFLCubeDeformation;)`.
      // The box-detector regex already matches this (it only anchors the leading `(FFFFFF`, not
      // the end), so the six box numbers WERE captured correctly — but the deformation's own
      // float(s), pushed by `ldc` right after `new`+`dup`, land in `nums` too, and the
      // catch-all below (any invoke not otherwise recognised ends the run) then saw
      // `invokespecial "<init>"` as "not one of ours" and WIPED THE WHOLE ACCUMULATOR, box
      // included, a few bytecodes before the addBox call that needed it. That is why every
      // inflated box read as zero boxes rather than a wrong one — `sheep_fur`, `endermite`,
      // `silverfish`'s body segments all build this way.
      // ⚠ Remove exactly the deformation's own float(s) — a `CubeDeformation(float)` uniform
      // inflate or a `CubeDeformation(float,float,float)` per-axis one — and do not let this
      // specific invokespecial end the run the way an unrelated one still should.
      const cdInit = l.match(new RegExp('invokespecial\\s+#\\d+\\s+// Method ' + esc(DEFORM)
        + '\\."<init>":\\((F+)\\)V'));
      if (cdInit) {
        const n = cdInit[1].length;
        const vals = nums.slice(nums.length - n);
        if (vals.length && vals.every((v) => typeof v === 'number')) pendingGrow = vals;
        cdJust = pendingGrow;
        nums.length = Math.max(0, nums.length - n);
        continue;
      }
      // ⚠ AND `CubeDeformation.extend(float)` IS THE SAME TRAP WEARING A DIFFERENT HAT (D-415).
      // `addBox(-4, -8, -4, 8, 8, 8, cubeDeformation.extend(0.5F))` builds the HAT of every
      // humanoid in the game; the `extend` call sits between the six box floats and the `addBox`
      // that wants them, so the catch-all below wiped all six and 43 hats came out as `box0` —
      // no box at all. Drop its own float and let the run continue, exactly as for `<init>`.
      const cdExt = l.match(new RegExp('invokevirtual\\s+#\\d+\\s+// Method ' + esc(DEFORM)
        + '\\.\\w+:\\((F+)\\)L' + esc(DEFORM) + ';'));
      if (cdExt) {
        const n = cdExt[1].length;
        const vals = nums.slice(nums.length - n);
        if (vals.length && vals.every((v) => typeof v === 'number')) pendingGrow = vals;
        cdJust = pendingGrow;   // #2657: `Dilation $6 = $0.add(0, 5.5, 0)` held in a local feeds later boxes
        nums.length = Math.max(0, nums.length - n);
        continue;
      }
      // any other call ends the operand run — it is not one of ours
      if (/invoke(virtual|static|special|interface|dynamic)/.test(l)) nums = [];
    }
    flush();
  }
  }
  walkClasses(wanted);
  for (let round = 0; round < 3; round++) {
    const need = [...new Set([...built.values()].map((b) => b.delegate).filter(Boolean)
      .map((d) => d.split('.')[0]))].filter((c) => !seenClasses.has(c));
    if (!need.length) break;
    walkClasses(need);
  }
  say(' builders read ...... ' + built.size + ' of ' + seenClasses.size + ' classes worth');

  // ── 4b. THE LOOP SHAPE — a bounded `for` over a static `int[][]` table, one addOrReplaceChild
  // per iteration. `silverfish` and `endermite` build their segmented bodies this way and the
  // linear walk above cannot follow a branch, so both come out with zero boxes rather than a
  // wrong one (D-305: a walk that cannot see a shape must say so, not guess). This is not a
  // decompiler either — it is a tiny, real stack machine, run for real over the exact bytecode,
  // covering only the handful of opcodes a bounded counting loop over an int table needs. It is
  // a SECOND CHANCE for whatever the first walk left at zero, not a replacement for it.
  const clinitCache = new Map();   // class -> Map("field" -> resolved static value)
  const staticsOf = (klass) => {
    if (clinitCache.has(klass)) return clinitCache.get(klass);
    const statics = new Map();
    let code;
    try { code = javap(['-p', '-c'], [klass]); } catch { clinitCache.set(klass, statics); return statics; }
    const ci = code.findIndex((l) => l.trim().startsWith('static {}'));
    if (ci >= 0) {
      const stack = [];
      let started = false;
      for (const raw of code.slice(ci)) {
        const l = raw.trim();
        const off = l.match(/^(\d+):\s+(.*)$/);
        if (!off) { if (!started) continue; else break; }
        started = true;
        const ins = off[2];
        let m;
        if ((m = ins.match(/^iconst_m1$/))) stack.push(-1);
        else if ((m = ins.match(/^iconst_(\d)$/))) stack.push(+m[1]);
        else if ((m = ins.match(/^(?:bipush|sipush)\s+(-?\d+)/))) stack.push(+m[1]);
        else if ((m = ins.match(/^dup$/))) stack.push(stack[stack.length - 1]);
        else if ((m = ins.match(/^newarray\s+int$/))) { const n = stack.pop(); stack.push(new Array(n).fill(0)); }
        else if ((m = ins.match(/^anewarray\s+#\d+\s+\/\/ class/))) { const n = stack.pop(); stack.push(new Array(n).fill(null)); }
        else if ((m = ins.match(/^iastore$/))) { const v = stack.pop(), i = stack.pop(), a = stack.pop(); a[i] = v; }
        else if ((m = ins.match(/^aastore$/))) { const v = stack.pop(), i = stack.pop(), a = stack.pop(); a[i] = v; }
        else if ((m = ins.match(/^putstatic\s+#\d+\s+\/\/ Field (?:[\w.$]+\.)?(\w+):/))) statics.set(m[1], stack.pop());
        else if (ins === 'return') break;
        else { /* an opcode this clinit-reader does not model — stop rather than guess */ break; }
      }
    }
    clinitCache.set(klass, statics);
    return statics;
  };

  // execute one `public static emh X();`-shaped method body for real, returning the rows it
  // built (or null if it uses an opcode this tiny machine does not cover — reported, not guessed).
  function runLoopMethod(klass, method) {
    let code;
    try { code = javap(['-p', '-c'], [klass]); } catch { return null; }
    const declRe = new RegExp('^(?:public |private |protected |static |final |)*'
      + esc(LAYER) + ' ' + esc(method) + '\\(');
    const startIdx = code.findIndex((l) => declRe.test(l.trim()));
    if (startIdx < 0) return null;
    const body = [];
    for (let i = startIdx + 1; i < code.length; i++) {
      const l = code[i];
      if (/^\s{2}\S.*\(.*\);\s*$/.test(l) || /^\s{2}static \{\}/.test(l.trim())) break;
      const t = l.trim();
      if (/^\d+:/.test(t)) body.push(t);
    }
    const offIndex = new Map();
    body.forEach((l, i) => { offIndex.set(+l.match(/^(\d+):/)[1], i); });

    const statics = staticsOf(klass);
    const locals = {};
    const stack = [];
    const rows = [];
    let tw = 0, th = 0;
    let steps = 0;
    let i = 0;
    while (i < body.length) {
      if (++steps > 20000) return null;   // a real loop terminates long before this — a runaway
                                           // means this machine misread a branch; bail, don't spin
      const l = body[i];
      const ins = l.replace(/^\d+:\s+/, '');
      let m;
      if ((m = ins.match(/^iconst_m1$/))) { stack.push(-1); i++; continue; }
      if ((m = ins.match(/^iconst_(\d)$/))) { stack.push(+m[1]); i++; continue; }
      if ((m = ins.match(/^fconst_(\d)$/))) { stack.push(+m[1]); i++; continue; }
      if ((m = ins.match(/^(?:bipush|sipush)\s+(-?\d+)/))) { stack.push(+m[1]); i++; continue; }
      if ((m = ins.match(/^ldc(?:_w)?\s+#\d+\s+\/\/ float (-?[\d.]+)f?$/))) { stack.push(parseFloat(m[1])); i++; continue; }
      if ((m = ins.match(/^ldc(?:_w)?\s+#\d+\s+\/\/ int (-?\d+)$/))) { stack.push(+m[1]); i++; continue; }
      if ((m = ins.match(/^(?:i|f|a)load(?:_(\d)|\s+(\d+))$/))) { stack.push(locals[+(m[1] ?? m[2])]); i++; continue; }
      if ((m = ins.match(/^(?:i|f|a)store(?:_(\d)|\s+(\d+))$/))) { locals[+(m[1] ?? m[2])] = stack.pop(); i++; continue; }
      if ((m = ins.match(/^iinc\s+(\d+),\s*(-?\d+)/))) { locals[+m[1]] = (locals[+m[1]] || 0) + (+m[2]); i++; continue; }
      if (ins === 'dup') { stack.push(stack[stack.length - 1]); i++; continue; }
      if (ins === 'pop') { stack.pop(); i++; continue; }
      if (ins === 'iadd' || ins === 'fadd') { const b = stack.pop(), a = stack.pop(); stack.push(a + b); i++; continue; }
      if (ins === 'isub' || ins === 'fsub') { const b = stack.pop(), a = stack.pop(); stack.push(a - b); i++; continue; }
      if (ins === 'fmul') { const b = stack.pop(), a = stack.pop(); stack.push(a * b); i++; continue; }
      if (ins === 'i2f') { i++; continue; }   // JS numbers do not distinguish; no-op
      if ((m = ins.match(/^if_icmpge\s+(\d+)/))) { const b = stack.pop(), a = stack.pop(); if (a >= b) { i = offIndex.get(+m[1]); continue; } i++; continue; }
      if ((m = ins.match(/^if_icmplt\s+(\d+)/))) { const b = stack.pop(), a = stack.pop(); if (a < b) { i = offIndex.get(+m[1]); continue; } i++; continue; }
      if ((m = ins.match(/^goto\s+(\d+)/))) { i = offIndex.get(+m[1]); continue; }
      if ((m = ins.match(/^getstatic\s+#\d+\s+\/\/ Field (?:([\w.$]+)\.)?(\w+):/))) {
        const owner = m[1] || klass;
        const val = (owner === klass ? statics : staticsOf(owner)).get(m[2]);
        if (val === undefined) return null;   // a table this machine cannot resolve — report, not guess
        stack.push(val); i++; continue;
      }
      if (ins === 'aaload' || ins === 'iaload' || ins === 'faload') { const idx = stack.pop(), arr = stack.pop(); stack.push(arr[idx]); i++; continue; }
      if (ins === 'fastore' || ins === 'iastore2') { const v = stack.pop(), idx = stack.pop(), arr = stack.pop(); arr[idx] = v; i++; continue; }
      if ((m = ins.match(/^newarray\s+(?:float|int)$/))) { const n = stack.pop(); stack.push(new Array(n).fill(0)); i++; continue; }
      if ((m = ins.match(/^new\s+#\d+\s+\/\/ class/))) { stack.push({ __new: true }); i++; continue; }
      if ((m = ins.match(/^invokespecial\s+#\d+\s+\/\/ Method [\w.$]+\."<init>":\(([^)]*)\)V/))) {
        for (let k = 0; k < m[1].length; k++) stack.pop();   // one pop per primitive arg (F/I only here)
        stack.pop();   // the receiver `new` marker
        i++; continue;
      }
      if (new RegExp('invoke(?:static|virtual)\\s+#\\d+\\s+// Method (?:[\\w.$]+\\.)?\\w+:\\(\\)L' + esc(CUBE) + ';').test(ins)) {
        stack.push({ tex: [0, 0], box: null }); i++; continue;
      }
      if (new RegExp('invokevirtual\\s+#\\d+\\s+// Method ' + esc(CUBE) + '\\.\\w+:\\(II\\)L' + esc(CUBE) + ';').test(ins)) {
        const v = stack.pop(), u = stack.pop(), recv = stack.pop(); recv.tex = [u, v]; stack.push(recv); i++; continue;
      }
      if (new RegExp('invokevirtual\\s+#\\d+\\s+// Method ' + esc(CUBE) + '\\.\\w+:\\(FFFFFF\\)L' + esc(CUBE) + ';').test(ins)) {
        const d = stack.pop(), h = stack.pop(), w = stack.pop(), z = stack.pop(), y = stack.pop(), x = stack.pop(), recv = stack.pop();
        recv.box = [x, y, z, w, h, d]; stack.push(recv); i++; continue;
      }
      if (new RegExp('invoke(?:static|virtual)\\s+#\\d+\\s+// Method ' + esc(POSE) + '\\.(\\w+):\\(FFF\\)L' + esc(POSE) + ';').test(ins)) {
        const mm = ins.match(new RegExp('Method ' + esc(POSE) + '\\.(\\w+):'));
        const z = stack.pop(), y = stack.pop(), x = stack.pop();
        stack.push(mm[1] === POSE_ROT ? { off: [0, 0, 0], rot: [x, y, z] } : { off: [x, y, z], rot: [0, 0, 0] });
        i++; continue;
      }
      if (new RegExp('invoke(?:static|virtual)\\s+#\\d+\\s+// Method (?:[\\w.$]+\\.)?\\w+:\\(I\\)Ljava/lang/String;').test(ins)) {
        const n = stack.pop(); stack.push('seg' + n); i++; continue;
      }
      if (new RegExp('invokevirtual\\s+#\\d+\\s+// Method ' + esc(PART) + '\\.\\w+:\\(Ljava/lang/String;L' + esc(CUBE) + ';L' + esc(POSE) + ';\\)').test(ins)) {
        const pose = stack.pop(), cube = stack.pop(), name = stack.pop(), recv = stack.pop();
        if (cube && cube.box) rows.push({ name: String(name), tex: cube.tex, box: cube.box, pose: pose.off, rot: pose.rot, mirror: false });
        stack.push(recv); i++; continue;
      }
      if (new RegExp('invoke(?:static|virtual)\\s+#\\d+\\s+// Method \\w+\\.\\w+:\\(\\)L' + esc(PART) + ';').test(ins)) {
        const recv = stack.pop(); stack.push(recv); i++; continue;
      }
      if (new RegExp('invokestatic\\s+#\\d+\\s+// Method ' + esc(LAYER) + '\\.\\w+:\\(L' + esc(MESH) + ';II\\)').test(ins)) {
        th = stack.pop(); tw = stack.pop(); stack.pop(); stack.push({ __layer: true }); i++; continue;
      }
      if (ins === 'areturn' || ins === 'return') break;
      // an opcode this tiny machine does not model — stop and report, never guess past it
      return null;
    }
    return rows.length ? { parts: rows, tw, th } : null;
  }


  // ── 5. the shape the answer must have ─────────────────────────────────────────────────────
  const rows = [];
  const emptyNames = [];
  const shortRows = [];   // D-415: a part whose box/pose/rot list came up short
  const byLayerNames = () => new Set(rows.map((r) => r[0]));
  let named = 0, empty = 0, odd = 0;
  for (const p of pairs) {
    const info = layerName.get(p.field);
    let b = built.get(p.klass + '.' + p.method);
    // D-6xx: a pair bound directly to a method with its own boolean-gated parts (none in the
    // 155-layer roster today, but the shape is free) needs the same filter the delegate hop
    // below applies — `p.args` is this call site's own literal arguments, by slot.
    if (b && b.parts.some((pt) => pt.cond)) b = { ...b, parts: b.parts.filter((pt) => condMatches(pt, p.args || [])) };
    // ⚠ D-415: a layer bound STRAIGHT to a shared mesh factory (section 2b's local-hoisting
    // walk) resolves that factory's parameters from the arguments captured at ITS call site,
    // because there is no delegate hop below to do it. `built` is shared between every layer
    // that names the same factory — player, zombie, husk, drowned, skeleton, giant all point at
    // `HumanoidModel.createMesh` — so this builds a NEW parts array and never mutates it.
    if (b && p.args && b.parts && b.parts.length) {
      b = { ...b, tw: b.tw || p.tw || 0, th: b.th || p.th || 0,
            parts: b.parts.map((pt) => ({ ...pt,
              box: pt.box.map((n) => resolveParam(n, p.args)),
              pose: pt.pose.map((n) => resolveParam(n, p.args)),
              rot: pt.rot.map((n) => resolveParam(n, p.args)) })) };
    } else if (b && (p.tw || p.th) && !b.tw && !b.th) {
      b = { ...b, tw: p.tw || 0, th: p.th || 0 };
    }
    // ⚠ FOLLOW THE DELEGATION, KEEPING THE CALLER'S SHEET SIZE. `SkullModel.createMobHeadLayer()`
    // is `LayerDefinition.create(createHeadModel(), 64, 32)`: the boxes are in the callee and the
    // 64x32 is in the caller, so neither half alone is a model.
    // ⚠⚠ **A DELEGATING METHOD CAN ALSO ADD ITS OWN PARTS ON TOP, AND TREATING "has a delegate"
    // AS "has no parts of its own" silently DROPS the delegated base.** `player_head`/`zombie_head`
    // (`elc.b`) call `elc.a()` for the plain "head" cube, THEN add their own inflated "hat" cube
    // on top of the SAME mesh — the method has both a delegate and one part of its own. Requiring
    // `!b.parts.length` before following the delegate used the base ALONE whenever the caller had
    // no parts, and the caller's OWN parts alone whenever it had any — so a head with a hat added
    // read as one bare 8x8x8 cube at texOffs(32, 0), the hat's own offset, not the head's — a
    // wrong answer that happened to look like one (a real box, of the right size, at the wrong
    // texture, silently produced by an old bug in the box reader that used to lose the hat's box
    // entirely and made this path never trigger). The base's parts always come first — that is
    // the order the bytecode itself builds them in — with the caller's own parts appended after.
    for (let hop = 0; b && b.delegate && hop < 3; hop++) {
      const d = built.get(b.delegate);
      if (!d) break;
      // ⚠ A PARAMETERISED SHARED MESH (the `iload_N` sentinel above) is resolved HERE, with the
      // ARGS this specific caller passed — the same `ekr.a` produces a different leg height for
      // whichever mob called it, and the sentinel would otherwise leak into the TSV as `[object
      // Object]`, a wrong answer far too conspicuous to mistake for a right one, which is the
      // point: this is the one place that can still catch it if a future caller's shape changes.
      const args = b.delegateArgs || [];
      // D-6xx: drop the delegate's own boolean-gated parts the CALLER's actual argument does
      // not select (piglin passes thinArms=false — PlayerEntityModel's slim `left_arm`/
      // `right_arm`/`left_sleeve`/`right_sleeve` never ran for it) BEFORE the ownNames merge
      // below, so a name a caller never really got from this delegate does not block that
      // name's REAL source (often the delegate's OWN further delegate, one hop deeper) from
      // showing through — see PlayerEntityModel.getTexturedModelData's `right_arm`, which the
      // thinArms=false branch never touches at all and which must fall through to
      // BipedEntityModel's own.
      const resolved = d.parts.filter((pt) => condMatches(pt, args))
        .map((pt) => ({ ...pt, box: pt.box.map((n) => resolveParam(n, args)),
                         pose: pt.pose.map((n) => resolveParam(n, args)) }));
      // ⚠ `addOrReplaceChild` REPLACES: a caller that adds a part under a name the base mesh
      // already used (`pig`'s own "head", on top of the shared quadruped's placeholder "head")
      // OVERRIDES it, it does not draw both — two heads, one of them a name collision, is not a
      // richer model, it is a bug that happens to render something.
      const ownNames = new Set(b.parts.map((pt) => pt.name));
      b = { parts: [...resolved.filter((pt) => !ownNames.has(pt.name)), ...b.parts],
            tw: b.tw || d.tw, th: b.th || d.th, odd: b.odd + d.odd, ret: d.ret,
            delegate: d.delegate, delegateArgs: d.delegateArgs };
    }
    // ⚠ THE SECOND CHANCE. A method the linear walk could not read at all (a real branch) still
    // has `b === undefined`; one it read but which produced no boxes (every operand wiped by a
    // call it did not recognise) has `b.parts.length === 0`; one where the linear walk followed a
    // LOOP for exactly one iteration's worth of instructions (it has no notion of `goto`, so it
    // just keeps reading straight past the branch) still has real-looking parts, but with a raw
    // loop-counter sentinel baked into them — unresolved, because a loop counter has no single
    // caller argument to substitute. All three call for the same second chance before giving up.
    const hasUnresolved = (bb) => bb && bb.parts.some((pt) => [...pt.box, ...pt.pose, ...pt.rot]
      .some((n) => typeof n === 'function'));
    if (!b || !b.parts.length || hasUnresolved(b)) {
      const looped = runLoopMethod(p.klass, p.method);
      if (looped) b = { parts: looped.parts, tw: looped.tw, th: looped.th, odd: 0, delegate: null };
    }
    if (!info) { failures++; say('   x a layer built for an unnamed ModelLayers field: ' + p.field); continue; }
    named++;
    if (!b || !b.parts.length) { empty++; emptyNames.push(info.name); continue; }
    odd += b.odd;
    for (const part of b.parts) {
      // ⚠ A sentinel that reaches here unresolved (a delegate chain more than one hop deep, or a
      // caller this walk never linked an argument for) must be REPORTED, not written into the
      // TSV as the string "[object Function]" — a wrong number silently parsed as NaN downstream
      // is a far worse outcome than a loud failure here.
      // ⚠ A SHORT LIST IS A MISSING NUMBER TOO (D-415), and the `undefined` sweep below could
      // not see one: `nums.slice(-3)` over a two-element accumulator returns a two-element
      // POSE, not a three-element one with a hole in it, so `pz` simply never existed and the
      // TSV printed an empty cell that the packer read as 0. Every humanoid in the game shipped
      // that way. Check the LENGTHS first, before the values.
      if (part.box.length !== 6 || part.pose.length !== 3 || part.rot.length !== 3) {
        odd++;
        shortRows.push(info.name + '/' + part.name + ' box' + part.box.length +
                       ' pose' + part.pose.length + ' rot' + part.rot.length);
        continue;
      }
      const allNums = [...part.box, ...part.pose, ...part.rot];
      // ⚠ A box with a MISSING number (not a function sentinel, an actual `undefined` — the
      // shape this walker's flat "last N values" accumulation produces when fewer than the
      // needed count of numbers turned up before the call it was building towards) is worse
      // than an empty layer: it looks like a row, is missing a column, and would print as an
      // empty TSV cell that a numeric-column reader downstream may silently read as 0 or NaN.
      if (allNums.some((n) => n === undefined || (typeof n === 'number' && Number.isNaN(n)))) {
        odd++;
        continue;
      }
      if (allNums.some((n) => typeof n === 'function')) {
        // ⚠ Not fatal: a value this walk cannot resolve (a `java.util.Random`-seeded loop, e.g.
        // the ghast's tentacles — a harder case than a caller's own literal argument) is exactly
        // the "built by a shape this walk cannot read" category the empty/odd counters already
        // exist for. Dropping the one box quietly is the same honesty as never having read it;
        // failing the whole run over it would regress a layer that was already this incomplete.
        odd++;
        continue;
      }
      rows.push([info.name, part.name, part.tex[0], part.tex[1],
                 part.box[0], part.box[1], part.box[2], part.box[3], part.box[4], part.box[5],
                 part.pose[0], part.pose[1], part.pose[2],
                 part.rot[0], part.rot[1], part.rot[2], part.mirror ? 1 : 0, b.tw, b.th,
                 part.g && part.g.some((n) => typeof n !== 'number') ? 0 : (part.g ? part.g[0] : 0),
                 // #2548: extra y-only grow (horse baby legs: Dilation.add(0, 5.5, 0)); the uv layout uses the un-grown h
                 part.g && part.g.length === 3 && part.g.every((n) => typeof n === 'number') ? part.g[1] - part.g[0] : 0]);
    }
  }
  if (process.argv.includes('--verbose')) {
    say(' built: ' + [...byLayerNames()].join(' '));
    say(' EMPTY: ' + emptyNames.join(' '));
    say(' unbuilt: ' + [...layerName.values()].map((v) => v.name)
        .filter((n) => !pairs.some((p2) => (layerName.get(p2.field) || {}).name === n)).join(' '));
  }
  // ⚠ D-415: a SHORT row is louder than a partial one and gets its own line. It means the walk
  // read a call it understood and still came away with fewer numbers than the call takes, which
  // is always a rule missing from the walk — never a quirk of the model.
  if (shortRows.length) say(' ! short rows (dropped): ' + shortRows.join(' '));
  say(' layers with boxes .. ' + (named - empty) + ' of ' + named
      + '  (' + rows.length + ' boxes; ' + empty + ' built by a shape this walk cannot read, '
      + odd + ' partial)');

  if (!rows.some((r) => r[0] === 'ghast' && r[1] === 'tentacle0')) rows.push(...ghastTentacleRows());
  // DragonFireballEntityRenderer draws one quad x -0.5..0.5, y -0.25..0.75 (scale 2): no ModelLayers entry, so a flat
  // 16x16px box in the mirror frame (y flipped: -12..4) over the whole 16x16 dragon_fireball.png.
  if (!rows.some((r) => r[0] === 'dragon_fireball')) rows.push(['dragon_fireball', 'quad', 0, 0, -8, -12, 0, 16, 16, 0, 0, 0, 0, 0, 0, 0, 0, 16, 16]);
  for (const l of ['guardian', 'elder_guardian']) {
    if (!rows.some((r) => r[0] === l && r[1] === 'spike0')) rows.push(...guardianSpikeRows(l));
  }
  if (!rows.some((r) => r[0] === 'blaze' && r[1] === 'part0')) rows.push(...blazeRodRows());
  if (!rows.some((r) => r[0] === 'wither' && r[1] === 'tail')) rows.push(...witherTailRows());
  // WitherArmorFeatureRenderer: EntityModelLayers.WITHER_ARMOR = WitherEntityModel.getTexturedModelData(new Dilation(0.5F)) -- the same boxes grown by 0.5 (rows carry the GROWN box + g, like the hats).
  if (!rows.some((r) => r[0] === 'wither_armor')) rows.push(...rows.filter((r) => r[0] === 'wither').map((r) => ['wither_armor', r[1], r[2], r[3], ...[4, 5, 6].map((i) => r[i] - 0.5), ...[7, 8, 9].map((i) => r[i] + 1), ...r.slice(10, 19), 0.5]));
  // #3928: LlamaDecorFeatureRenderer: EntityModelLayers.LLAMA_DECOR = LlamaEntityModel.getTexturedModelData(new Dilation(0.5F)) -- the llama's boxes (head's neck + ears too) grown by 0.5, same GROWN-box + g rows as wither_armor.
  if (rows.some((r) => r[0] === 'llama') && !rows.some((r) => r[0] === 'decor#null' && r[19] === 0.5)) {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i][0] === 'decor#null') rows.splice(i, 1);
    rows.push(...rows.filter((r) => r[0] === 'llama').map((r) => ['decor#null', r[1], r[2], r[3], ...[4, 5, 6].map((i) => r[i] - 0.5), ...[7, 8, 9].map((i) => r[i] + 1), ...r.slice(10, 19), 0.5]));
  }
  // #4593: PigSaddleFeatureRenderer: EntityModelLayers.PIG_SADDLE = PigEntityModel.getTexturedModelData(new Dilation(0.5F)) -- the pig's boxes grown by 0.5, same GROWN-box + g rows as decor#null.
  if (rows.some((r) => r[0] === 'pig') && !rows.some((r) => r[0] === 'saddle#null' && r[19] === 0.5)) {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i][0] === 'saddle#null') rows.splice(i, 1);
    rows.push(...rows.filter((r) => r[0] === 'pig').map((r) => ['saddle#null', r[1], r[2], r[3], ...[4, 5, 6].map((i) => r[i] - 0.5), ...[7, 8, 9].map((i) => r[i] + 1), ...r.slice(10, 19), 0.5]));
  }
  // CreeperChargeFeatureRenderer: EntityModelLayers.CREEPER_ARMOR = CreeperEntityModel.getTexturedModelData(new Dilation(2.0F)).
  if (!rows.some((r) => r[0] === 'creeper_armor')) rows.push(...rows.filter((r) => r[0] === 'creeper').map((r) => ['creeper_armor', r[1], r[2], r[3], ...[4, 5, 6].map((i) => r[i] - 2), ...[7, 8, 9].map((i) => r[i] + 4), ...r.slice(10, 19), 2]));
  // ElytraEntityModel: the mirrored right_wing Dilation(1.0) box came out un-grown; it is the left wing's box mirrored across x (rows carry the GROWN box + g).
  for (const r of rows) if (r[0] === 'elytra' && r[1] === 'right_wing' && r[7] === 10) { r[4] = -1; r[5] = -1; r[6] = -1; r[7] = 12; r[8] = 22; r[9] = 4; r[18] = 1; }
  if (!rows.some((r) => r[0] === 'magma_cube' && r[1] === 'cube0')) rows.push(...magmaCubeSliceRows());
  for (const l of ['squid', 'glow_squid']) {
    if (!rows.some((r) => r[0] === l && r[1] === 'tentacle0')) rows.push(...squidTentacleRows(l));
  }
  // ⚠ ANTI-VACUITY. A walk that lost its place still produces rows; these are the boxes whose
  // answer cannot be in doubt, checked against the thing anybody can look at in the game.
  const byLayer = new Map();
  for (const r of rows) {
    if (!byLayer.has(r[0])) byLayer.set(r[0], []);
    byLayer.get(r[0]).push(r);
  }
  const partOf = (layer, name) => (byLayer.get(layer) || []).filter((r) => r[1] === name)[0];
  // the chest: a 14x10x14 bottom at texOffs(0,19) and a 14x5x14 lid at (0,0), on a 64x64 sheet
  {
    const bottom = partOf('chest', 'bottom'), lid = partOf('chest', 'lid'), lock = partOf('chest', 'lock');
    ok(!!bottom && bottom[7] === 14 && bottom[8] === 10 && bottom[9] === 14,
       'the chest bottom is not 14x10x14: ' + JSON.stringify(bottom));
    ok(!!bottom && bottom[2] === 0 && bottom[3] === 19, 'the chest bottom is not at texOffs(0, 19)');
    ok(!!lid && lid[7] === 14 && lid[8] === 5 && lid[9] === 14, 'the chest lid is not 14x5x14');
    ok(!!lid && lid[11] === 9, 'the chest lid does not sit 9 up');
    ok(!!lock && lock[7] === 2 && lock[8] === 4 && lock[9] === 1, 'the chest lock is not 2x4x1');
    ok(!!bottom && bottom[17] === 64 && bottom[18] === 64, 'the chest sheet is not 64x64');
  }
  // a head is an 8x8x8 box, and the player's is at texOffs(0,0)
  {
    // ⚠⚠ **THE SIX HEADS USED TO BE UNREADABLE AND THE REASON WRITTEN HERE WAS WRONG.** This
    // said they were "registered in a loop over `SkullBlock.Types`", and the assertion below was
    // its mirror: it demanded they stay EMPTY and was designed to fail the day somebody read
    // them. It has fired. There is no loop — `createRoots` holds one skull LayerDefinition in a
    // LOCAL and puts it under five names, and the boxes were in a `createMesh()` the walk skipped
    // because of its return type (D-324). The assertion now pins what they ARE.
    const heads = ['player_head', 'skeleton_skull', 'zombie_head', 'creeper_head',
                   'wither_skeleton_skull'];
    for (const h of heads) {
      const boxes = byLayer.get(h) || [];
      ok(boxes.length > 0, 'the "' + h + '" layer has no boxes');
      if (!boxes.length) continue;
      // every skull is one 8x8x8 cube; the player's and the zombie's carry a hat layer too
      const main = boxes.find((r) => r[7] === 8 && r[8] === 8 && r[9] === 8);
      ok(!!main, 'the "' + h + '" layer has no 8x8x8 cube: '
         + JSON.stringify(boxes.map((r) => r.slice(7, 10))));
      ok(!!main && main[2] === 0 && main[3] === 0,
         'the "' + h + '" cube is not at texOffs(0, 0)');
      ok(!!main && main[4] === -4 && main[5] === -8 && main[6] === -4,
         'the "' + h + '" cube does not start at (-4, -8, -4)');
    }
    // ⚠ AND THE TWO SHAPES ARE DIFFERENT SHEETS. A mob skull is 64x32 and a player head 64x64,
    // which is the whole reason vanilla has two factories rather than one.
    const ph = (byLayer.get('player_head') || [])[0];
    const sk = (byLayer.get('skeleton_skull') || [])[0];
    ok(!!ph && ph[18] === 64, 'the player head sheet is not 64 wide');
    ok(!!sk && sk[17] === 64 && sk[18] === 32, 'the mob skull sheet is not 64x32');
    ok((byLayer.get('wither_skull') || []).length > 0,
       'wither_skull has its own ModelLayers field and must be read');
  }
  // the bed: two layers, and the head has legs
  ok((byLayer.get('bed_head') || []).length >= 3, 'the bed head is fewer than three boxes (main + two legs)');
  ok((byLayer.get('bed_foot') || []).length >= 3, 'the bed foot is fewer than three boxes');
  // ⚠ THE FOUR LAYERS THE SIXTY BLANK ICONS ACTUALLY NEED, by box count and by sheet, because
  // "it produced some rows" is not the same as "it produced the model".
  {
    const shul = byLayer.get('shulker') || [];
    ok(shul.length >= 2, 'the shulker box is fewer than two boxes (base and lid)');
    ok(shul.every((r) => r[17] === 64 && r[18] === 64), 'the shulker sheet is not 64x64');
    const ban = byLayer.get('banner') || [];
    ok(ban.length >= 3, 'the banner is fewer than three boxes (flag, pole, crossbar)');
    ok(ban.every((r) => r[17] === 64 && r[18] === 64), 'the banner sheet is not 64x64');
    const dbl = byLayer.get('double_chest_left') || [];
    ok(dbl.length >= 3, 'the left half of a double chest is fewer than three boxes');
    const bh = byLayer.get('bed_head') || [];
    // ⚠ 16 x 16 x 6 — the bed's `main` box is a flat slab lying down, and the first draft of
    // this anchor asked for 16 deep because that is what a bed LOOKS like. The jar says 6.
    ok(bh.some((r) => r[7] === 16 && r[8] === 16 && r[9] === 6),
       'the bed head has no 16x16x6 main box: ' + JSON.stringify(bh.map((r) => r.slice(7, 10))));
    ok(bh.some((r) => r[13] !== 0 || r[14] !== 0 || r[15] !== 0),
       'no part of the bed head is ROTATED — its legs are, and dropping the six-float pose is how that is lost');
  }
  // the shulker box, the banner and the shield all exist
  // ⚠ `conduit` IS NOT ON THIS LIST and the first draft of it was: the conduit's renderer builds
  // its parts directly rather than registering a layer, so `ModelLayers` has no entry for it and
  // asserting one asserted a belief rather than the jar.
  for (const n of ['shulker', 'banner', 'shield']) {
    ok((byLayer.get(n) || []).length > 0, 'no boxes read for the "' + n + '" layer');
  }
  // ⚠ G18a's OWN EIGHT (git 2a8efe1:docs/passes/PASS-15-HISTORY.md JOB 4.1): creeper, pig, silverfish, endermite, wither,
  // ender_dragon, tropical_fish and sheep_fur were the ones "built by a shape this walk does not
  // read" before this pass — a getstatic-argument bug losing the pairing entirely (creeper, pig,
  // wither, tropical_fish), a CubeDeformation-inflated box wiping its own operands (sheep_fur,
  // and a second bug besides), a genuine `for`-loop over a static table (silverfish, endermite),
  // a 9-argument named-box call form used nowhere else (ender_dragon), and a shared-local CUBE
  // reused across several `addOrReplaceChild` calls the walk had no memory for (creeper's and
  // pig's own legs). Anchor on exactly what git 2a8efe1:docs/passes/PASS-15-HISTORY.md named as unable to be in doubt.
  {
    const creeperBoxes = byLayer.get('creeper') || [];
    ok(creeperBoxes.length === 6, 'creeper is not 6 boxes: ' + creeperBoxes.length);
    ok(creeperBoxes.every((r) => r[17] === 64 && r[18] === 32), 'creeper is not on a 64x32 sheet');
    const pigNames = new Set((byLayer.get('pig') || []).map((r) => r[1]));
    ok(pigNames.size === 6, 'pig is not 6 named parts: ' + [...pigNames].join(','));
    ok((byLayer.get('pig') || []).every((r) => r[17] === 64 && r[18] === 32), 'pig is not on a 64x32 sheet');
    for (const n of ['silverfish', 'endermite', 'wither', 'ender_dragon',
                      'tropical_fish_large', 'tropical_fish_small']) {
      ok((byLayer.get(n) || []).length > 0, 'no boxes read for the "' + n + '" layer (G18a)');
    }
    for (const n of ['player', 'player_slim']) ok((byLayer.get(n) || []).length >= 12, 'no boxes read for the "' + n + '" layer (#211)');
    const fur = (byLayer.get('fur#null') || byLayer.get('sheep_fur') || []);
    ok(fur.length > 0, 'no boxes read for the sheep_fur layer (G18a)');
  }
  // #211: `player` and `player_slim` came out of the pin -- 2d re-points their inline
  // `LayerDefinition.create(...)` pair at PlayerEntityModel.getTexturedModelData(NONE, thinArms).
  // ⚠ THE THREE STILL LEFT, PINNED — a positive control, D-324's own lesson applied to itself.
  // `collar#null`, `horse_armor` and `outer#null` are still empty after this pass (a
  // two-string-factory name this walk cannot resolve). Leaving that as a comment with no assertion is exactly how the
  // dragon/creeper/pig/silverfish/endermite gap survived as long as it did — a claim nobody
  // re-checked. The day one of these gains boxes, THIS fails, on purpose, and says which one.
  for (const n of ['collar#null', 'horse_armor']) {
    ok((byLayer.get(n) || []).length > 0, 'the "' + n + '" layer lost its boxes (#5956: it has them now)');
  }
  // ⚠ ...and the OTHER direction: the numbers must not be uniform. A walk that read the same
  // operands every time would produce a table of identical boxes and pass every test above.
  {
    const sizes = new Set(rows.map((r) => r[7] + 'x' + r[8] + 'x' + r[9]));
    ok(sizes.size > 60, 'only ' + sizes.size + ' distinct box sizes in ' + rows.length + ' boxes');
    const offs = new Set(rows.map((r) => r[2] + ',' + r[3]));
    ok(offs.size > 60, 'only ' + offs.size + ' distinct texture offsets');
    const sheets = new Set(rows.map((r) => r[17] + 'x' + r[18]));
    ok(sheets.size >= 3, 'only ' + sheets.size + ' distinct sheet sizes — vanilla has 64x64, 64x32 and more');
    say(' variety ............ ' + sizes.size + ' box sizes · ' + offs.size + ' tex offsets · '
        + [...sheets].sort().join(' ') + ' sheets');
  }
  // ⚠ THE OLD WORDING HERE CLAIMED A LOOP AND THERE IS NONE (D-324). What is left unpaired is
  // whatever `createRoots` builds through a shape neither the direct walk nor the shared-local
  // walk models; naming it as "unpaired" rather than inventing a mechanism is the point.
  say(' unpaired ........... ' + (layerName.size - named) + ' of ' + layerName.size
      + ' named layers have no builder this walk can reach');
  ok(named >= 70 && named <= layerName.size,
     named + ' of ' + layerName.size + ' named layers are built');

  if (failures) { say('\n x ' + failures + ' failures - NOT written'); process.exit(1); }

  mkdirSync(dirname(OUT), { recursive: true });
  const lines = ['# layer\tpart\ttu\ttv\tx\ty\tz\tw\th\td\tpx\tpy\tpz\trx\try\trz\tmirror\tsheetW\tsheetH\tgrow\tgrowy',
    '# Generated by tools/extract-models.mjs from ' + JAR,
    '# CubeListBuilder=' + CUBE + ' PartDefinition=' + PART + ' PartPose=' + POSE
      + ' LayerDefinition=' + LAYER + ' ModelLayers=' + LAYERS + ' LayerDefinitions=' + ROOTS,
    '# ' + (named - empty) + ' layers, ' + rows.length + ' boxes. '
      + empty + ' layers are built by a shape this walk does not read (loops and helpers).'];
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : 1)));
  for (const r of rows) lines.push(r.join('\t'));
  writeFileSync(OUT, lines.join('\n') + '\n');
  say('\n wrote ' + OUT);
} finally {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* the mount refuses rm */ }
}
