// spawnlight-decomp.mjs (#8812) - the LIGHT rule of each entity type's SpawnRestriction predicate, read out of `.decomp/` (never typed).
// Resolves `register(EntityType.<field>, ..., Class::method)`, takes that static method's body, and follows calls to other static methods
// of the same class or its parents one level at a time. Classes: dark (HostileEntity.isSpawnDark / canSpawnInDark), bright
// (AnimalEntity.isLightLevelValidForNaturalSpawn / isValidNaturalSpawn), own (the mob's own light read: bat, slime, glow squid, pillager),
// none (no light read at all).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MC = join(fileURLToPath(new URL('..', import.meta.url)), '.decomp', 'net', 'minecraft');
let files = null;
function index() {
  if (files) return files; files = {};
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.java')) files[f.name.slice(0, -5)] = p; } };
  walk(join(MC, 'entity')); return files;
}
function body(cls, meth) {
  const p = index()[cls]; if (!p) return null;
  const t = readFileSync(p, 'utf8'), i = t.search(new RegExp('static boolean ' + meth + '\\b')); if (i < 0) return null;
  let k = t.indexOf('{', i), dep = 0; const j = k;
  for (; k < t.length; k++) { if (t[k] === '{') dep++; else if (t[k] === '}' && --dep === 0) break; }
  return t.slice(j, k + 1);
}
export function classify(cls, meth) {
  const b = body(cls, meth); if (b === null) return 'none';
  if (/\b(isSpawnDark|canSpawnInDark)\b/.test(b)) return 'dark';
  if (/\b(isLightLevelValidForNaturalSpawn|isValidNaturalSpawn)\b/.test(b)) return 'bright';
  if (/getLightLevel|getBaseLightLevel/.test(b)) return 'own';
  return 'none';
}
export function parseSpawnLight({ restriction, entityType }) {
  const ids = {};
  for (const m of entityType.matchAll(/(field_\d+)\s*=\s*register\(\s*"(\w+)"/g)) ids[m[1]] = m[2];
  const out = {};
  for (const m of restriction.matchAll(/register\(EntityType\.(field_\d+),[^;]*?,\s*(\w+)::(\w+)\)/g)) out[ids[m[1]]] = classify(m[2], m[3]);
  return out;
}
