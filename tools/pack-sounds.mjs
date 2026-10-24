#!/usr/bin/env node
// pack-sounds.mjs — PLAN G13. Vanilla's sound events and their audio, re-encoded to fit.
//
//   node tools/pack-sounds.mjs [--bitrate 32] [--out assets]
//
// ── WHERE THE AUDIO IS, AND WHY THIS STAGE IS DIFFERENT ─────────────────────────────────────
// ⚠ THE `.ogg` FILES ARE NOT IN THE JAR. They live in the launcher's content-addressed store,
// `assets/objects/<xx>/<sha1>`, indexed by `assets/indexes/1.18.json`, on Dan's machine — and
// `resources.download.minecraft.net` is outside this container's egress allowlist, so they arrive
// one batch at a time over the file bridge. **That makes coverage a MEASUREMENT, not an
// assumption**, and this file reports it: how many events are fully voiced, how many are partly
// voiced, how many are silent, and which. A missing file is never faked and never falls back.
//
// ── THE DECLARED DEVIATION: BITRATE (D-284) ─────────────────────────────────────────────────
// ⚠ The full non-mob set is 22.2 MB of Vorbis, and D-12's ceiling is 15 MB for the WHOLE file,
// of which the build already uses ~4 MB — and base64 adds a third on top. So the audio is
// re-encoded to **Opus mono VBR**, which is roughly 3.7x smaller than the shipped Vorbis at 32
// kbps and decodes natively in `decodeAudioData`. ⚠ THE SET IS COMPLETE AND THE BITRATE IS THE
// DEVIATION — the other way round (fewer sounds at original quality) loses whole materials, and
// a missing footstep is far more audible than a lower bitrate on a 0.3-second footstep.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────────────────────
// Mob sounds (G18 owns them, 24 MB raw), music and records (262 MB and 26 MB — the whole budget
// several times over), and the long ambient loops. Each exclusion is a RULE in `KEEP` below, not
// a hand-written list, so it can be re-run when the budget or the stage changes.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
const BITRATE = parseInt(opt('bitrate', '32'), 10);
const META = join(MCLITE_ROOT, '.mcsnd');
// ⚠ A DEFAULT THAT NAMES ONE MACHINE IS A BUG ON THE SECOND ONE — `paths.mjs`'s own lesson,
// paid again here (D-359). This was hard-wired to the upload directory of one cloud container,
// so on any other machine — including the next container — `pack-sounds` reported every one of
// its 1,214 files "not staged yet" and `gen-data` shipped a game with no sound, loudly enough to
// be missed. The order is: an explicit flag, an environment override, the project's own cache
// (which is where a staged set naturally lands), then the two known upload layouts.
const OBJECT_CANDIDATES = [
  opt('objects', ''),
  process.env.MCLITE_OBJECTS,
  join(MCLITE_ROOT, '.mcsnd', 'objects'),
  '/mnt/user-data/uploads/assets/objects',
  join(process.env.HOME || '', 'mnt', 'assets', 'objects'),
].filter(Boolean);
const OBJECTS = OBJECT_CANDIDATES.find((d) => existsSync(d)) || OBJECT_CANDIDATES[0];
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
for (const f of ['sounds.json', 'index-1.18.json']) {
  if (!existsSync(join(META, f))) {
    console.error('pack-sounds: .mcsnd/' + f + ' is missing.');
    console.error('  Stage it from the launcher: assets/indexes/1.18.json, and the object whose');
    console.error('  hash the index gives for "minecraft/sounds.json".');
    process.exit(1);
  }
}
const SOUNDS = JSON.parse(readFileSync(join(META, 'sounds.json'), 'utf8'));
const INDEX = JSON.parse(readFileSync(join(META, 'index-1.18.json'), 'utf8')).objects;

