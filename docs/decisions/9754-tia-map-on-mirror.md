# 9754: the TIA map is shipped back from the mirror

Date: 22 Oct 2026 (commander). Status: in force.

**Found.** No tia-map.json had ever been written on the mirror path, so the lander always ran the core suite only.

**Decision.** The report step of ci-full.yml ships `tia-map-<i>.json` beside the shard result, and `collectFull` fetches it.

**Public-repo note.** The map is a list of stage ids and repo file paths, with no code. The result branches already carry the shard logs, and the
janitor (#9709) deletes them after 12 h; `collectFull` deletes them at once.

**Cost.** The lander adds up to 6 min (`capMin`) of impact-selected stages to each batch. Reds are caught before master instead of by the
2-hourly full run, which serves the goal that master's red checks go down.
