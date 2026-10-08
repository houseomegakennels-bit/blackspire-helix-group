# Real-estate research data plan
Review date: 2026-10-08. Source review only; no provider requests, paid searches or production data changes.

## What exists in this checkout
- `frontend/src/lib/property-server.ts` reads the existing properties/owners/seller_leads records and aggregates linked deal, buyer matching and event sources. The property view does not load sold comparisons, recorded loans, lien search results or payoff statements.
- `frontend/src/lib/buyer-engine-server.ts` contains county-specific parcel/transfer adapters and an NC OneMap fallback; `buyer-engine-data.ts` describes individual county field coverage. Some feeds supply sale dates/prices, parcel IDs and deed references. Other feeds lack sale price or use month-level dates. Their purpose is buyer activity sourcing, not a complete comparable-sales or title search.
- Forsyth registry notes describe SalesApp transfers joined to NCPTS Cloud parcel ownership by PIN, inferred property type, and disabled cash-buyer scoring. These are checkout claims, not fresh live-source verification.
- `frontend/src/lib/seller-engine-server.ts` retains imported property data-source name/type/integration/source URL through the data_sources relation. This is useful provenance to reuse; the property aggregator currently omits it.
- `frontend/src/lib/deal-engine-server.ts` uses comps_placeholder arrays in existing packet/data-room storage. These are manually supplied text items, not a verified automated comparable-sales integration. New deal mortgage status starts as Unknown.
- `frontend/src/lib/nexus-server.ts` handles contact enrichment. A phone/email skip trace is not loan, lien or funding verification.
- The searched real-estate libraries do not establish an implemented ATTOM/RentCast/Regrid-style sold-comp/loan/lien provider. Do not infer coverage from brand names, configuration labels, database presence or other project integrations.

## Build order
1. Reuse the canonical property ID and existing deal/document/note owners. Do not add a duplicate property pipeline.
2. Surface existing source name/URL, source observation date, date retrieved and whether a value is reported, estimated or independently checked. Missing dates must remain Unknown.
3. Start with operator-entered research references in existing deal documents/notes. The property page now explicitly labels comparisons Not loaded, payoff Not verified and title Not checked.
4. Normalize eligible county transfer records as research candidates only after checking source coverage and property identity. Keep original sale price/date, assessment value and inferred value in separate fields. Reject missing price from any price-based comparable calculation.
5. Add comparisons selection/review with distance, sale date, living area, beds/baths, property type, condition and known adjustments. Display missing dimensions; do not infer renovated condition from a parcel transfer.
6. Evaluate any paid provider only with a written coverage/cost/license review and explicit authorization before account setup or paid calls. Costs, current API availability, redistribution rights and production access are UNVERIFIED in this review.
7. Loan documents may show recorded principal and lender, not a current payoff. Record current payoff separately with statement date and expiration.
8. Lien findings need source jurisdiction, search scope, searched identity/parcel, search time and reviewer. No result is not clear title. Final title status should follow existing transaction evidence, not a property score.

## Acceptance
- Unknown data is distinct from zero, no records, fetch failure and verified absence.
- Each displayed research value links to its source and dates; estimates have an explained method.
- Source failure never appears as zero buyer activity or no liens.
- Buyer activity/matching does not assert independent funds, consent, current interest or a commitment.
- No external data lookup, contact, offer, document signing or paid search runs from opening a research section.
- Property navigation remains usable in any order and preserves canonical links.
- Automated coverage is tested county by county with redacted fixtures before it is presented as reliable.
- Live source availability and full production/browser acceptance remain UNVERIFIED.
