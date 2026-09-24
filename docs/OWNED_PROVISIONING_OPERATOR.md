# Owned provisioning operator repair

This separately reviewed operator checkout supplements the sealed 2636a1e release; it does not change that artifact or the canonical installer bytes. Resume uses the existing protected FAILED provisioning record and `--reconcile`, through the fixed operator entrypoint.

The bounded owned manager cannot ALTER NOSUPERUSER. Only three fixed named-role DDL blocks omit that token, under the existing advisory lock and before/after NOSUPERUSER catalog checks. PUBLIC receives CONNECT only on the isolated owned postgres database; CREATE and TEMP remain denied. The fixed TLS/HBA and login-role restrictions remain in force.

The owned catalog policy preserves and verifies all seven actual membership rows, including the exact cluster-admin OID10 grant to the postgres manager for admission_login with ADMIN true and INHERIT/SET false. The ordinary six-edge policy remains unchanged. Catalog observation temporarily SET ROLEs to the existing writer owner, restores postgres, and checks both session and current identity. The provider stage uses the same explicit owned policy and retains the raw catalog digest.

On recovery with an existing admission login, every writer login is disabled first. A distinct full-layout observation returns compliant false and OWNED_LAYOUT_LOGIN_DISABLED; only this exact intact layout skips reinstalling the immutable installer. Damaged or partial layouts reject before password binding. Final active-policy verification and native authentication still gate success.

Validation: isolated PostgreSQL full-order source freeze/copy/hardening/provision/repository fixture, actual SCRAM authentication and wrong-password denials for all three writer logins, template1 identity checks, rollback and same-credential reconciliation, seven-edge rejection cases, real provider observation, and damaged routine ACL refusal before password binding. No production mutation was performed by these implementation/tests.

## Owned configuration installation

The fixed operator entry also selects an explicit owned configuration preparation CLI. It validates the protected root0600 owned descriptor, creator OID, TLS target and profile digest, retaining complete profile and source snapshots across asynchronous health/artifact checks. Strict four-service quiescence is checked before planning and publication. The native connection health check, no-replace file publication, and two-event configuration journal remain unchanged. The original Supabase preparation entry retains its pinned target checks. The actual failed native attempt had no configuration journal or fixed service drop-in, so this repair introduces no replacement or history reset.

## Runtime store manifest publication

After deployment, runtime store manifest publication must inspect the deployed artifact. The fixed operator store factory supplies that inspector to both outer transition receipt creation and inner retained manifest publication, preserving current-pointer, generation, protected configuration and journal checks. Candidate preparation still uses its sealed-artifact check. The same factory is wired into candidate HELD establishment and the postmerge VPS host; the latter keeps the fixed canonical release-worktree path and native VPS methods. No services are restarted by this repair itself.
