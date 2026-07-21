# Reverse proxy + TLS plan (blocker #1) — REVIEW ONLY, NOT INSTALLED

This directory holds a reviewed plan and template for terminating TLS in front of Blackspire
Command. **Nothing here is installed, enabled, or applied by any repository change.** Applying
it requires separate blocker #1 approval and is an operator action on the host.

## Verified current host state (read-only, 2026-07-21)

- **No reverse proxy installed:** `nginx`, `caddy`, `apache2`, `httpd`, `haproxy`, `traefik`
  are all absent.
- **No TLS tooling / certificates:** `certbot` is not installed and `/etc/letsencrypt` does
  not exist.
- **No public listeners:** nothing listens on ports 80 or 443. The only application listener
  is `0.0.0.0:8787` via `docker-proxy` (plain HTTP). SSH (22) and systemd-resolved (53) are
  the only other listeners.
- **App-side TLS:** none. `apps/api/server.js` uses `http.createServer`; TLS must terminate
  at the proxy.

## Decisions

| Item | Decision |
|---|---|
| Proxy software | **nginx** (explicit, auditable config; Caddy is an acceptable alternative if the operator prefers automatic HTTPS, but the reviewed template is nginx). |
| Private application port | **8787**, bound on loopback for the durable runtime (`127.0.0.1:8787`). |
| Approved public hostname | **UNVERIFIED — not recorded in the repo.** Operator must supply it; the template uses `command.EXAMPLE-APPROVED-HOST.invalid` as a placeholder. Do not invent one. |
| HTTPS-only policy | Port 80 returns `301` to `https://$host$request_uri` (except the ACME challenge path). |
| HSTS | Set by the **application** in production (`max-age=31536000; includeSubDomains`). The proxy does **not** duplicate it. |
| Forwarded headers | `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto=https`, `X-Forwarded-Host`. Requires the production profile to set `TRUST_PROXY=true` and `SESSION_COOKIE_SECURE=true`. |
| WebSocket / streaming | **Not required** — no WebSocket or SSE in the app (grep-verified). Plain HTTP/1.1 reverse proxy with upstream keepalive. |
| Health route | `/health` proxied and public (no auth); also scraped internally by `ops/blackspire-command-healthcheck.sh` directly on `127.0.0.1:8787`. |
| Jarvis route | `/` and `/jarvis` serve the PWA shell; `/sw.js` + `/manifest.webmanifest` proxied unchanged. Service-worker registration requires the HTTPS origin this proxy provides. |
| Strict CSP preservation | The proxy adds **no** `add_header` and hides no headers, so the app's `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:` passes through byte-for-byte. |

## Certificate issuance and automatic renewal

1. Install nginx and certbot (operator, blocker #1).
2. Place the reviewed server block for the **approved hostname**, then `nginx -t` and reload.
3. Issue the certificate with the nginx plugin (DNS for the hostname must already resolve to
   this host — a DNS prerequisite, not changed here):
   ```sh
   certbot --nginx -d command.<approved-host> --redirect --agree-tos -m <ops-email> --non-interactive
   ```
   (Or webroot mode using `/var/www/certbot` if the operator prefers not to let certbot edit
   nginx.)
4. **Auto-renewal:** certbot installs `certbot.timer` (systemd), which runs `certbot renew`
   twice daily and reloads nginx on success. Verify with `systemctl status certbot.timer` and
   a dry run: `certbot renew --dry-run`.

## Rollback

- Keep the previous nginx site config; `nginx -t` must pass before any `reload`. To roll back,
  restore the prior config (or `unlink` the site from `sites-enabled`) and reload.
- TLS termination is stateless: disabling the proxy returns the host to its current state
  (app reachable only on 8787). No application data is involved.
- Certificates persist under `/etc/letsencrypt`; rolling back the proxy does not revoke them.

## Explicitly NOT done here

No proxy installed, no config placed or enabled, no certificate requested or installed, no
port bound, no DNS change, no systemd/timer change, no service restart.
