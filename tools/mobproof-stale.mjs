// Staleness hashes for the proof matrix (#8227): sha1 of the mob-keyed src text each dimension covers (tools/mobproof-covers.json).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function files(root, pat) {
  if (!pat.includes('*')) return existsSync(join(root, pat)) ? [pat] : [];
  const dir = dirname(pat), re = new RegExp('^' + rx(pat.slice(dir.length + 1)).replace(/\\\*/g, '.*') + '$');
  return existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => re.test(f)).sort().map((f) => dir + '/' + f) : [];
}
export function coverText(mob, dim, o = {}) {
  const root = o.root || ROOT, covers = o.covers || JSON.parse(readFileSync(join(ROOT, 'tools/mobproof-covers.json'), 'utf8'));
  const word = new RegExp('(^|[^A-Za-z0-9])' + rx(mob) + '([^A-Za-z0-9]|$)', 'i'), out = [];
  for (const c of covers[dim] || []) for (const f of files(root, c.file.replace(/\{mob\}/g, mob))) {
    const lines = readFileSync(join(root, f), 'utf8').split('\n');
    if (c.kind === 'whole') out.push(f, ...lines);
    else if (c.kind === 'lines') out.push(f, ...lines.filter((l) => word.test(l)));
    else if (c.kind === 'block') {
      const s = new RegExp(c.start.replace(/\{mob\}/g, rx(mob))), e = new RegExp(c.end); let on = false;
      for (const l of lines) { if (!on) { if (s.test(l)) { on = true; out.push(f, l); } } else if (e.test(l)) break; else out.push(l); }
    }
  }
  return out.join('\n');
}
export const coverHash = (mob, dim, o) => createHash('sha1').update(coverText(mob, dim, o)).digest('hex');
