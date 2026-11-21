# 11498 — util/math class triage (32 classes)

Cited now (comments in src): Matrix4f, Vector4f (`U.mat4`), Box (AABB tests), MathConstants, SimplexNoiseSampler, OctaveSimplexNoiseSampler
(`N.Simplex`, `N.PerlinSimplex`), Constant/Uniform/TrapezoidFloatProvider + FloatProviderType, Constant/Clamped/ClampedNormal/BiasedToBottom/WeightedList
IntProvider + IntProviderType (`intProvider` in 04j_features.js).

Ruled OUT of scope (Java-object plumbing replaced by plain numbers/arrays in a one-file build; no vanilla behaviour lost):
AffineTransformation(s), AxisTransformation, DirectionTransformation (only used by block-model rotation JSON, models are baked at build),
BlockPointer/BlockPointerImpl/PositionImpl (dispenser source wrappers; dispensing reads world+pos directly), ColorHelper (ARGB packing helpers, inlined),
ColumnPos (x,z pairs are plain ints), EulerAngle (armor stand pose: no armor stand pose UI), Vec2f, VerticalSurfaceType (carver/heightmap type tag),
EightWayDirection (only used by redstone-wire/advancement-free neighbour code; wire uses explicit offsets), Quantiles (profiler stats),
WordPackedArray (legacy save format; saves here use own palette format), ClampedNormalFloatProvider (no 1.18.2 carver/feature uses it).

Not claimed: no genuinely-missing class gameplay depends on was found.
