# ZOLA ↔ Blackspire Ecosystem Integration Plan

## Canonical AI identity

**Z.O.L.A. — Zero-Trust Operations, Logic & Automation**

ZOLA is the official Blackspire AI/operator identity and replaces the former working name **Jarvis** for future product, roadmap, UI, and engineering references.

The rename is intentionally staged. Legacy runtime paths, filenames, routes, fixtures, historical records, and deployed identifiers may continue to contain `jarvis` until a dedicated reviewed migration changes them. Do not perform opportunistic runtime renames inside security, authentication, release, or capability work.

Canonical responsibilities remain unchanged:

- **ZOLA** is the user-facing intelligence and command surface.
- **Blackspire Command** remains the canonical control plane.
- **Hermes** remains the orchestration/runtime layer.
- Blackspire divisions expose bounded, typed capabilities rather than unrestricted database, filesystem, credential, or production access.

## Goal

ZOLA is the single mobile command surface for Blackspire. Every division exposes a bounded capability contract that flows through the existing Unified Input → policy/authorization → Hermes → provider/division execution → evidence/result lifecycle.

The operator should be able to state a business objective in plain language without knowing which Blackspire engines are required. ZOLA determines the required capabilities, presents approvals when needed, executes only authorized actions, and returns one canonical answer with evidence.

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
   - Filter by geography, property type, price, strategy, and persisted criteria.
   - Match buyers to deals.
   - Track disposition and follow-up state.

3. **Deal Engine**
   - Underwrite opportunities.
   - Calculate ARV, repairs, MAO, projected spread, and assignment potential.
   - Rank opportunities and build deal packages.
   - Coordinate approved offer, contract, and closing workflows.

4. **Nexus**
   - Perform contact enrichment and skip-trace workflows using approved sources.
   - Deduplicate people/entities.
   - Sync owner/buyer contact intelligence into canonical property/lead records.

### Phase 2 — Discovery and ingestion

5. **Harvester**
   - Ingest PDFs, spreadsheets, screenshots, emails, lists, and other approved documents.
   - OCR/extract property, seller, buyer, and deal data.
   - Convert raw inputs into canonical leads/opportunities.
   - Feed Seller Engine, Nexus, Deal Engine, and Buyer Engine without duplicate records.

6. **Recon Engine**
   - Discover government contracts, grants, vendor programs, and similar public/private bid opportunities.
   - Preserve Recon's existing agency, solicitation, deadline, proposal-support, and vendor-workflow boundaries.
   - Remain separate from the real-estate property pipeline; Recon does not discover properties or motivated-seller leads.

Real-estate property discovery continues through Seller Engine's existing county/public-record sources, operator imports, and Harvester intake. If broader property discovery is needed later, define it as a new bounded real-estate capability with explicit sources, authorization, schemas, and handoff into the canonical Seller Engine pipeline; do not repurpose Recon.

### Phase 3 — Oversight and intelligence

7. **Sentinel**
   - Sit above the ecosystem as command intelligence.
   - Monitor stale tasks, failed jobs, unsafe workspace state, approvals, quarantines, provider health, pipeline anomalies, and high-value business events.
   - Alert ZOLA when operator attention is required.
   - Never bypass the control plane to take action directly.

### Phase 4 — Business operations expansion

8. **Social OS**
   - Draft and manage buyer/seller marketing campaigns.
   - Coordinate approved publishing and outreach workflows.
   - Operate client workspaces through the same authorization and approval model.

9. **Book Studio**
   - Query book/chapter/media status.
   - Start approved generation/publishing workflows.
   - Surface rendering failures, asset status, and publication readiness through ZOLA.

Additional Blackspire divisions should adopt the same contract before ZOLA receives control of them.

## Canonical real-estate orchestration

The canonical property/deal pipeline remains one connected operating system, not a set of duplicate workflows.

**Discovery/intake:** Seller Engine's authorized county/public-record sources, operator imports, and Harvester feed the canonical property/seller pipeline. A future property-discovery capability may join this intake only after its own bounded contract is reviewed. Recon remains the separate government-contract/grant/vendor opportunity system.

**Core pipeline:**

Seller Engine sources / operator imports / Harvester → Seller Engine → Nexus → Deal Engine → Buyer Engine → Transaction → Closed

**Supervision:** Sentinel observes the whole pipeline and reports exceptions to ZOLA.

The property remains the shared master business object. Divisions should enrich or act on the same canonical record rather than creating competing copies, scores, or contact histories.

## Example ZOLA wholesale workflow

Operator request:

> Zola, find me the five best wholesale opportunities within 40 miles of Winston-Salem that could produce at least a $20,000 assignment fee.

Expected orchestration:

