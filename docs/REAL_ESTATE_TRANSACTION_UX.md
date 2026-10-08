# Real estate transaction and buyer-search usability

## 2026-10-08 — isolated changes, not deployed

- Transaction forms now keep visible labels, currency units and date-format guidance. Purchase deposit replaces unexplained EMD in the primary navigation and form copy. Zero amounts remain visible rather than disappearing from the fields.
- Proposed terms, saved drafts, operator-recorded sends and recorded signatures are explained separately. Manual signature status changes ask the operator to confirm actual packet evidence. Both prepare buttons use the existing template/disclaimer/required-field guard; no template approval rules were relaxed.
- A closing summary no longer claims the transaction is safe or ready based on an absent payout warning.
- Buyer-search controls have visible labels, units, numeric input types and help. Results are potential matches, not committed independently funded buyers. Historical activity is explicitly not evidence of current funding.
- Screening budget is compared by the existing backend with estimated purchase ceiling, not seller asking price. This limitation is visible. Bedroom and radius criteria are currently recorded without ranking enforcement; the form says so. Seller-lead value estimates are assessed-value/equity-derived rather than sold comps.
- Existing API endpoints, deal IDs, metadata owners and provider controls remain unchanged. No messages, signature packets, contracts or production records were sent or modified by this work.

## Validation and limitations

Focused ESLint is run on both modified components under Node 22.23.1. Parent integration owns full lint/build/type checks and canonical-memory updates.
Browser/mobile acceptance and production behavior remain UNVERIFIED. Assignment prices and closing costs now distinguish absent values from confirmed zero through the existing nullable storage fields. The assignment UI keeps unknown inputs blank, labels saved results, sends only operator-entered amounts, and preserves signed losses. Purchase-deposit storage still uses its existing numeric contract; it is outside this nullable-assignment change.


## 2026-10-08 — current-main completion evidence

Actual practice and operator components passed Chromium checks at desktop and phone widths with fictional in-memory adapters. Zero costs, unknown amounts, signed losses, strategy switching and reload persistence passed; practice drafts also survived navigation, failed saves and revision conflicts. The existing admin guards, observed read-only data clients and Buyer dispatch authority were preserved. Full lint/build and all 98 focused behavioral/access tests pass. Production authentication/database acceptance, live research-provider data and exact-commit external review/CI remain UNVERIFIED. This evidence supersedes the earlier browser/mobile UNVERIFIED checkpoint for these locally tested flows only.
