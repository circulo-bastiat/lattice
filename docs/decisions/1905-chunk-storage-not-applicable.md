# #1905 C2ME-7 chunk storage off the main thread: not applicable

MC-Lite persists no chunk blobs. `16b_save.js` (D-74) stores one localStorage key: a sparse edit-diff
(six bytes per edit, base64) plus the JSON envelope. Terrain is regenerated from the seed, so there is
nothing to compress, batch into IndexedDB transactions, or load from storage in a worker. A chunk store
would reverse D-74 and cost more than regenerating the chunk. The edit buffer is flat bytes with no
per-voxel JSON, so a worker serialiser would only add a copy.

Closed as not applicable. Reopen only if Dan overturns D-74.
