# VPS Runtime Runbook

## Durable runtime

The existing supervised VPS service and port 8787 are outside the disposable-test lifecycle. Confirm its health with its established operator tooling before and after a test; never point a test launcher at its data path or port.

For a separately approved production start, install the supported Node runtime, perform deterministic installation, inject production configuration through the approved external mechanism, then run:

```sh
npm ci --ignore-scripts
bash scripts/verify-environment.sh vps-production
npm run start:production
```

The production profile requires `NODE_ENV=production`, state owner `vps-production`, persistent non-`/tmp` storage, authentication configuration, and a non-mock provider. It rejects test mode and mock Telegram. Process supervision, restart policy, backups, monitoring, and a stable HTTPS endpoint remain go-live prerequisites.

## Temporary iPhone test

Use only the disposable launcher on port 8790:

```sh
npm run start:iphone-test -- quick-tunnel
```

It generates one-time test authentication, creates isolated SQLite state, forces mock Hermes/Telegram, strips inherited provider/GitHub credentials from the child, expires automatically, and uses a pinned Cloudflare client image. The Quick Tunnel URL is temporary and must not be represented as a deployment.

Stop it with:

```sh
npm run stop:iphone-test
```

Interruption and expiry invoke cleanup. Verify the temporary health URL is unavailable and the durable port 8787 remains healthy. Never copy VPS production state into the temporary runtime.