// ── the selection, as RULES ─────────────────────────────────────────────────────────────────
// ⚠ Every line here is a budget decision with a number behind it, and `soundcheck` re-derives the
// set from these same rules so a change here cannot silently disagree with the check.
const ENTITY_KEEP = /^entity\.(player|item|experience_orb|item_frame|generic|arrow|spectral_arrow|tnt|lightning_bolt|boat|minecart|armor_stand|painting|leash_knot|egg|snowball|ender_pearl|fishing_bobber|firework_rocket|experience_bottle|splash_potion|shulker_box|bee|cat|chicken)\./;
const LOOPS = /(\.ambient|\.loop|\.inside|whirlpool|fire_crackle|\.smoke$|elytra|\.thunder|\.charge$)/;
const KEEP_LOOP = /^(ambient\.cave|block\.(water|lava)\.ambient|entity\.bee\.loop(_aggressive)?)$/;   // bee loops are #2543's
export function keepEvent(ev) {
  if (/^(music|music_disc)\./.test(ev)) return false;          // 288 MB, and G16 owns the jukebox
  if (ev.startsWith('ambient.')) return ev === 'ambient.cave';  // the one ambience a player hears
  if (ev.startsWith('entity.') && !ENTITY_KEEP.test(ev)) return false;   // other mobs are G18's: 5 MB opus busts D-742's 18 MB ceiling; bees, cats excepted (#2920)
  const mobVoice = ev.startsWith('entity.') && /\.ambient\w*$/.test(ev);   // a mob's ambient is a one-shot voice (#2920)
  if (LOOPS.test(ev) && !mobVoice && !KEEP_LOOP.test(ev)) return false;   // long loops, 4.5 MB for 23 events
  return true;
}

/** The .ogg names an event plays, following `type: "event"` references. */
function filesOf(ev, seen) {
  seen = seen || new Set();
  if (seen.has(ev)) return [];
  seen.add(ev);
  const e = SOUNDS[ev];
  if (!e || !e.sounds) return [];
  const out = [];
  for (const s of e.sounds) {
    const n = typeof s === 'string' ? s : s.name;
    if (typeof s !== 'string' && s.type === 'event') { out.push(...filesOf(n, seen)); continue; }
    out.push(n);
  }
  return out;
}

const events = Object.keys(SOUNDS).filter(keepEvent).sort();
const wanted = new Set();
for (const ev of events) for (const f of filesOf(ev)) wanted.add(f);

// ── what is actually on disk ────────────────────────────────────────────────────────────────
// ⚠ TWO SOURCES, NOT ONE (found this session, PASS 16): a raw .ogg staged under `.mcsnd/objects`
// AND an already-encoded `.mcsnd/opus<bitrate>/<hash>.opus` from a PRIOR run of this same tool.
// The encode cache is keyed by content hash (the comment below this block already says so), so
// it is valid with or without the raw source sitting next to it — a session whose raw objects
// were never staged on THIS machine must not re-derive "no source, so silent" when a perfectly
// good encode already exists from a session that DID have the source. Checking only `present`
// (the old code) silently regenerated `sounds.bin` near-empty the first time this ran somewhere
// the raw .ogg cache was not staged, even though 1,205 of 1,214 opus files were sitting right
// there — an 0.01 MB `sounds.bin` in place of a 4+ MB one, caught by nothing until a human read
// the byte count and asked why it shrank 500x.
// ⚠ #2645: a machine with neither the raw .ogg nor a cached encode (a fresh runner, the mob clips) FETCHES the
// missing objects from Mojang's asset CDN into OBJECTS. Build-time only; the game never fetches. Offline or
// blocked: curl fails quietly and the clip counts as missing exactly as before.
{
  const cd = join(MCLITE_ROOT, '.mcsnd', 'opus' + BITRATE);
  const args = [];
  for (const f of wanted) {
    const o = INDEX['minecraft/sounds/' + f + '.ogg'];
    if (!o || existsSync(join(OBJECTS, o.hash.slice(0, 2), o.hash)) || existsSync(join(cd, o.hash + '.opus'))) continue;
    args.push('-o', join(OBJECTS, o.hash.slice(0, 2), o.hash), 'https://resources.download.minecraft.net/' + o.hash.slice(0, 2) + '/' + o.hash);
  }
  if (args.length) {
    try { execFileSync('curl', ['-sf', '--create-dirs', '--parallel', '--parallel-max', '16', '--retry', '2', '--connect-timeout', '15', ...args], { stdio: 'ignore', timeout: 600000 }); }
    catch { /* partial or offline: what landed is used, the rest is reported missing below */ }
  }
}
const present = new Map();        // sound name -> absolute path of the staged .ogg (real source)
const cachedOnly = new Map();     // sound name -> absolute path of an already-encoded opus
let missing = 0;
const cacheDirEarly = join(MCLITE_ROOT, '.mcsnd', 'opus' + BITRATE);
for (const f of wanted) {
  const o = INDEX['minecraft/sounds/' + f + '.ogg'];
  if (!o) { missing++; continue; }
  const p = join(OBJECTS, o.hash.slice(0, 2), o.hash);
  if (existsSync(p)) { present.set(f, p); continue; }
  const cachedPath = join(cacheDirEarly, o.hash + '.opus');
  if (existsSync(cachedPath)) cachedOnly.set(f, cachedPath);
  else missing++;
}
console.log('================= pack-sounds =================');
console.log(' events selected .... ' + events.length + ' of ' + Object.keys(SOUNDS).length);
console.log(' files wanted ....... ' + wanted.size);
console.log(' files present ...... ' + (present.size + cachedOnly.size) + '   (' + missing + ' missing entirely; '
  + present.size + ' from a staged raw .ogg here, ' + cachedOnly.size + ' from a prior encode with no raw source here)');

