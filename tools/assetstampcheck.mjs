#!/usr/bin/env node
// assetstampcheck.mjs — #11400: build.mjs must refuse an assets/ that older generator tools made (Dan's stale gui.bin paired with new menu code).
// Builds a fixture root: tools/ with two generators + assets/, stamped; then proves fresh passes and each break is refused.
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staleGenerators, writeStamp, STAMP } from './infra/assetstamp.mjs';

const root = mkdtempSync(join(tmpdir(), 'stamp-'));
mkdirSync(join(root, 'tools')); mkdirSync(join(root, 'assets'));
writeFileSync(join(root, 'tools', 'build-gui.mjs'), '// gui v1\n');
writeFileSync(join(root, 'tools', 'pack-lang.mjs'), '// lang v1\n');
writeFileSync(join(root, 'tools', 'gen-panorama.mjs'), '// not an assets generator\n');
writeFileSync(join(root, 'tools', 'somecheck.mjs'), '// not a generator\n');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
writeStamp(root);
ok(staleGenerators(root).length === 0, 'a freshly stamped assets/ was reported stale');
appendFileSync(join(root, 'tools', 'gen-panorama.mjs'), '// edit\n'); appendFileSync(join(root, 'tools', 'somecheck.mjs'), '// edit\n');
ok(staleGenerators(root).length === 0, 'editing a non-generator tool made assets/ stale');
const breaks = [
  ['generator edited after assets/', () => appendFileSync(join(root, 'tools', 'build-gui.mjs'), '// gui v2\n'), /build-gui\.mjs changed/],
  ['generator added', () => writeFileSync(join(root, 'tools', 'extract-new.mjs'), '//\n'), /extract-new\.mjs is new/],
  ['generator removed', () => rmSync(join(root, 'tools', 'pack-lang.mjs')), /pack-lang\.mjs was removed/],
  ['stamp missing', () => rmSync(STAMP(root)), /stamp\.json is missing/],
  ['stamp corrupt', () => writeFileSync(STAMP(root), '{nope'), /unreadable/],
];
let caught = 0;
for (const [name, brk, re] of breaks) {
  writeFileSync(join(root, 'tools', 'build-gui.mjs'), '// gui v1\n'); writeFileSync(join(root, 'tools', 'pack-lang.mjs'), '// lang v1\n'); rmSync(join(root, 'tools', 'extract-new.mjs'), { force: true });
  writeStamp(root); brk();
  const r = staleGenerators(root);
  if (r.some((m) => re.test(m))) { caught++; console.log('   ✓ break caught: ' + name); } else fails.push(`break "${name}" not refused: ${JSON.stringify(r)}`);
}
ok(caught === breaks.length, `${caught} of ${breaks.length} breaks caught`);
// the wiring: gen-data writes the stamp, build.mjs refuses on it, and the override is explicit
const gd = readFileSync(new URL('./gen-data.mjs', import.meta.url), 'utf8'), bm = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
ok(/writeStamp\(MCLITE_ROOT\)/.test(gd), 'gen-data.mjs does not write the generator stamp');
ok(/staleGenerators\(ROOT\)/.test(bm) && /process\.exit\(1\)/.test(bm.slice(bm.indexOf('infra/assetstamp.mjs'), bm.indexOf('infra/assetstamp.mjs') + 900)), 'build.mjs does not refuse a stale assets/');
rmSync(root, { recursive: true, force: true });
if (fails.length) { console.log('FAIL:'); for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
console.log(`assetstampcheck: ${pass + caught} assertions, 0 failed, ${caught} breaks caught`);
