# Blackspire Canonical Source of Truth

## 2026-09-21 — successor final-input preparation before retirement

A separate protected successor-input operator now retains one new operation UUID per successor release and constructs schema-three input while preserving the original source-security, copy and hardening records. It verifies their exact retained digests, the fixed owned profile, previous main/recovery pins, the new sealed production artifact and the predecessor's actual HELD lifecycle before and after preparation stages. It does not require a successor lineage plan or new preview origin before input creation; those remain later gates.

The operator observes the current workflow with two GET-only requests using a private in-memory observation sink, leaving global workflow/release event streams untouched. It regenerates the exact-SHA offline package, captures a fresh bounded consistent SQLite backup from the HELD predecessor, and binds disk, activation-location and backup inputs to the new candidate. Per-release protected intents/results preserve partial effects; an intent without a result refuses automatic repetition. Read-only inspection validates retained outputs and explicitly reports that lineage and activation are still required.

Six focused orchestration regressions cover retained identity, read-only inspection, ambiguous backup refusal, source/HELD drift and invalid retained evidence. The native host composes existing protected I/O, backup, package, artifact/disk and HELD observers; a full successor host execution remains UNVERIFIED. No production preparation, database or remote workflow changes were executed by this implementation.
