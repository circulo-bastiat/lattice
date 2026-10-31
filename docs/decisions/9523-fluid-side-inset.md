# 9523 — fluid side-face inset is one vertex unit (1/256)

Vanilla `LiquidBlockRenderer` insets each fluid side face by 0.001 so it does not z-fight with the neighbouring block's face.
The model vertex stream is int16 at 1/256 block (0.0039), so 0.001 (0.256 units) is not representable.

RULING: side faces are inset by exactly 1 unit (`FLUID_INSET` in `src/05_mesher.js`), the smallest representable step.
It is ~4x vanilla's inset and invisible at any viewing distance; the vertex format is NOT widened (render, not parity-critical).
Top and bottom faces are unchanged.
