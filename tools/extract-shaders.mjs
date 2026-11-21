#!/usr/bin/env node
// extract-shaders.mjs -- #6375: the End portal core shader's constants, out of the 1.18.2 CLIENT JAR.
//
//   node tools/extract-shaders.mjs   -> tools/golden/endportal-shader-1.18.2.json
//
// rendertype_end_portal.fsh is a resource, so it is in neither .decomp nor .mcdata. The engine's colour table
// was typed by hand and two entries were wrong (COLORS[1].b, COLORS[15].b); this reads them from the jar.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const jar = requireJar('1.18.2');
const read = (n) => execFileSync('unzip', ['-p', jar, 'assets/minecraft/shaders/core/' + n], { encoding: 'utf8' });
const fsh = read('rendertype_end_portal.fsh');
const body = fsh.match(/COLORS\s*=\s*vec3\[\]\(([\s\S]*?)\);/);
if (!body) { console.error('extract-shaders: COLORS table not found'); process.exit(1); }
const colors = [...body[1].matchAll(/vec3\(([^)]*)\)/g)].map((m) => m[1].split(',').map(Number));
const layers = +(fsh.match(/EndPortalLayers/g) ? 16 : 0);
const out = {
  colors,
  // the layer matrix, verbatim lines, so a check can pin the formula the engine mirrors
  translate: fsh.match(/1\.0, 0\.0, 0\.0, ([^,\n]+),\n\s*0\.0, 1\.0, 0\.0, ([^,\n]+),/).slice(1, 3),
  rotate: fsh.match(/radians\(([^;]+)\)\);/)[1],
  scale: fsh.match(/mat2 scale = mat2\(([^;]+)\);/)[1],
  scaleTranslate: fsh.match(/SCALE_TRANSLATE = mat4\(\s*([\d.]+), 0\.0, 0\.0, ([\d.]+)/).slice(1, 3).map(Number),
  layers,
};
if (colors.length !== 16 || colors.some((c) => c.length !== 3 || c.some(Number.isNaN))) { console.error('extract-shaders: bad colour table'); process.exit(1); }
const dest = fileURLToPath(new URL('./golden/endportal-shader-1.18.2.json', import.meta.url));
writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
console.log('extract-shaders: ' + colors.length + ' colours -> ' + dest);