// ⚠ D-435: A MACHINE WITH NO SOUND SOURCE AT ALL keeps the last good pack instead of failing or
// shipping silence. A cloud session reaches Dan's files one staged file at a time; the 1,214 encodes
// are 25 staging calls, the finished `assets/sounds.bin` is one. It is kept ONLY when nothing here
// could rebuild it (zero raw, zero cached) and its own meta says it was a complete pack — a partial
// pack is never carried forward (a pack from before the rules WIDENED, #2645 bees, is still complete for what it had), and the moment any source is present this branch is skipped.
if (present.size + cachedOnly.size === 0) {
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(OUT, 'sounds.meta.json'), 'utf8')); } catch { /* none */ }
  if (meta && existsSync(join(OUT, 'sounds.bin')) && meta.filesMissing === 0 && meta.filesWanted <= wanted.size
      && statSync(join(OUT, 'sounds.bin')).size === meta.rawBytes) {
    console.log(' no source here ..... keeping the last complete pack (' + meta.filesPresent + ' files, '
      + (meta.rawBytes / 1048576).toFixed(2) + ' MB) — D-435');
    console.log('===============================================');
    process.exit(0);
  }
}

// ── transcode ───────────────────────────────────────────────────────────────────────────────
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
// ⚠ D-409: ffmpeg is needed only for a raw source with no cached encode. The first full suite on
// Dan's Windows PC failed HERE with every one of 1,214 files already encoded and nothing to do.
if (!ffmpeg) console.log(' ffmpeg ............. not on this machine — fine unless a file below needs encoding');

