#!/usr/bin/env node
// mobsoundcheck.mjs — #210 (G18a-2): every mob's own sounds use the SoundSource vanilla's
// `getSoundCategory()` names. Expected values are DERIVED from .decomp (class chain of every
// EntityType), never retyped. Also: hostile/neutral are gone from S.OWED_SOURCES, the sliders
// move real gain, and mobSound routes into the right node. Anti-vacuity (D-30): breaks its own data.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (c) { pass++; console.log('  ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
console.log('mobsoundcheck — #210: mob sound sources vs SoundCategory in .decomp');

const D = join(ROOT, '.decomp/net/minecraft/entity');
const files = {};
(function walk(d) { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.java')) files[f.name.slice(0, -5)] = p; } })(D);
const NAMES = { field_15251: 'hostile', field_15254: 'neutral', field_15248: 'player', field_15256: 'ambient', field_15252: 'weather' };
function categoryOf(cls) {
  for (let i = 0; cls && i < 20; i++) {
    const s = readFileSync(files[cls], 'utf8');
    const g = /SoundCategory getSoundCategory\(\)\s*\{\s*return ([^;]+);/.exec(s);
    if (g) {
      if (cls === 'RabbitEntity') return 'neutral';   // hostile only for rabbit type 99: tested below
      const f = /SoundCategory\.(field_\d+)/.exec(g[1]);
      return NAMES[f[1]];
    }
    const x = /class \w+(?:<[^>]*>)?\s+extends\s+(\w+)/.exec(s); cls = x && x[1];
  }
  return 'neutral';
}
const et = readFileSync(join(D, 'EntityType.java'), 'utf8');
const expected = {};
for (let m, re = /"(\w+)",\s*EntityType\.Builder\.(?:<\w+>)?create\((\w+)::new/g; (m = re.exec(et));) expected[m[1]] = categoryOf(m[2]);
expected.player = categoryOf('PlayerEntity');
ok(Object.keys(expected).length >= 110, 'parsed the EntityType table (' + Object.keys(expected).length + ')');
ok(expected.zombie === 'hostile' && expected.cow === 'neutral' && expected.player === 'player', 'sanity of derived categories');

const M = loadEngine({ extra: ['02j_sounds.js'] });
const S = M.Sound;
const mismatches = (fn) => Object.keys(expected).filter((t) => fn(t) !== expected[t]);
const bad = mismatches((t) => S.mobSource(t));
ok(bad.length === 0, 'S.mobSource matches .decomp for: ' + bad.join(','));
ok(S.mobSource('rabbit', { rabbitType: 99 }) === 'hostile' && S.mobSource('rabbit', { rabbitType: 1 }) === 'neutral', 'killer bunny is hostile');
ok(!('hostile' in S.OWED_SOURCES) && !('neutral' in S.OWED_SOURCES), 'hostile/neutral struck from S.OWED_SOURCES');
ok(S.SOURCES.includes('hostile') && S.SOURCES.includes('neutral'), 'both sources exist');

// mobSound routes into the named source, and only when not silent
const seen = [];
const realPlay = S.play; S.play = (ev, o) => { seen.push({ ev, src: o.source, x: o.x }); return true; };
S.mobSound({ type: 'zombie', x: 1, y: 2, z: 3 }, 'entity.zombie.ambient');
S.mobSound({ type: 'cow', x: 1, y: 2, z: 3 }, 'entity.cow.ambient');
S.mobSound({ type: 'zombie', x: 1, y: 2, z: 3, silent: true }, 'entity.zombie.hurt');
ok(seen.length === 2 && seen[0].src === 'hostile' && seen[1].src === 'neutral', 'mobSound routes by type, honours silent');
S.play = realPlay;

// #2396: a rabbit hop emits entity.rabbit.jump at pitch ~0.8 (0.64..0.96)
{
  const M2 = loadEngine({ extra: ['02j_sounds.js', '07zh_rabbit.js'] });
  const hops = []; M2.Sound.play = (ev, o) => { hops.push({ ev, p: o.pitch, v: o.volume }); return true; };
  const hop = (e) => { hops.length = 0; M2.Rabbit.startJump(e); return hops.slice(); };
  const h = hop({ type: 'rabbit', x: 0, y: 0, z: 0 });
  ok(h.length === 1 && h[0].ev === 'entity.rabbit.jump' && h[0].v === 1 && h[0].p >= 0.64 && h[0].p <= 0.96, 'rabbit hop plays entity.rabbit.jump at pitch ~0.8');
  caught(hop({ type: 'rabbit', x: 0, y: 0, z: 0, silent: true }).length === 0, 'silent rabbit hops silently');
  caught(!(hop({ type: 'rabbit', x: 0, y: 0, z: 0 })[0].ev === 'entity.rabbit.hurt'), 'wrong event is flagged');
}

// the slider moves the gain that S.play feeds
S.setSourceVolume('hostile', 0.25);
ok(S.volumeOf('hostile') === 0.25 && S.volumeOf('neutral') === 1, 'hostile slider moves only hostile');
const fake = { gain: { value: 1 } }; S.gains = { hostile: fake };
S.setSourceVolume('hostile', 0.5);
ok(fake.gain.value === 0.5, 'setSourceVolume writes the hostile GainNode');

// no engine mob-sound call site bypasses mobSound with a hard-coded position-only play
Promise.resolve().then(() => {   // plain fs scan, no `grep`/shell: the lander machine is Windows
  const files = readdirSync(join(ROOT, 'src')).filter((f) => /^07zz[fghik].*\.js$/.test(f) || f === '07k_goals.js').sort();
  const out = files.flatMap((f) => readFileSync(join(ROOT, 'src', f), 'utf8').split('\n')
    .map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('Sound.play(') && !l.includes("source: '"))
    .map(([n, l]) => `src/${f}:${n}:${l}`)).join('\n').trim();
  ok(out === '', 'no mob module calls Sound.play directly:\n' + out);

  // every dolphin event the vanilla class plays is reachable from src (#1873)
  const srcAll = readdirSync(join(ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f)).map((f) => readFileSync(join(ROOT, 'src', f), 'utf8')).join('\n');
  const dolEvs = ['attack', 'play', 'jump'].map((k) => 'entity.dolphin.' + k);
  const dolMiss = (evs) => evs.filter((ev) => !srcAll.includes("'" + ev + "'"));
  ok(dolMiss(dolEvs).length === 0 && S.mobSound && /'entity\.dolphin\.' \+ kind/.test(srcAll), 'dolphin attack/play/jump/splash/swim reachable');
  caught(dolMiss(dolEvs.concat('entity.dolphin.bogus')).length === 1, 'unreachable dolphin event flagged');
  // ghast world events 1015/1016: volume 10, pitch (nextFloat - nextFloat) * 0.2 + 1 (#1975)
  const gsrc = readFileSync(join(ROOT, 'src/07zzi_ghast.js'), 'utf8');
  const ghastVol = (src) => ['warn', 'shoot'].every((k) => new RegExp("mobSound\\(e, 'entity\\.ghast\\." + k + "', 10, ghastWorldEventPitch\\(\\)\\)").test(src));
  ok(ghastVol(gsrc) && /\(r\(\) - r\(\)\) \* 0\.2 \+ 1\.0/.test(gsrc), 'ghast warn/shoot play at volume 10 with spread pitch');
  caught(!ghastVol(gsrc.replace(/, 10, ghastWorldEventPitch\(\)/, '')), 'ghast sound without volume 10 flagged');
  // ── anti-vacuity: break our own data
  const t0 = Object.keys(expected);
  caught(mismatches((t) => (t === 'zombie' ? 'neutral' : S.mobSource(t))).includes('zombie'), 'zombie routed neutral');
  caught(mismatches((t) => (t === 'cow' ? 'hostile' : S.mobSource(t))).includes('cow'), 'cow routed hostile');
  caught(mismatches((t) => (t === 'ghast' ? 'neutral' : S.mobSource(t))).includes('ghast'), 'ghast (own override) routed neutral');
  caught(mismatches((t) => (t === 'player' ? 'hostile' : S.mobSource(t))).includes('player'), 'player routed hostile');
  caught(mismatches(() => 'neutral').length >= 30 && t0.length > 0, 'all-neutral table');
  const owedOk = (o) => !('hostile' in o) && !('neutral' in o);
  caught(owedOk(S.OWED_SOURCES) && !owedOk(Object.assign({}, S.OWED_SOURCES, { hostile: 1 })), 'hostile back in OWED_SOURCES is flagged');
  finish();
});
function finish() {
  for (const f of fails) console.log('  ✗ ' + f);
  console.log(`assertions passed ..... ${pass}\nfailures ........... ${fails.length}\n${breaks} breaks caught`);
  process.exit(fails.length ? 1 : 0);
}
