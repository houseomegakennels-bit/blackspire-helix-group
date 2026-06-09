# Approved Contract Templates

Place attorney-approved reusable contract templates in this folder.

Recommended workflow:
- store the reviewed template file
- update its registry record in `src/lib/contract-template-registry.ts`
- move the template from `reference_only` or `attorney_review_required` to `attorney_approved`
- keep version notes and attorney approval metadata in Supabase

Integrated approved source files:
- `source-pdfs/owner-provided-purchase-agreement.pdf`
- `source-pdfs/owner-provided-assignment-agreement.pdf`

Generator-ready approved templates:
- `owner-provided-purchase-agreement.md`
- `owner-provided-assignment-agreement.md`
