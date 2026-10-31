# Hosted lander (#10420, 27 Oct)

Dan's ruling (27 Oct): the whole project runs on GitHub, nothing of MC-Lite on his PC. `TEST_RUNNER=lattice`: the private `land.yml` runs nothing; the hosted brain tick (`brain.mjs land`) starts the public mirror's `land.yml` (`MCLITE_LANDER=lattice`) for the oldest labelled PR when none runs (4-min cooldown). Checks: `landhostcheck`, `hostedrunscheck`. Roll back: set `TEST_RUNNER=pc` and start the `-land` runner.
