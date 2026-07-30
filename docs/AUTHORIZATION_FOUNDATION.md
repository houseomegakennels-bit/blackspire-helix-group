# Authorization foundation

This is a server-side, route-unintegrated foundation for Blackspire Command. It supports only configured `admin` and `service` principals. Verified human identities are deferred; an unbound session is never a human identity.

## Model and decisions

Principals carry lifecycle state and a monotonically positive security version. Resolution is an authentication boundary: the caller must select the exact canonical method, and a service principal must present the exact configured credential reference. It returns an immutable, credential-free summary, and only summaries created by the resolver can be authorized. Every authorization decision re-resolves the current persisted principal and rejects lifecycle, actor, authentication-method, security-version, or service credential-reference drift. Callers cannot inject an identity, role, permission, workspace claim, or credential-free service identity. Authorization is deny-by-default and writes sanitized allow/deny decision records; audit failure denies. Audit records a workspace only after an active grant validates it, never records arbitrary resource type/ID input, and uses server-owned permission and reason values.

Workspace is the current project boundary. Roles are `admin`, `operator`, `viewer`, and `service`; all permissions are the fixed, sorted, duplicate-free `AUTHZ_PERMISSIONS` set. There are no wildcard permissions. Admin/operator/viewer may receive their role matrix; service receives only explicitly listed permissions.

Grants are immutable, contiguous versions scoped to one principal and workspace. Authorization validates the entire persisted scope graph: it must have one root, one active terminal head, and exactly one same-scope successor at every nonterminal node. Missing parents, detached components, cycles, branches, cross-scope links, duplicate versions, backdated successors, mismatched supplied heads, and multiple active heads fail closed. Revoked/expired grants are unusable; a later correctly chained version is the explicit re-grant flow.

## Provisioning

`scripts/provision-authz.js --config <path> --validate-only|--dry-run` validates only. `--apply` additionally requires `--database <absolute-path>` to an existing, regular, already-migrated disposable development/test SQLite database. It rejects production mode, relative paths, symlinks, directories, and shared/staging/production path components. It validates the whole bounded config and authorization schema before a single `BEGIN IMMEDIATE` transaction inserts exact configured rows. Exact repeats are idempotent; immutable conflicts and failures roll back. Output contains only IDs, counts, the database basename, and reason codes.

No startup invokes provisioning, no public endpoint exists, no automatic principal/grant or identity backfill exists, and no real database has been provisioned. Migration rollback remains the existing reviewed SQLite backup/restore procedure; this CLI never migrates.

## Compatibility and limitations

PR #57 narrowly integrates the foundation with the evaluation-read API only. A cookie session is authority only after server-side login binds it to the configured canonical admin principal; session identifiers, CSRF tokens, lifecycle epochs, revocation state, principal binding, and the global revocation cutoff must all be canonical, and rotation never extends the original expiry. Malformed persisted sessions fail closed for reads, rotation, and active-session listing. This is not a verified human-identity system and does not generalize protection to other routes. No automatic authorization or real provisioning exists. No production, Gate 4, routing, memory, or live-provider behavior changed.
