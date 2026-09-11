# Security

## Non-negotiable controls
- No live broker credentials in GitHub, Codex prompts, logs, Telegram, or documentation.
- No production Supabase service-role key, webhook secret, Telegram bot token, SMS provider secret, or prop-firm credential in the development plane.
- Separate local/test, mock, broker-demo, prop-evaluation, and live environments.
- Live order submission must require explicit environment lockouts and human-reviewed enablement.
- Unknown execution state fails closed.
- Broker state must be re-read after order actions.
- Protective order coverage must be verified by quantity, not merely by existence.
- `/flat` must remain halted after flattening.
- `/resume` must pass readiness checks.

## Zola boundary
Zola receives sanitized state and authenticated control APIs only. Zola must never receive broker passwords/tokens, service-role secrets, webhook secrets, or direct live-order authority. Zola actions such as halt, resume, flatten, configuration changes, or deployment approvals must be routed through Helix policy checks and audited.
