# Runtime boolean configuration

Blackspire accepts operational booleans only as the exact lowercase strings `true` and `false`.
Production startup refuses empty values, alternate case, numeric aliases, whitespace, and other
spellings rather than silently interpreting a typo as a safe setting.

The approved production profile requires `SECURE_COOKIES=true`, `DEBUG=false`, and
`RATE_LIMIT_DISABLED=false`. `TRUST_PROXY` and `GIT_WORKFLOW_ENABLED` must also be explicit
canonical booleans; their reviewed value depends on the deployment topology and git availability.
`UNIFIED_IPHONE_TEST_MODE`, when present, must be `false`. Optional `ALLOW_BEARER_AUTH` and
`BLACKSPIRE_RUN_MIGRATIONS` values must be canonical when configured; their existing independent
authorization and migration gates remain in force.

These checks do not activate bearer authentication, migrations, providers, Telegram transport,
production routing, memory promotion, or Gate 4.
