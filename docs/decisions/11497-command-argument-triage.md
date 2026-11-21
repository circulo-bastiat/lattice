# 11497 — command/argument class triage (43 classes)

Cited in `src/15g_commands.js` header: the argument types are parsers on `NS.Brig` (14h_brigadier.js), registered per command.
Serializer classes (ArgumentSerializer, Constant/Double/FloatArgumentSerializer, ArgumentTypes, BrigadierArgumentTypes) exist only
to sync the command tree to a network client; single-player has no client, so they are ruled out (no behaviour to match).
TestClassArgumentType / TestFunctionArgumentType belong to the GameTest framework (`/test`), ruled out of scope.
Not claimed as verified: some types (e.g. scoreboard ones, CommandFunctionArgumentType) may be only partly wired; follow-ups if a command needs them.
