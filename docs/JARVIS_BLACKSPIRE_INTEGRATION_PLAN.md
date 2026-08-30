# Jarvis ↔ Blackspire Ecosystem Integration Plan

## Goal

Jarvis is the single mobile command surface for Blackspire. Blackspire Command remains the canonical control plane and Hermes remains the orchestration/runtime layer. Jarvis must never gain unrestricted database, filesystem, credential, or production access to a division. Every division exposes a bounded, typed capability contract that flows through the existing Unified Input → policy/authorization → Hermes → provider/division execution → evidence/result lifecycle.

The operator should be able to state a business objective in plain language without knowing which Blackspire engines are required. Jarvis determines the required capabilities, presents approvals when needed, executes only authorized actions, and returns one canonical answer with evidence.

## Priority integration order

### Phase 1 — Core real-estate control

Integrate these first because together they create an end-to-end wholesale workflow:

1. **Seller Engine**
   - Search and score motivated-seller opportunities.
   - Inspect property and lead records.
   - Update lead stage/status through approved mutations.
   - Schedule follow-up and hand qualified sellers into Deal Engine.

2. **Buyer Engine**
   - Search and manage buyers.
   - Filter by geography, property type, price, strategy, and other persisted criteria.
   - Match buyers to deals.
   - Track disposition and follow-up state.

3. **Deal Engine**
   - Underwrite opportunities.
   - Calculate ARV, repairs, MAO, projected spread, and assignment potential.
   - Rank opportunities.
   - Build deal packages.
   - Coordinate approved offer, contract, and closing workflows.

4. **Nexus**
   - Perform contact enrichment and skip-trace workflows using approved sources.
   - Deduplicate people/entities.
   - Sync owner/buyer contact intelligence back into the canonical property/lead records.

### Phase 2 — Discovery and ingestion

5. **Harvester**
   - Ingest PDFs, spreadsheets, screenshots, emails, lists, and other approved documents.
   - OCR/extract property, seller, buyer, and deal data.
   - Convert raw inputs into canonical leads/opportunities.
   - Feed Seller Engine, Nexus, Deal Engine, and Buyer Engine without creating duplicate records.

6. **Recon Engine**
   - Discover market opportunities from connected sources.
   - Run saved searches and market scans.
   - Surface new properties/leads that fit operator-defined acquisition criteria.
   - Feed qualified discoveries into Seller Engine/Harvester intake rather than creating a parallel deal pipeline.

### Phase 3 — Oversight and intelligence

7. **Sentinel**
   - Sit above the ecosystem as command intelligence.
   - Monitor stale tasks, failed jobs, unsafe workspace state, approvals, quarantines, provider health, pipeline anomalies, and high-value business events.
   - Alert Jarvis when operator attention is required.
   - Never bypass the control plane to take action directly.

### Phase 4 — Business operations expansion

8. **Social OS**
   - Draft and manage buyer/seller marketing campaigns.
   - Coordinate approved publishing and outreach workflows.
   - Operate client workspaces through the same authorization and approval model.

9. **Book Studio**
   - Query book/chapter/media status.
   - Start approved generation/publishing workflows.
   - Surface rendering failures, asset status, and publication readiness through Jarvis.

Additional Blackspire divisions should adopt the same contract before Jarvis receives control of them.

## Canonical real-estate orchestration

The canonical property/deal pipeline remains one connected operating system, not a set of duplicate workflows.

**Discovery/intake:**

Recon and Harvester feed the canonical property/seller pipeline.

**Core pipeline:**

Harvester / Recon → Seller Engine → Nexus → Deal Engine → Buyer Engine → Transaction → Closed

**Supervision:**

Sentinel observes the whole pipeline and reports exceptions to Jarvis.

The property remains the shared master business object. Divisions should enrich or act on the same canonical record rather than creating competing copies, scores, or contact histories.

## Example Jarvis wholesale workflow

Operator request:

> Find me the five best wholesale opportunities within 40 miles of Winston-Salem that could produce at least a $20,000 assignment fee.

Expected orchestration:

