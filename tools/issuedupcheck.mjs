#!/usr/bin/env node
// issuedupcheck.mjs - #8206: newissue refuses twins and hot-file piles. Fake gh; then three deliberately broken variants must each be caught.
import { checkNew, keys, primaryFile } from './infra/issuedup.mjs';
import { readFileSync } from 'node:fs';
const I = (number, title, state = 'open', extra = {}) => ({ number, title, state, labels: [], ...extra });
const fake = (items, total) => async (p) => (decodeURIComponent(p).includes('in:title') ? { items } : { total_count: total ?? 0, items: [] });
const src = 'Do: add the matcher. Lands in src/02l_advancements.js and src/14l_use.js.';
async function run(opts) {
  const f = [], ok = (c, m) => { if (!c) f.push(m); };
  const at = (t, items, b = src, total = 0) => checkNew({ title: t, body: b }, fake(items, total), opts);
  ok(await at('G17-AT7: advancement trigger minecraft:lightning_strike - matcher', [I(7747, 'G17-AT7: advancement trigger minecraft:lightning_strike - matcher plus the call site', 'closed', { state_reason: 'completed' })]), 'AT twin (same trigger, different tail) must be refused');
  ok(await at('G17-L4-strider: lockstep rollout - strider x20 seeds, zero divergences', [I(6165, 'G17-L4-strider: lockstep rollout - strider, 20 seeds to zero divergences')], 'lockstep'), 'L4 mob twin with different wording must be refused');
  ok(await at('G17-AT7: advancement trigger minecraft:lightning_strike - matcher', [I(1, 'G17-AT7: advancement trigger minecraft:lightning_strike - matcher', 'closed', { state_reason: 'not_planned' })]) === null, 'a twin closed as not_planned must not count');
  ok(await at("G18c-L1: lockstep scenario 'spawnvariants' - rolls", [I(7034, "G18c-L1: lockstep scenario 'spawnegg' - spawn egg use", 'closed', { state_reason: 'completed' })], 'x') === null, 'spawnegg vs spawnvariants are different scenarios');
  ok(await at('G17-AT9: advancement trigger minecraft:slide_down_block - m', [], src, 6), 'the 6th open unit on one file must be refused');
  ok(await at('G17-AT9: advancement trigger minecraft:slide_down_block - m', [], src, 5) === null, 'the 5th is fine');
  ok(await at('G17-AT9: advancement trigger minecraft:slide_down_block - m', [], 'only src/19_data.gen.js and no other file', 99) === null, 'generated files do not count as a hot file');
  ok(primaryFile(src) === 'src/02l_advancements.js', 'primary file is the first named');
  ok(keys('G17-L4-cow: x')[1] === 'g17-l4-cow|', 'mob code key');
  return f;
}
const real = await run({});
real.forEach((m) => console.log('FAIL ' + m));
const breaks = {
  'title-only matching': { keyFn: (t) => [String(t)] },
  'closed not_planned counted': { ignoreNotPlanned: false },
  'infinite hot cap': { cap: Infinity },
};
let caught = 0;
for (const [k, o] of Object.entries(breaks)) { if ((await run(o)).length) caught++; else console.log(`FAIL break not caught: ${k}`); }
const go = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
const isWired = (t) => /checkNew\(\{ title: opt\('--title'\)[\s\S]{0,200}die\(`not filed \(#8206\)/.test(t) && /argv\.includes\('--force'\)/.test(t);
const wired = isWired(go);
if (!wired) console.log('FAIL go.mjs newissue does not call checkNew / honour --force');
if (!isWired(go.replace(/ *if \(!argv\.includes\('--force'\)\)[^\n]*\n/, ''))) caught++; else console.log('FAIL break not caught: newissue unwired');
console.log(`issuedupcheck: ${real.length + (wired ? 0 : 1)} failures, ${caught} breaks caught`);
process.exit(real.length || !wired || caught < 4 ? 1 : 0);
