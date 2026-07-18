# Wave 1 Public Health Endpoint Plan

## Decision

Implement `https://blackspirehelix.com/health` as a Next.js App Router route handler in the existing `frontend/` Vercel application.

## Deployment evidence

- `frontend/package.json` identifies Next.js `16.2.6` with the App Router source under `frontend/src/app/`.
- `frontend/README.md` records the production Vercel project and live frontend deployment.
- The public domain is operator-confirmed as `blackspirehelix.com`.
- The separate host-level Blackspire Command Docker API is not the public-domain deployment and must not be exposed or proxied for this check.

## Options considered

1. **Static public file:** rejected. A constant file proves CDN/object delivery but is less explicit about the application route contract and content type.
2. **Web app route handler:** selected. It uses the existing public Next.js/Vercel deployment, requires no credentials or dependencies, and returns an exact constant response.
3. **API route under `/api`:** rejected because the required URL is `/health`, not `/api/health`; it provides no additional safety.
4. **Reverse-proxy route:** rejected. The public app is already on Vercel, while proxy changes would add deployment coupling and risk exposing the host-level Command API.
5. **Host/Docker route:** rejected. It would require port/routing work and could confuse public liveness with privileged control-plane health.

## Implementation

- `frontend/src/app/health/route.js` exposes GET only and delegates to a constant response factory.
- `frontend/src/lib/public-health.mjs` returns HTTP 200, JSON content type, `Cache-Control: no-store`, and exactly:

```json
{"ok":true,"service":"blackspire-public","status":"up"}
```

- No request, cookie, header, query, environment variable, external fetch, database, log, task, Git, filesystem, host, admin, debug, or control-plane state is read.
- Unsupported methods are left to the framework's standard Route Handler behavior; no privileged action exists.

Next.js documents Route Handlers as `route.js|ts` files inside `app` using the Web Request and Response APIs: <https://nextjs.org/docs/app/api-reference/file-conventions/route>.

## Verification and release gates

1. Run the isolated Node contract tests.
2. Run frontend lint and production build when dependencies are available in an approved environment. This workspace has no `frontend/node_modules`, and dependency installation is outside scope.
3. Review the health-only diff and secret scan.
4. Commit locally; do not push or deploy.
5. After explicit push approval, open a PR from the clean health task branch.
6. Verify the Vercel preview `/health` returns status 200, JSON content type, and the exact body.
7. After explicit merge/deployment approval, merge through the normal protected workflow and verify `https://blackspirehelix.com/health` again.

## Rollback

Revert the health endpoint commit and let Vercel deploy the prior application version. No host, port, DNS, Docker, credential, or security rollback is required.
## Deployment trigger

- 2026-07-18: GitHub-to-Vercel initial production deployment triggered after connecting the `frontend` project to `main` with Root Directory `frontend`.
