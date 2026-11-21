// coveragemapcheck (#7064): cow, zombie, creeper have zero UNMAPPED rows; breaking the data is caught.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { map } from './coveragemap.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'src'), TSV = path.join(ROOT, 'tools/golden/coverage-unreachable.tsv');
let fail = 0, breaks = 0;
const bad = (m) => { console.log('FAIL ' + m); fail++; };
for (const mob of ['cow', 'zombie', 'creeper']) {
  const rows = map(mob, SRC, TSV), un = rows.filter(r => r.st === 'UNMAPPED');
  if (!rows.length) bad(mob + ': empty chain');
  if (un.length) bad(mob + ': UNMAPPED ' + un.map(r => r.id).join(' '));
  if (!rows.some(r => r.st === 'MAPPED')) bad(mob + ': nothing mapped');
  if (rows.filter(r => r.st === 'UNREACHABLE').some(r => r.why.length < 10)) bad(mob + ': unreachable row without reason');
  console.log(`${mob}: ${rows.length} methods, ${rows.filter(r => r.st === 'MAPPED').length} mapped, ${rows.filter(r => r.st === 'UNREACHABLE').length} unreachable`);
}
// fault 1: strip every Creeper explode() citation from a temp copy of src -> reported UNMAPPED
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'covmap-'));
for (const f of fs.readdirSync(SRC, { recursive: true })) if (/\.js$/.test(f)) {
  const o = path.join(tmp, f); fs.mkdirSync(path.dirname(o), { recursive: true });
  fs.writeFileSync(o, fs.readFileSync(path.join(SRC, f), 'utf8').replace(/CreeperEntity\.explode\b/g, 'CreeperEntity.XX'));
}
if (map('creeper', tmp, TSV).some(r => r.id === 'CreeperEntity.explode' && r.st === 'UNMAPPED')) (breaks++, console.log('✓ explode citation removal -> UNMAPPED')); else bad('fault: explode citation removal not caught');
// fault 2: empty reachability table -> some row becomes UNMAPPED
const t2 = path.join(tmp, 'empty.tsv'); fs.writeFileSync(t2, '');
if (map('cow', SRC, t2).some(r => r.st === 'UNMAPPED')) (breaks++, console.log('✓ empty unreachable table -> UNMAPPED')); else bad('fault: empty unreachable table not caught');
fs.rmSync(tmp, { recursive: true });
console.log(`${9 - fail} checks passed, ${fail} failures, ${breaks} breaks caught`);
process.exit(fail ? 1 : 0);
