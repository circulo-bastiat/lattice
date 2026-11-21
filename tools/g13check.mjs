#!/usr/bin/env node
// g13check.mjs — PLAN G13, the half a headless test cannot do: DECODE THE AUDIO.
//
//   node tools/g13check.mjs [dist/mclite.html]
//
// ⚠ WHY THIS IS A BROWSER STAGE. `soundcheck` proves the tables — which event a block uses, how
// the weighted roll lands, where each clip sits in the payload. None of that says a single byte
// of it is a decodable Opus stream, and the failure mode if it is not is **silence**: no error,
// no console line, nothing in any counter. The engine would look perfect and the game would be
// mute. So this file hands every shipped clip to the browser's own decoder.
//
// ⚠ AND IT USES AN **OFFLINE** CONTEXT, WHICH NEEDS NO GESTURE. A normal `AudioContext` in
// headless Chromium is created `suspended` and never starts, so anything built on it here would
// prove nothing; `OfflineAudioContext.decodeAudioData` runs the same codec with no audio device
// and no user interaction. That is the difference between a check that runs and one that skips.

import { open, sleep } from './cdp.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] || join(ROOT, 'dist', 'mclite.html');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const s = await open(FILE, { width: 800, height: 500 });
if (!s) {
  console.log('g13check: SKIP — no Chromium on this machine (cdp.mjs found none)');
  process.exit(0);
}

