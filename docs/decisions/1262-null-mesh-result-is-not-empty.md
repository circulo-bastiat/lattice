# #1262: a null mesh-job result is not an empty section

Dan, 1 Oct: blocks went see-through right after a BREAK (after #52/#588/#1159 were closed). Cause: `World.requestMesh`
read a job that resolved `null` (nobody ran it - no free worker, pool resizing, mode none) as "this section is
empty", cleared its `meshed` bit and dropped the held mesh. The section stayed invisible until something else dirtied it.
seamcheck was green throughout because it compares mesh CONTENT and never sees a job that did not run.

Fix (land #1498, `src/07_world.js`): `if (!res) { meshDirty |= bit; return; }` - keep the drawn mesh, retry the job.
Also `src/08_lighting.js` `markDirty`: a light change at a section corner/edge now dirties the diagonal neighbour
sections too (smooth light/AO samples them), so their meshes do not go stale.

Checks: `tools/nullmeshcheck.mjs` (null result keeps the mesh, re-dirties, uploads nothing; 2 breaks caught) and the
BREAK phase of `tools/livemeshcheck.mjs` (real page with workers on: tunnels through walls at section/column edges, then
audits the drawn sections against a voxel flood mid-flight and once settled; 18 breaks caught).
