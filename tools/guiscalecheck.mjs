// tools/guiscalecheck.mjs - #8337: GUI Scale option. Window.calculateScaleFactor ported in Settings; sizes and slider max. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const SRC = readFileSync(new URL('../src/16_settings.js', import.meta.url), 'utf8');
const load = (src) => { const NS = {}; try { vm.runInNewContext(src, { MCL: NS, window: {}, navigator: {}, localStorage: {}, performance: { now: () => 0 }, console }); } catch (e) { if (process.env.DBG) console.log(e.message); } return NS.Settings; };
// vanilla reference (Window.calculateScaleFactor, forceUnicode false)
const ref = (g, w, h) => { let i = 1; while (i != g && i < 1e9 && Math.floor(w / (i + 1)) >= 320 && Math.floor(h / (i + 1)) >= 240) i++; return i; };
const verdict = (src) => {
  const bad = [], S = load(src);
  if (!S || !S.calculateScaleFactor) return ['no Settings.calculateScaleFactor'];
  for (const [w, h] of [[854, 480], [1280, 720], [1920, 1080], [3840, 2160]]) {
    const max = ref(0, w, h);
    if (S.calculateScaleFactor(0, w, h) !== max) bad.push(`auto ${w}x${h}`);
    for (let g = 0; g <= max + 1; g++) {
      const f = S.calculateScaleFactor(g, w, h), e = ref(g, w, h);
      if (f !== e) bad.push(`${w}x${h} g${g}: ${f} != ${e}`);
      if (S.scaledSize(w, f) !== Math.ceil(w / e) || S.scaledSize(h, f) !== Math.ceil(h / e)) bad.push(`scaled ${w}x${h} g${g}`);
    }
  }
  if (!('guiScale' in S)) bad.push('no guiScale option');
  return bad;
};
const HUD = readFileSync(new URL('../src/15_hud.js', import.meta.url), 'utf8'), OPT = readFileSync(new URL('../src/15f_options.js', import.meta.url), 'utf8');
const wired = () => (/calculateScaleFactor\(/.test(HUD) ? [] : ['Hud ignores the factor']).concat(/GUI Scale/.test(OPT) ? [] : ['no GUI Scale row']);
const base = [...verdict(SRC), ...wired()];
if (base.length) { console.log('FAIL', base.slice(0, 5)); process.exit(1); }
const BREAKS = [
  SRC.replace('>= 240', '>= 480').replace('>= 320', '>= 640'),
  SRC.replace("guiScale === 0 ||", "false &&"),
  SRC.replace('Math.ceil(size / scale)', 'Math.floor(size / scale)'),
];
let caught = 0;
for (const b of BREAKS) if (verdict(b).length) caught++;
if (caught !== BREAKS.length) { console.log('FAIL: only', caught, 'breaks caught'); process.exit(1); }
console.log(`guiscalecheck ok: ${caught} breaks caught`);
