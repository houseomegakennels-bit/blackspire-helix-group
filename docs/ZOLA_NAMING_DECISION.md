# ZOLA Naming Decision

## Canonical identity

**Z.O.L.A. — Zero-Trust Operations, Logic & Automation**

ZOLA is the official Blackspire AI/operator identity.

The former product working name **Jarvis** is retired for future-facing product, roadmap, design, and engineering language. New work should say **ZOLA** unless it must reference a legacy runtime identifier literally.

## Architecture names

- **ZOLA** — user-facing Blackspire intelligence and command experience.
- **Blackspire Command** — canonical control plane.
- **Hermes** — orchestration/runtime layer beneath ZOLA.
- **Sentinel, Recon, Harvester, Nexus, Seller Engine, Deal Engine, Buyer Engine, Social OS, Book Studio, and future divisions** — bounded capability providers coordinated through the control plane.

## Migration rule

This naming decision does not authorize a bulk runtime rename.

Existing `jarvis` paths, filenames, API fixtures, routes, service/deployment identifiers, persisted evidence, historical task records, and other technical identifiers remain unchanged until a dedicated reviewed migration proves compatibility and rollback safety.

Do not mix broad naming churn into authentication, authorization, capability-security, production-release, Gate 4, or incident-correction work.

When a legacy identifier must remain for technical accuracy, use it literally but treat **ZOLA** as the current product identity.

## Product language

Preferred examples:

- “Zola, inspect Blackspire and tell me what needs my attention.”
- “Zola, find the five best wholesale opportunities.”
- “Zola, check Sentinel.”
- “Zola, show me buyers for property #2.”

Preferred platform name: **ZOLA OS**.

Future UI concepts, roadmap documents, prompts, and user-facing branding should use ZOLA by default.