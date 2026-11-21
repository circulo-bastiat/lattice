# #7807 Phone app B: design system, shell, tab registry

- `theme.css` (inlined into index.html at the `/*THEME*/` marker by build.mjs) holds the tokens; the old CSS variable names are aliased to them, so legacy screens take the new look without a rewrite.
- State colours are fixed: working blue, waiting grey, in review purple, blocked amber, landed green, red. `phoneshellcheck` fails if two collide.
- `ui.js` components; data components go through `UI.Async` so loading, empty and error exist. Errors are plain English (`UI.plain`), never "GitHub 403 on GET".
- `tabs.js` registry: adding a section = a module + one line. `render()` returning null means app.js still draws that route.
- Bottom bar: Home, Bugs, Mobs, Runs (the old Stats screen, `#/stats`), Requests. Controls, Talk, Questions and Alerts moved to the gear sheet on Home; their routes are unchanged. The Questions count badge no longer has a tab (the app-icon badge still counts it).
- sw.js carries `BUILD`, a hash of every phone-web file stamped by build.mjs; old caches are deleted on activate.
- Bugs badge = open `dan` issues (fetched when Home opens); the Bugs/Mobs screens are an "arriving soon" EmptyState until C and D.
