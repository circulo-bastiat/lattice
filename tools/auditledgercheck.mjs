// auditledgercheck.mjs - #4588: the tester audit ledger skips clean+unchanged mobs. Scenarios run on the real
// auditledger.mjs and on broken copies of it, each of which must be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), SRC = join(HERE, 'brain', 'auditledger.mjs');
const src = readFileSync(SRC, 'utf8');
const scenarios = (L) => {
  const bad = [], root = mkdtempSync(join(tmpdir(), 'alc-'));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'tools', 'stages.d'), { recursive: true });
  const H = (m) => L.mobHash(m, root);
  const put = (t) => { writeFileSync(join(root, 'src', 'a.js'), t); L.forgetSrc(); };
  put('cow: speed 0.2\npig: speed 0.25\n');
  const led = { cow: { at: 5, hash: H('cow') }, pig: { at: 1, hash: 'stale' } };
  const mobs = ['cow', 'pig', 'owl'];
  if (L.pickMobs(mobs, led, H, 9).includes('cow')) bad.push('clean+unchanged mob was picked');
  if (L.pickMobs(mobs, led, H, 9).join() !== 'owl,pig') bad.push('never-audited first, then clean-but-changed: got ' + L.pickMobs(mobs, led, H, 9));
  if (L.pickMobs(mobs, led, H, 1).length !== 1) bad.push('k not honoured');
  if (L.pickMobs(mobs, led, H, 9, ['owl']).includes('owl')) bad.push('in-flight mob picked twice');
  const old = H('cow'); put('cow: speed 0.3\npig: speed 0.25\n');
  if (H('cow') === old) bad.push('editing a cow line did not change cow hash');
  if (!L.pickMobs(mobs, { cow: { at: 5, hash: old } }, H, 9).includes('cow')) bad.push('clean+changed mob not picked');
  put('cow: speed 0.2\npig: speed 0.99\n');
  if (H('cow') !== old) bad.push('an edit to another mob changed the cow hash');
  const all = Object.fromEntries(mobs.map((m) => [m, { at: 1, hash: H(m) }]));
  if (L.pickMobs(mobs, all, H, 3).length) bad.push('all clean+unchanged must pick nobody (no tester starts)');
  const cleared = L.record(all, 'cow', H('cow'), false, 9);
  if (cleared.cow || !L.pickMobs(mobs, cleared, H, 3).includes('cow')) bad.push('a bug did not clear the entry');
  if (L.record({}, 'cow', 'h', true, 9).cow?.hash !== 'h') bad.push('a clean audit was not recorded');
  if (L.cleanCount(mobs, all, H) !== 3) bad.push('cleanCount wrong');
  rmSync(root, { recursive: true, force: true });
  return bad;
};
const fails = scenarios(await import(pathToFileURL(SRC).href)).map((x) => 'real: ' + x);
const BREAKS = [
  ['clean mobs are re-picked', '!(ledger[m] && ledger[m].hash === hashOf(m))', 'true'],
  ['changed hash stays skipped', 'ledger[m].hash === hashOf(m)', 'ledger[m]'],
  ['newest audit first', '((ledger[a] || {}).at || 0) - ((ledger[b] || {}).at || 0)', '((ledger[b] || {}).at || 0) - ((ledger[a] || {}).at || 0)'],
  ['in-flight ignored', '!inflight.includes(m) && ', ''],
  ['a bug keeps the entry', 'if (clean) l[mob] = { at, hash }; else delete l[mob];', 'l[mob] = { at, hash };'],
  ['hash ignores the mob lines', 'if (re.test(l)) h.update', 'if (!re.test(l)) h.update'],
  ['hash covers every mob', '`(^|[^a-z0-9])${mob}([^a-z0-9]|$)`', '`.`'],
];
let caught = 0;
for (const [name, from, to] of BREAKS) {
  if (!src.includes(from)) { fails.push(`break "${name}": auditledger.mjs no longer contains ${from}`); continue; }
  const dir = mkdtempSync(join(tmpdir(), 'alc-')), f = join(dir, 'a.mjs');
  writeFileSync(f, src.split(from).join(to).replace("from './home.mjs'", `from '${pathToFileURL(join(HERE, 'brain', 'home.mjs'))}'`));
  if (scenarios(await import(pathToFileURL(f).href)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`auditledgercheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${11 - fails.filter((x) => x.startsWith("real")).length}`);
process.exit(fails.length ? 1 : 0);