const work = mkdtempSync(join(tmpdir(), 'mclite-opus-'));
const cacheDir = join(MCLITE_ROOT, '.mcsnd', 'opus' + BITRATE);
mkdirSync(cacheDir, { recursive: true });
const names = [...present.keys()].sort();
const blobs = [];
let rawIn = 0, encOut = 0, encoded = 0, cached = 0, fromCacheOnly = 0, failed = [], noenc = [];
for (const n of names) {
  const src = present.get(n);
  rawIn += statSync(src).size;
  // ⚠ CACHED BY SOURCE HASH. The source path IS a content hash, so a cached encode can never be
  // stale — and a full re-encode of 1,200 files on two cores is minutes this suite should not
  // spend on every run.
  const dst = join(cacheDir, src.split('/').pop() + '.opus');
  if (existsSync(dst)) { cached++; }
  else if (!ffmpeg) { noenc.push(n); continue; }   // #2645: raw but no encoder here (lander): counts as missing, like D-435
  else {
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:a', 'libopus',
        '-b:a', BITRATE + 'k', '-ac', '1', '-vbr', 'on', '-application', 'audio', dst],
        { stdio: ['ignore', 'ignore', 'pipe'] });
      encoded++;
    } catch (e) { failed.push(n); continue; }
  }
  const buf = readFileSync(dst);
  encOut += buf.length;
  blobs.push({ n, buf });
}
// ── the cache-only names: no raw source on THIS machine, but a real encode from a session that
// had one. Used as-is -- re-encoding is not possible without the source, and is not needed. ──
for (const [n, dst] of cachedOnly) {
  const buf = readFileSync(dst);
  encOut += buf.length;
  fromCacheOnly++;
  blobs.push({ n, buf });
}
rmSync(work, { recursive: true, force: true });
if (noenc.length) { missing += noenc.length; console.log(' ffmpeg missing ..... ' + noenc.length + ' raw clips not encoded, e.g. ' + noenc[0]); }
if (failed.length) {
  console.error(' x ' + failed.length + ' files failed to encode, e.g. ' + failed.slice(0, 3).join(', '));
  process.exit(1);
}
console.log(' encoded ............ ' + encoded + ' new, ' + cached + ' from cache, ' + fromCacheOnly + ' from cache with no raw source, at ' + BITRATE + ' kbps mono Opus');
console.log(' audio .............. ' + (rawIn / 1024 / 1024).toFixed(2) + ' MB vorbis -> '
  + (encOut / 1024 / 1024).toFixed(2) + ' MB opus  (' + (rawIn / Math.max(1, encOut)).toFixed(2) + 'x)');

// ── the header ──────────────────────────────────────────────────────────────────────────────
const fileIndex = new Map();
let off = 0;
const files = [];
for (const b of blobs) { fileIndex.set(b.n, files.length); files.push({ n: b.n, o: off, l: b.buf.length }); off += b.buf.length; }

let voiced = 0, partial = 0, silent = 0;
const silentEvents = [];
const evOut = {};
for (const ev of events) {
  const e = SOUNDS[ev];
  const entries = [];
  let have = 0, want = 0;
  for (const s of (e.sounds || [])) {
    const n = typeof s === 'string' ? s : s.name;
    if (typeof s !== 'string' && s.type === 'event') {
      // ⚠ an `event` reference is kept as a reference, not flattened: vanilla re-rolls the target
      // event's own weights each time, and flattening would freeze one roll into the table.
      entries.push({ e: n, w: (s.weight || 1), v: (s.volume !== undefined ? s.volume : 1), p: (s.pitch !== undefined ? s.pitch : 1) });
      want++; have++;
      continue;
    }
    want++;
    const idx = fileIndex.get(n);
    if (idx === undefined) continue;
    have++;
    entries.push({
      i: idx, w: (typeof s === 'string' ? 1 : (s.weight || 1)),
      v: (typeof s === 'string' ? 1 : (s.volume !== undefined ? s.volume : 1)),
      p: (typeof s === 'string' ? 1 : (s.pitch !== undefined ? s.pitch : 1)),
      // attenuation_distance (SoundSystem: `max(volume,1) * getAttenuation()`); 16 is the default
      ...((typeof s !== 'string' && s.attenuation_distance !== undefined && s.attenuation_distance !== 16) ? { a: s.attenuation_distance } : {}),
    });
  }
  if (have === 0) { silent++; silentEvents.push(ev); }
  else if (have < want) partial++;
  else voiced++;
  const o = { s: entries };
  if (e.subtitle) o.t = e.subtitle;
  evOut[ev] = o;
}
console.log(' events voiced ...... ' + voiced + ' fully, ' + partial + ' partly, ' + silent + ' silent');
if (silent) console.log('   silent, e.g. ...... ' + silentEvents.slice(0, 6).join(', '));

