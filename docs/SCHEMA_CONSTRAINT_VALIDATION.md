# Schema Constraint Validation

Status: implemented in a stacked draft branch; not independently reviewed or merged.

## Contract

`findMissingSchemaObjects` is the shared read-only compatibility gate used by application startup,
restore validation before and after copy, and migration post-validation. It now also verifies the
exact normalized multiset of every security- and integrity-bearing CHECK expression in authorization
and Hermes Milestones 3A through 3C.

The comparison is syntax-aware: a balanced scanner respects nested parentheses and quoted SQLite
tokens, then normalization removes insignificant whitespace and case differences outside quoted
values. It does not use substring matching. Removing a constraint, widening an enum, changing
`>0` to `>=0`, adding `promote`, or weakening a chain-shape expression therefore fails closed.

The inventory covers 52 CHECK expressions across ten tables. It does not claim to validate every
`NOT NULL`, primary-key, foreign-key, or legacy-table constraint; those remain separate hardening.

## Failure behavior

- Startup reports `database schema migration required: invalid table constraints <table>`.
- Restore refuses before publishing a target, even for a SQLite-integrity-ok backup with a freshly
  matching checksum sidecar.
- Migration refuses its postcondition because `CREATE TABLE IF NOT EXISTS` cannot heal an existing
  weakened table. Recovery requires a reviewed backup or separately reviewed table-rebuild migration.

## Rollback

Code rollback removes the validator and tests only; it mutates no database. Reverting would reopen
the acceptance gap and must not be represented as a data rollback.
