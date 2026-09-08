# Pearson Janitorial — Triad Branch

## Current architecture
Pearson Triad is a Blackspire-native business branch. It must remain fully operational without Zola Control until Zola production is explicitly approved for integration.

## Rebrandability rule
All public identity (business name, division name, tagline, colors, geography, contact labels, logo references) must be centralized in a brand/config layer. Domain objects and workflows must use neutral names such as prospect, opportunity, fulfillment_partner, quote, proposal, contract, mobilization, service_visit, qc_review, invoice, and approval.

## Initial command surface
- Executive dashboard
- Contract/prospect pipeline
- Fulfillment partner pipeline
- Pricing + bid/no-bid calculator
- 45-day launch tracker
- Human approval queue
- Sales-kit templates

## Operating constraint
Los is never assumed to perform cleaning or emergency fill-in labor. Fulfillment requires a primary provider, backup coverage, and paid/contracted quality control.

## Zola gate
Document adapters/events now, but add no Zola runtime dependency until Zola production is complete and owner integration approval is explicit.
