# Unified Jarvis Test Build Teardown

## Automatic

The launcher expires after two hours or the configured shorter TTL. On expiry or `SIGINT`/`SIGTERM`, it stops the worker, closes the API listener, closes SQLite, and removes the temporary database, WAL/SHM files, attachments directory, and ephemeral test-session state.

## Operator-completion teardown

1. Stop the Codespace launcher after Safari acceptance.
2. Confirm the launcher reports `cleaned: true` without exposing its temporary path.
3. Verify the loopback health route no longer responds.
4. Delete the disposable Codespace.
5. Confirm the private forwarded URL is inactive.
6. Confirm no Codespace secret, persistent environment value, production data, Telegram connection, paid API resource, pushed branch, PR, or deployment remains.

If the agent connection is interrupted, the application still expires locally. Delete the Codespace from GitHub Codespaces to end storage retention immediately.
