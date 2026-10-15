# #3959 Tests run on GitHub-hosted runners, not on Dan's PC

Dan, 7 Oct 2026: tests no longer run on his PC; they run on GitHub's free cores.

- Lander (land.yml): job `land-hosted` on ubuntu-latest: bootstrap game data from the `store` branch, then `tools/infra/land.mjs` (core suite ~94 s). After a landing it dispatches `localcopy.yml`, which the PC express runner runs (cheap, no tests) to refresh Projects\mclite.
- Full suite (full-suite.yml): 16 shards (`tools/infra/fullshard.mjs i 16`, slice by stage id, browser stages included on SwiftShader), artifacts merged by the `aggregate` job into the same `full.mjs` red/master-red logic (`FULL_AGG_DIR`). `tools/fullshardcheck.mjs` proves every id runs exactly once and a missing shard is a red.
- Proof (#3951): at one master sha the hosted full suite's red set was {bobcheck, soundcheck, wtradercheck, noteblockcheck} + quarantined {dupcheck, tickcheck}; every one is also red on the PC. The PC additionally went red on timing-sensitive checks under load that hosted did not.
- Rollback: repo variable `TEST_RUNNER=pc` (land-pc / full-pc jobs, unchanged). Risk: private repos have a monthly Actions-minutes quota; watch usage and flip to pc if it runs out.

- First hosted landing: this line was landed by the hosted lander (7 Oct), proving the path end to end.
- Second marker: landed by the hosted lander only (PC runner idle, TEST_RUNNER=hosted).
