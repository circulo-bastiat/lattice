# 9640 - a red lander batch names its red rows and the culprit is found among its members

Date: 22 Oct 2026. Decided by: commanders (#9641 by the 14:10 ET commander, culprit hunt and #9656 by the 14:18 ET commander).

**Problem.** From ~16:30Z to 19:05Z the lander tested the same batch (#9591 #9592 #9593) 40+ times, landed almost nothing and never said which
check was red; its one-PR rounds went to other heads. The culprit (#9592: a new item_frame entity shape, combatcheck's shape list not updated) was
found by hand in the brain VM in one run of combatcheck per member.

**Decision.** (#9641) red() prints the red rows; single rounds go to the red batch's members first; only tested rounds use the backoff; every single
round logs its result. (#9656) the core.json heal pushes the tested tree (scratch ref `heal/<n>`, origin's stored credentials) before the Git Data
API commit, so a core.json-only conflict no longer bounces a PR after a full test. Batch size stays 4 (a lander round is ~4.5 min on the mirror;
with the culprit found, a green batch lands 4 per round).