try {
  await sleep(2500);
  const up = await s.evaluate(() => (MCL.Sound && MCL.Sound.ready) ? {
    events: Object.keys(MCL.Sound.events).length, clips: MCL.Sound.files.length,
    bitrate: MCL.Sound.bitrate, types: MCL.Sound.types.length,
  } : null);
  if (!ok(!!up, 'the sound tables decoded in the page')) throw new Error('no sound tables');
  console.log(`      ${up.events} events, ${up.clips} clips at ${up.bitrate} kbps, ${up.types} block sound types`);
  ok(up.clips > 0, `${up.clips} clips shipped`);

  // ── 1. every clip decodes ────────────────────────────────────────────────────────────────
  console.log('\n1. every shipped clip is a decodable stream');
  await s.evaluate(() => {
    const S = MCL.Sound;
    window.__R = { total: S.files.length, ok: 0, fail: 0, dur: 0, min: 9e9, max: 0, failed: [], zero: 0 };
    const oc = new OfflineAudioContext(1, 1024, 44100);
    let i = 0;
    const step = () => {
      if (i >= S.files.length) { window.__R.done = true; return; }
      const f = S.files[i], k = i; i++;
      const sl = S.bytes.slice(S.base + f.o, S.base + f.o + f.l);
      const ab = sl.buffer.slice(sl.byteOffset, sl.byteOffset + sl.byteLength);
      oc.decodeAudioData(ab).then((b) => {
        window.__R.ok++; window.__R.dur += b.duration;
        if (b.duration <= 0) window.__R.zero++;
        if (b.duration < window.__R.min) window.__R.min = b.duration;
        if (b.duration > window.__R.max) window.__R.max = b.duration;
        step();
      }).catch(() => {
        window.__R.fail++;
        if (window.__R.failed.length < 6) window.__R.failed.push(S.files[k].n);
        step();
      });
    };
    step();
    return 1;
  });
  const R = await s.waitFor(() => (window.__R && window.__R.done) ? window.__R : 0, 240000);
  ok(!!R, 'the decode pass finished');
  if (R) {
    console.log(`      ${R.ok}/${R.total} decoded, ${R.dur.toFixed(1)} s of audio, `
      + `shortest ${R.min.toFixed(3)} s, longest ${R.max.toFixed(2)} s`);
    ok(R.fail === 0, `${R.fail} clips did not decode: ${R.failed.join(', ')}`);
    ok(R.ok === R.total, `all ${R.total} clips decoded`);
    // ⚠ A CLIP OF ZERO LENGTH DECODES FINE AND PLAYS NOTHING. That is the exact shape of a
    // truncation bug the "it decoded" assertion above would miss.
    ok(R.zero === 0, `${R.zero} clips decoded to zero seconds`);
    ok(R.min > 0.02, `the shortest clip is ${R.min.toFixed(3)} s — a truncated one would be far shorter`);
    ok(R.max < 30, `and the longest is ${R.max.toFixed(2)} s — nothing here is music`);
    ok(R.dur > R.total * 0.2, `${R.dur.toFixed(1)} s over ${R.total} clips averages ${(R.dur / R.total).toFixed(2)} s each`);
  }

  // ── 2. the block hooks resolve through the real state table ──────────────────────────────
  console.log('\n2. block -> event, through the live state table');
  const B = await s.evaluate(() => {
    const S = MCL.Sound, R = MCL.Reg, St = MCL.States;
    const firstState = (name) => {
      const b = R.names.indexOf(name);
      if (b < 0) return -1;
      for (let i = 0; i < St.block.length; i++) if (St.block[i] === b) return i;
      return -1;
    };
    const out = {};
    for (const n of ['stone', 'grass_block', 'oak_planks', 'glass', 'sand', 'white_wool', 'deepslate']) {
      const st = firstState(n);
      out[n] = { state: st, brk: S.blockEvent(st, 'break'), step: S.blockEvent(st, 'step') };
    }
    out.air = { state: 0, brk: S.blockEvent(0, 'break') };
    return out;
  });
  for (const [n, want] of [['stone', 'block.stone'], ['grass_block', 'block.grass'], ['oak_planks', 'block.wood'],
    ['glass', 'block.glass'], ['sand', 'block.sand'], ['white_wool', 'block.wool'], ['deepslate', 'block.deepslate']]) {
    ok(B[n] && B[n].brk === want + '.break' && B[n].step === want + '.step',
      `${n} -> ${want}.* (got ${B[n] && B[n].brk} / ${B[n] && B[n].step})`);
  }
  ok(B.stone.brk !== B.grass_block.brk, 'stone and grass are different sounds, through the live table');

  // ── 3. the context is blocked until a gesture, and says so ───────────────────────────────
  console.log('\n3. the context');
  const C = await s.evaluate(() => {
    const S = MCL.Sound;
    S.start();
    const before = S.played;
    const played = S.play('block.stone.break', { volume: 0.0001 });
    return { blocked: S.blocked, state: S.ctx ? S.ctx.state : 'none', played: played, delta: S.played - before };
  });
  console.log(`      context state: ${C.state}, blocked: ${C.blocked}`);
  // ⚠ headless Chromium has no audio device, so the context stays suspended — and the ENGINE
  // must report that honestly rather than pretending it played. That is the assertion.
  ok(C.state === 'suspended' || C.state === 'running', `the context exists (state ${C.state})`);
  if (C.state === 'suspended') {
    ok(C.blocked === true, 'a suspended context reports itself blocked');
    ok(C.played === false && C.delta === 0, 'and play() refuses rather than silently counting a play');
  } else {
    ok(C.delta === 1, 'a running context plays');
  }

  // ── 4. anti-vacuity ──────────────────────────────────────────────────────────────────────
  console.log('\n4. anti-vacuity: break it, and it must be caught');
  // ⚠ `evaluate` RETURNS THE VALUE, NOT THE PROMISE'S VALUE. An `async` body here hands back a
  // Promise object, which serialises as `{}` — every assertion below then read `undefined` and
  // "passed" by being falsy in the wrong direction. This writes to a global and waits for it,
  // the same shape §1 uses, which is why §1 was right the first time and this was not.
  await s.evaluate(() => {
    const S = MCL.Sound;
    const oc = new OfflineAudioContext(1, 1024, 44100);
    const out = {};
    window.__A = null;
    (async () => {
    // a clip sliced one byte late is not a stream — if this DECODED, §1 would prove nothing
    const f = S.files[0];
    const bad = S.bytes.slice(S.base + f.o + 1, S.base + f.o + f.l);
    const ab = bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength);
    out.offByOne = await oc.decodeAudioData(ab).then(() => 'decoded').catch(() => 'refused');
    // random bytes must be refused too
    const junk = new Uint8Array(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 2654435761) & 255;
    out.junk = await oc.decodeAudioData(junk.buffer).then(() => 'decoded').catch(() => 'refused');
    // and the real one must still decode, in the same context
    const g = S.files[0];
    const good = S.bytes.slice(S.base + g.o, S.base + g.o + g.l);
    const gb = good.buffer.slice(good.byteOffset, good.byteOffset + good.byteLength);
    out.good = await oc.decodeAudioData(gb).then((b) => b.duration).catch(() => -1);
      window.__A = out;
    })();
    return 1;
  });
  const A = await s.waitFor(() => window.__A || 0, 60000);
  ok(!!A, 'the anti-vacuity decodes finished');
  okAv(A.offByOne === 'refused', `a clip sliced one byte late is ${A.offByOne} — the offsets are doing work`);
  okAv(A.junk === 'refused', `4 KB of junk is ${A.junk} — the decoder is not accepting anything`);
  okAv(A.good > 0, `and the correctly sliced clip decodes to ${A.good.toFixed(3)} s in the same context`);

  const errs = s.problems.filter((p) => !/AudioContext|autoplay|user gesture/i.test(p));
  ok(errs.length === 0, 'the page logged no errors (' + errs.slice(0, 2).join(' | ') + ')');
} finally {
  console.log('');
  console.log('================ g13check ==================');
  console.log(` assertions passed .. ${pass}`);
  console.log(` failures ........... ${fails.length}`);
  console.log(` breaks caught ...... ${breaks}`);
  console.log('===========================================');
  await s.close();
}
process.exit(fails.length ? 1 : 0);
