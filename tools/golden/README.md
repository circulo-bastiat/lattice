# tools/golden — the vanilla answer keys

Generated data that is **kept**, which is the exception to D-6 rather than a hole in it: D-6
refuses to keep anything the suite can rebuild from Dan's jars in ten seconds, and none of this
can be. It needs the 1.18.2 **server** jar, a JVM, and a download of Mojang's official mappings —
a machine with the game and a network, which is not the machine the suite runs on. Every file
here records where it came from, and `noisecheck` §6 asserts the provenance before it trusts a
single number.

## `noise-golden-1.18.2.json` — Mojang's noise stack, sampled (D-229, D-235)

**246 cases, 2,135 values, 2,872 exact comparisons** in `tools/noisecheck.mjs` §6. Taken by
reflection out of the real 1.18.2 server bytecode: nothing in it is a reimplementation, and
nothing in it was derived from `src/03b_noise.js`. Its `provenance` block carries the server jar
SHA-1, the bundled jar's SHA-1, the mappings URL and SHA-1, the JVM string, the obfuscated name
of every class read, and the notes the dumper wrote about what it had to settle by experiment.

Three things about the shape of it, because they are the parts that catch bugs:

- **The positional seeds run a WIDTH LADDER, not a cluster near the origin** (D-235). D-229's
  `Mth.getSeed` bug started at x = ±687 and every position anyone had ever checked was under 20.
  The 34 positions now sit either side of ±687, either side of ±2^20 and ±2^24, at the million-
  block distances `soakcheck` flies to, at the world border, and at the int extremes — with y
  swept from −64 to 320 and the signs of x and z mixed. `noisecheck` §6 asserts that spread
  **about the file**, so a dump that drifted back to the origin fails instead of agreeing.
- **The bounded draw's REJECTION branch is forced** (D-235). Both random sources reject about
  once in ten million draws for the bounds the game uses, so every ordinary case takes the fast
  path. Twelve cases are constructed to land in the window — the eight legacy ones by inverting
  the LCG, the four Xoroshiro ones by search at bounds where the branch is reachable — and each
  carries `drawsConsumed`, **measured with Mojang's own API** (run the bounded call, then run k
  plain draws on a fresh source and compare the state). The check asserts it is greater than one,
  so a regenerated dump that stopped rejecting fails rather than turning into an ordinary draw.
- **All sixty noises have values**, enumerated from `BuiltinRegistries.NOISE` rather than typed
  out. Twelve are sampled in depth — the raw `PerlinNoise` stack and its per-octave origins as
  well as the `NormalNoise` — and the other 48 get parameters, `valueFactor`, `maxValue` and
  fifteen values each. That closes the gap D-229 left open.

`noisecheck` skips §6 with a printed reason if this file is absent, and §§1–5 still run.

## `bytecode-widths-1.18.2.txt` — WHY, not just what (D-235)

A golden value proves what the game computes; it does not say in what WIDTH. D-229's bug was an
`int * int` that wraps at 32 bits before being widened, and the only place that fact is written
down is the bytecode. This file is the `javap -p -c` disassembly of the eight methods whose
integer widths MC-Lite depends on — `Mth.getSeed`, both bounded draws, and the five
`WorldgenRandom` seed functions Track G has yet to port — with a note on each saying which
multiplies are 32-bit and which are 64-bit. `ng_dump.js` writes the full disassembly of eleven
classes into its `ngwork/javap/`; only the readable extract is kept here.

### How to regenerate both

`ng_dump.js` and `NoiseDump.java` here are the reference copies of the generator; the working
copies live in MineHTML's `_scratch/mclite/` on the **Windows** machine, which is where they run,
because that is the machine with internet, Java and the jars. To take a fresh dump:

1. Put both files in `_scratch/mclite/` beside a verified `server.jar` and the bundler's
   extracted `pregen/versions/1.18.2/server-1.18.2.jar` + `pregen/libraries/`.
2. Drop a job in `the runner's inbox` whose command is `node _scratch/mclite/ng_dump.js`.
   ⚠ **`cwd: claudeisthegoat` is the INNER repo** — the path is
   `claudeisthegoat/claudeisthegoat/_scratch/mclite/`, and a job that writes to the outer one
   fails with MODULE_NOT_FOUND.
3. Copy `ngwork/noise-golden-1.18.2.json` here. The dump is **no longer echoed to stdout** — with
   sixty noises it is 138 KB and `ngwork/` is a synced folder, so the file is the channel.

`ng_dump.js` verifies both SHA-1s and **refuses to run** if any name fails to resolve, printing
the full member list of every class it looked at so the next mapping change is a five-minute fix.

Five things about this rig that cost a round trip each to learn, so they are written down:
`XoroshiroRandomSource` delegates its two 64-bit words to `Xoroshiro128PlusPlus`; the obfuscated
classes are in the default package and are **signed**, so the dumper must live in a package of
its own; the server jar ships **no** `data/minecraft/worldgen/noise/*.json` (those are an export
of `BuiltinRegistries.NOISE`); `NoiseParameters` cannot be loaded before `Bootstrap.bootStrap()`;
and — D-235 — **`java` on that PC is Oracle's javapath shim, whose directory holds `java.exe` and
nothing else**, so `javap` is not beside it and `where javap` / `where javac` both come back
empty. `java -XshowSettings:properties` prints `java.home`, and `javap` is in its `bin/`. Before
that was found the eleven disassemblies were written as **empty files with no error**, which is
the failure mode this rig has to be loudest about.