// ── the block table, so the runtime can ask a BLOCK for its sound ───────────────────────────
// ⚠ THE 76 SOUND TYPES AND A BLOCK -> TYPE INDEX, not 898 x 5 event names. The golden TSV is the
// bytecode's own answer (D-285); this is the same table, indexed. `soundcheck` re-reads the TSV
// and asserts the packed form agrees with it, so the compaction cannot drift from the source.
const TSV = join(MCLITE_ROOT, 'tools', 'golden', 'block-soundtype-1.18.2.tsv');
let types = [], typeVP = [], blockType = {}, typeIndex = new Map();
if (existsSync(TSV)) {
  for (const line of readFileSync(TSV, 'utf8').split('\n')) {
    if (!line || line.charAt(0) === '#') continue;
    const c = line.split('\t');
    if (c.length < 9) continue;
    const key = c.slice(2, 9).join('|');
    if (!typeIndex.has(key)) { typeIndex.set(key, types.length); types.push(c.slice(4, 9)); typeVP.push([+c[2], +c[3]]); }
    blockType[c[0]] = typeIndex.get(key);
  }
  console.log(' block sound types .. ' + types.length + ' distinct, over ' + Object.keys(blockType).length + ' blocks');
} else {
  console.error(' x ' + TSV + ' is missing — run tools/extract-soundtype.mjs first');
  process.exit(1);
}

const header = Buffer.from(JSON.stringify({
  v: '1.18.2', bitrate: BITRATE, codec: 'opus', files, events: evOut,
  types, typeVP, blockType, roles: ['break', 'step', 'place', 'hit', 'fall'],
}), 'utf8');
const body = Buffer.concat(blobs.map((b) => b.buf));
// ⚠ THE HEADER IS DEFLATED AND THE AUDIO IS NOT, and that is a measurement rather than a habit.
// Opus is already entropy-coded: deflating the whole payload saved 9.89% on a 1.08 MB build and
// essentially all of it came from the JSON, which compresses about 5:1. So the header is packed
// and the body is shipped raw — the saving is kept and the runtime does not inflate megabytes of
// incompressible audio at load, which on the 2200G is the part that would be felt.
const headerZ = deflateRawSync(header, { level: 9 });
const whole = Buffer.concat([
  Buffer.from(new Uint32Array([headerZ.length, header.length]).buffer), headerZ, body,
]);
writeFileSync(join(OUT, 'sounds.bin'), whole);
writeFileSync(join(OUT, 'sounds.meta.json'), JSON.stringify({
  bitrate: BITRATE, codec: 'opus',
  eventsSelected: events.length, eventsTotal: Object.keys(SOUNDS).length,
  filesWanted: wanted.size, filesPresent: present.size + cachedOnly.size, filesMissing: missing,
  filesFromRawSource: present.size, filesFromCacheOnly: cachedOnly.size,
  voiced, partial, silent, silentEvents: silentEvents.slice(0, 40),
  soundTypes: types.length, blocksTyped: Object.keys(blockType).length,
  rawBytes: whole.length, audioBytes: encOut, vorbisBytes: rawIn,
  headerBytes: header.length, headerZBytes: headerZ.length,
  base64Bytes: Math.ceil(whole.length * 4 / 3),
}, null, 2));

// ⚠ D-12's ARITHMETIC, WITH BASE64 ALREADY APPLIED — PLAN's acceptance asks for exactly this.
const b64 = whole.length * 4 / 3;
console.log(' sounds.bin ......... ' + (whole.length / 1024 / 1024).toFixed(2) + ' MB  -> '
  + (b64 / 1024 / 1024).toFixed(2) + ' MB base64 (D-12 ceiling 15.00 MB for the whole file)');
console.log(' ' + (Date.now() - t0) + ' ms  ->  ' + join(OUT, 'sounds.bin'));
console.log('==============================================');
