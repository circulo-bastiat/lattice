#!/usr/bin/env node
// extract-shapes.mjs — #4944. Every block state's four vanilla shapes, produced by RUNNING the 1.18.2 bytecode.
//
//   node tools/extract-shapes.mjs [--if-missing]   -> tools/golden/blockshapes-1.18.2.tsv
//
// tools/golden/ShapeDump.java boots Mojang's own Bootstrap and asks every state in Block.STATE_IDS for
// getShape (outline), getCollisionShape, getVisualShape and getInteractionShape against an empty world.
// Needs a JDK 17 (JAVA_HOME or PATH); a machine without one keeps the committed TSV (same contract as every extractor).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'tools', 'golden', 'blockshapes-1.18.2.tsv');
if (process.argv.includes('--if-missing') && existsSync(OUT)) { console.log(' blockshapes-1.18.2.tsv present — nothing to do'); process.exit(0); }

const bin = (n) => (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', n) : n);
const client = requireJar('1.18.2');
const server = join(client, '..', 'server.jar');
const work = mkdtempSync(join(tmpdir(), 'mclite-shapes-'));
execFileSync('unzip', ['-qo', server, 'META-INF/libraries/*', '-d', work]);   // the server bundle carries guava, fastutil, DFU...
const libs = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.jar') && libs.push(join(d, e.name)); };
walk(join(work, 'META-INF', 'libraries'));
const cp = [client, ...libs].join(delimiter);
execFileSync(bin('javac'), ['-cp', cp, '-d', work, join(ROOT, 'tools', 'golden', 'ShapeDump.java')]);
const tsv = execFileSync(bin('java'), ['-cp', work + delimiter + cp, 'shapedump.ShapeDump'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const n = tsv.split('\n').filter((l) => /^\d/.test(l)).length;
if (n !== 20342) { console.error(`extract-shapes: ${n} states, expected 20342 (vanilla; the engine adds item_frame and glow_item_frame)`); process.exit(1); }
writeFileSync(OUT, tsv);
console.log(`extract-shapes: ${n} states -> ${OUT}`);
