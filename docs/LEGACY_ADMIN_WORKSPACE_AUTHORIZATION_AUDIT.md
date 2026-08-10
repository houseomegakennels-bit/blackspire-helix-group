# Legacy administrator workspace-authorization audit

## Result

The legacy HTTP administrator surface authenticates one global administrator token or its bound
browser session, but most task, conversation, workspace, approval, cancellation, and evidence routes
do not enforce the canonical per-workspace grants in `packages/shared/authorization.js`.

`npm run audit:legacy-admin-authz` records the affected route inventory and fails if a tracked route
changes without updating the audit. Its report deliberately sets both controlled-staging and safe-
production readiness to `false`. Authentication, CSRF protection, request policy, and test-mode
workspace restrictions are real controls, but none substitutes for a canonical workspace grant.

## Affected surfaces

- workspace listing;
- task listing and creation;
- unified-input task creation;
- conversation and conversation-event reads;
- task reads, logs, approvals, approval decisions, pause, resume, and cancellation;
- task evidence export.

The Hermes evaluation, scorecard, memory-review, and re-review read routes are not included: they
already bind a server-selected canonical principal and authorize against the persisted object's
workspace without accepting a caller-nominated principal.

## Safe remediation boundary

A runtime repair must bind every accepted bearer/session request to one server-selected canonical
principal, authorize the persisted resource workspace before returning existence-sensitive data,
filter list responses to authorized workspaces, and require the appropriate `task.read`,
`task.create`, `task.execute`, `approval.grant`, or `runtime.read` permission. It must also preserve
the disposable test-mode boundary and durable authorization audits.

That migration requires coordinated route, session, provisioning, and operator configuration work.
This package does not guess those decisions, widen grants, add schema, or change runtime behavior.
Until that migration is implemented and independently reviewed, the legacy administrator surface is
not safe-production ready.
