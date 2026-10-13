# #2571 KW-CULL-C: the black / invisible regions were a VAO leak, not culling (4 Oct 2026)

Cause: `G.render` runs leash, particles, weather, XP orbs and crystal beams straight after the translucent
pass. None of them binds its own VAO. Each one calls `bindBuffer(ELEMENT_ARRAY_BUFFER)` and
`vertexAttribPointer` (weather uses attributes 0 and 1 explicitly), so it writes into whatever VAO is still
bound. That is the last section arena drawn. The arena's uint attributes become disabled float pointers and its
index buffer becomes the particle one. Every section in that arena (up to 48) then fails to draw, and you see
the clear colour, which is fog and dark at night or underground. Breaking a block remeshes the section into
another slot, which is why that sometimes helped. The geometry was fine, so the mesher/cull audits (#1889,
#2337) stayed green. The headless checks never had particles or weather in the frame between the world passes.

Same class for textures: `syncAtlasDyn`, `setQuality` and the particle pass bind 2D_ARRAYs on the active unit
(0 = the atlas). Only `drawHand` restored it, and only when a hand was drawn.

Fix: `GfxGL.releaseVao()` is called once before the hook slot. `beginFrame` re-binds all four atlas units.
Guard: `tools/vaoleakcheck.mjs` puts a hostile pass in the slot, reads back every arena VAO and unit 0, and
breaks both fixes.