1. ZOLA parses the objective and acquisition constraints.
2. Seller Engine's authorized county/public-record sources, operator imports, and/or Harvester identify candidate properties. A future reviewed property-discovery capability may also supply candidates; Recon does not.
3. Seller Engine scores seller/property opportunity quality.
4. Nexus enriches ownership/contact data when authorized.
5. Deal Engine calculates ARV, repair estimate, MAO, projected spread, and deal confidence.
6. Buyer Engine checks likely disposition demand against current buyer criteria.
7. ZOLA returns one ranked result set with source, address, asking/target price, ARV, repairs, MAO, estimated assignment spread, seller/contact availability, buyer-match strength, and the reason each opportunity ranked where it did.

Follow-up commands should stay in the same conversation and task graph, for example:

- “Zola, skip trace the top three.”
- “Which one has the highest probability of closing?”
- “Show me buyers for property #2.”
- “Draft the seller text for #1.”
- “Prepare an offer at $117,500.”

ZOLA decides which Blackspire capabilities are needed for each follow-up.

## Capability contract required for every division

Each division must expose explicit capabilities rather than handing ZOLA unrestricted access.

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

All capability execution must pass through existing Blackspire authorization, policy, task, worker, evidence, cancellation, emergency-stop, and `outcome_unknown` controls.

## Control levels

### Read-only / low-risk

May run automatically when the authenticated operator already has the required grant: searches, lead/deal/buyer inspection, market scans, underwriting calculations, buyer matching, status reports, pipeline summaries, and evidence retrieval.

### Controlled mutation

Requires explicit mutation intent and policy validation: lead-stage updates, notes/tags, saved underwriting, follow-up tasks, buyer/deal associations, and draft outreach/documents.

### Approval-required / external side effect

Must require approval or another explicit operator confirmation before irreversible or externally visible action: seller/buyer outreach, publishing, offer submission, contracts for signature, closing/transaction changes, spending money or incurring metered provider cost, and destructive record changes.

## ZOLA UX target

ZOLA should present one unified conversation and task experience instead of forcing the operator to open each engine.

For a multi-engine task ZOLA should show the operator objective, engines/capabilities selected by Hermes, current stage, waiting approvals, canonical result, involved deal/property entities, evidence/source provenance, recommended next actions, and cancellation/emergency controls where appropriate.

The UI can expose deep links into a division for advanced/manual work, but normal operation should remain possible from ZOLA.

## Implementation sequence after core production verification

1. Finish and verify the current core production checkpoint before broad integration or runtime renaming.
2. Define the shared `BlackspireCapability` contract and capability registry.
3. Add capability discovery/routing to Hermes without creating a second orchestrator.
4. Integrate Seller Engine read-only capabilities first.
5. Add Buyer Engine read-only search/matching.
6. Add Deal Engine underwriting/read-only analysis.
7. Add Nexus enrichment/skip-trace behind appropriate authorization and source controls.
8. Prove one end-to-end read-only wholesale search through ZOLA.
9. Add controlled mutation capabilities for lead/deal state.
10. Add approval-gated outreach/offer/contract actions.
11. Integrate Harvester intake and any separately reviewed property-discovery capability into the same canonical property pipeline; keep Recon's government-contract/grant/vendor discovery separate.
12. Add Sentinel ecosystem oversight and alerts across the appropriate bounded divisions.
13. Expand to Social OS, Book Studio, and other Blackspire divisions using the same contract.
14. Perform the legacy `jarvis` → ZOLA runtime/UI identifier migration as its own bounded, reviewed change; preserve historical evidence and compatibility where needed.

## Runtime rename boundary

Until the dedicated migration is reviewed and deployed:

- Do not rename live API routes, database fields, service units, deployed URLs, historical task/evidence data, or security-sensitive identifiers merely for branding.
- Do not mix the ZOLA rebrand into active authentication, capability-security, or Gate 4 release fixes.
- New strategic documentation and future-facing product copy should use **ZOLA**.
- When a legacy `jarvis` identifier must be referenced for technical accuracy, describe it as a legacy/runtime identifier rather than treating Jarvis as the current product identity.

## Acceptance target for the first complete wholesale slice

ZOLA should be able to accept one natural-language acquisition objective and, without requiring the operator to manually open another Blackspire app:

- discover candidate properties through authorized Seller Engine sources, operator imports, Harvester, or a separately reviewed bounded property-discovery capability;
- rank motivated-seller opportunities;
- enrich owner/contact information where authorized;
- calculate ARV, repairs, MAO, and projected assignment spread;
- match likely buyers;
- return a ranked, source-backed shortlist;
- continue follow-up work in the same conversation;
- require approval before outreach, offers, contracts, or other external/mutating actions;
- preserve durable task/evidence history and no-replay safety.

This is the target definition of “ZOLA has complete operational control of the Blackspire real-estate stack”: complete orchestration through bounded capabilities, not unrestricted root/database access.
