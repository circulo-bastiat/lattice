# #595 - display transforms / model resolution: nothing owed

The #592 roster harness (`tools/texrostercheck.mjs`: 1235 item models x gui/hand/hand3/ground/fixed/placed)
reports zero display-transform, wrong-region, missing-pixel or layer mismatches. Its only pinned rows
(`tools/golden/texroster-known.json`) are one cause, texture-not-in-atlas (shulker boxes, conduit, barrier,
light, structure_void placed views; spyglass_in_hand). That is not a display-transform cause, so #595 has no fix to make.