1. Jarvis parses the objective and acquisition constraints.
2. Recon and/or Harvester identify candidate properties from authorized sources.
3. Seller Engine scores seller/property opportunity quality.
4. Nexus enriches ownership/contact data when authorized.
5. Deal Engine calculates ARV, repair estimate, MAO, projected spread, and deal confidence.
6. Buyer Engine checks likely disposition demand against current buyer criteria.
7. Jarvis returns one ranked result set with source, address, asking/target price, ARV, repairs, MAO, estimated assignment spread, seller/contact availability, buyer-match strength, and the reason each opportunity ranked where it did.

Follow-up commands should stay in the same conversation and task graph, for example:

- “Skip trace the top three.”
- “Which one has the highest probability of closing?”
- “Show me buyers for property #2.”
- “Draft the seller text for #1.”
- “Prepare an offer at $117,500.”

Jarvis decides which Blackspire capabilities are needed for each follow-up.

## Capability contract required for every division

Each division must expose explicit capabilities rather than handing Jarvis unrestricted access.

Every capability should declare:

- capability ID and human-readable purpose;
- division/workspace owner;
- read-only vs mutation execution intent;
- required principal/workspace grant;
- risk/action class;
- whether operator approval is required;
- validated input schema;
- bounded output/result schema;
- durable evidence/artifact behavior;
- cancellation semantics;
- idempotency/replay behavior;
- external provider/source requirements;
- secrets boundary;
- timeout/budget limits;
- audit events;
- rollback or compensation behavior for mutations.

All capability execution must pass through the existing Blackspire authorization, policy, task, worker, evidence, cancellation, emergency-stop, and outcome_unknown controls.

## Control levels

### Read-only / low-risk

May run automatically when the authenticated operator already has the required grant:

- search records;
- inspect leads/deals/buyers;
- market scans;
- underwriting calculations;
- buyer matching;
- status reports;
- pipeline summaries;
- evidence retrieval.

### Controlled mutation

Requires explicit mutation intent and policy validation:

- update lead stage;
- add notes/tags;
- save underwriting;
- create follow-up tasks;
- create buyer/deal associations;
- prepare draft outreach or documents.

### Approval-required / external side effect

Must require approval or another explicit operator confirmation before irreversible or externally visible action:

- send seller/buyer outreach;
- publish content;
- submit an offer;
- generate/send contracts for signature;
- alter closing/transaction state;
- spend money or incur metered provider cost;
- delete or destructively modify business records.

## Jarvis UX target

Jarvis should present one unified conversation and task experience instead of forcing the operator to open each engine.

For a multi-engine task Jarvis should show:

- the operator objective;
- engines/capabilities selected by Hermes;
- current stage;
- approvals waiting;
- canonical result;
- deal/property entities involved;
- evidence/source provenance;
- next recommended actions;
- ability to cancel or emergency-stop where appropriate.

The UI can expose deep links into a division for advanced/manual work, but normal operation should remain possible from Jarvis.

## Implementation sequence after core Jarvis production deployment

1. Define the shared `BlackspireCapability` contract and capability registry.
2. Add capability discovery/routing to Hermes without creating a second orchestrator.
3. Integrate Seller Engine read-only capabilities first.
4. Add Buyer Engine read-only search/matching.
5. Add Deal Engine underwriting/read-only analysis.
6. Add Nexus enrichment/skip-trace behind appropriate authorization and source controls.
7. Prove one end-to-end read-only wholesale search through Jarvis.
8. Add controlled mutation capabilities for lead/deal state.
9. Add approval-gated outreach/offer/contract actions.
10. Integrate Harvester intake and Recon discovery into the same canonical property pipeline.
11. Add Sentinel ecosystem oversight and alerts.
12. Expand to Social OS, Book Studio, and other Blackspire divisions using the same contract.

## Acceptance target for the first complete wholesale slice

Jarvis should be able to accept one natural-language acquisition objective and, without requiring the operator to manually open another Blackspire app:

- discover candidate properties from authorized sources;
- rank motivated-seller opportunities;
- enrich owner/contact information where authorized;
- calculate ARV, repairs, MAO, and projected assignment spread;
- match likely buyers;
- return a ranked, source-backed shortlist;
- continue follow-up work in the same conversation;
- require approval before outreach, offers, contracts, or other external/mutating actions;
- preserve durable task/evidence history and no-replay safety.

This is the target definition of “Jarvis has complete operational control of the Blackspire real-estate stack”: complete orchestration through bounded capabilities, not unrestricted root/database access.