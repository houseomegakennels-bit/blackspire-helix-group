# Codespace Recovery Runbook

Codespaces are a portable development/recovery surface, not a production dependency. The devcontainer uses Node 22, installs deterministically, does not import production credentials, ignores all automatic ports except private metadata for disposable port 8790, and selects no paid provider.

After included usage renews, inspect and resume the existing operator-designated Codespace without creating another:

```sh
/root/.config/blackspire/gh-blackspire codespace ssh -c vigilant-spork-4q759jvvrwx9c744 -- 'cd /workspaces/blackspire-helix-group && git status --short --branch && git rev-parse HEAD && node --version && npm --version'
```

The current local readiness commit will not exist in GitHub until a separate push is approved. Once canonical reviewed code is available, fetch it without merging main, inspect status/commit, and run:

```sh
npm run bootstrap:development -- codespace
npm run codespace:ready
npm run start:iphone-test -- codespace
```

Use disposable SQLite only. Do not copy VPS state, add production secrets, enable billing, expose another port, or enable real providers/Telegram. Stop with `npm run stop:iphone-test`; stopping/deleting the Codespace must not affect canonical VPS state.
