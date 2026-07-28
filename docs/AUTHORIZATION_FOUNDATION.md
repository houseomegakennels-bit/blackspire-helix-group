# Authorization foundation

This is a server-side, route-unintegrated foundation for Blackspire Command. It supports only configured `admin` and `service` principals. Verified human identities are deferred; an unbound session is never a human identity.

## Model and decisions

Principals carry lifecycle state and a monotonically positive security version. Resolution returns an immutable, credential-free summary, and only summaries created by the resolver can be authorized. Callers cannot inject an identity, role, permission, or workspace claim. Authorization is deny-by-default and writes sanitized allow/deny decision records; audit failure denies.

Workspace is the current project boundary. Roles are `admin`, `operator`, `viewer`, and `service`; all permissions are the fixed, sorted, duplicate-free `AUTHZ_PERMISSIONS` set. There are no wildcard permissions. Admin/operator/viewer may receive their role matrix; service receives only explicitly listed permissions.

Grants are immutable versions scoped to one principal and workspace. A superseding version must reference an older grant in the same scope; missing parents, cycles, cross-scope links, duplicate versions, and multiple active heads fail closed. Revoked/expired grants are unusable; a later correctly chained version is the explicit re-grant flow.

## Provisioning

`scripts/provision-authz.js --config <path> --validate-only|--dry-run` validates only. `--apply` additionally requires `--database <absolute-path>` to an existing, regular, already-migrated disposable development/test SQLite database. It rejects production mode, relative paths, symlinks, directories, and shared/staging/production path components. It validates the whole bounded config and authorization schema before a single `BEGIN IMMEDIATE` transaction inserts exact configured rows. Exact repeats are idempotent; immutable conflicts and failures roll back. Output contains only IDs, counts, the database basename, and reason codes.

No startup invokes provisioning, no public endpoint exists, no automatic principal/grant or identity backfill exists, and no real database has been provisioned. Migration rollback remains the existing reviewed SQLite backup/restore procedure; this CLI never migrates.

## Compatibility and limitations

No HTTP route is protected in this pass. No evaluation-read API exists. No human identity, session binding, or automatic authorization exists. PR #57 remains draft and blocked until this foundation merges. No production, Gate 4, routing, memory, or live-provider behavior changed.
