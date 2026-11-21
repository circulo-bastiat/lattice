# #6636 - the size wall: comments stripped by default, ceiling 20 MB

Dan, 13 Oct 2026 01:40Z, asked as multiple choice by the commander ("Strip comments" / "Raise limit to 20 MB" / "Both" / "Decide later"): **Both**.

- Why: dist/mclite.html was 17,543,275 bytes = 95.1% of the 18 MB ceiling (D-742), 897 KB left, growing ~0.3 MB/day; the build fails over the ceiling, so every PR would have bounced in ~3 days.
- build.mjs now runs the existing comment stripper (stripComments, formerly opt-in `--min`, D-48) on every build; `--no-min` keeps comments for debugging. src/ keeps every comment.
- CEILING 18 MB -> 20 MB (supersedes D-742's number). The rule stands: compress or drop a payload before asking to raise it again.
- Proof the stripper eats no code: the core suite on the lander and the next full suite on the PC.
