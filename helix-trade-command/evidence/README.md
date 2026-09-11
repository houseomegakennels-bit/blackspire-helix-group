# Prospective evidence runtime directory

Runtime evidence is intentionally not committed. The daily collector appends one canonical JSON record per finalized research day to `ledger.jsonl` and chains each record to the previous hash. `latest-status.json` is the read-only snapshot consumed by Zola/Blackspire UI.

The frozen research specification and code remain version-controlled; runtime market observations remain local. No record can authorize broker execution.
