# Telegram Bridge Setup — Runbook

This file is a runbook for getting the personal **Telegram → Aider bridge**
live in this Codespace. It's written so the Codespace's built-in AI assistant
(GitHub Copilot Chat) can carry it out for you — you don't have to type the
commands yourself.

## Easiest path (delegate to the Codespace AI)

Open Copilot Chat in this Codespace and send it one message:

> Read `TELEGRAM_BRIDGE_SETUP.md` and follow it to start the Telegram bridge.
> Run the commands for me and tell me the result.

That's it. The rest of this file tells the assistant exactly what to do.

## What "done" looks like

The bridge is live when `scripts/start-telegram-bridge.sh` prints an
`It's LIVE.` line followed by these three startup lines:

```
Starting Telegram-Aider bridge. Logging to .../.telegram-bridge.log
Only Telegram user_id=<number> will be able to send commands.
Every change requires an explicit yes/no reply before it's committed.
```

Then you message your Telegram bot to use it.

---

## Instructions for the AI assistant (run these in order)

**1. Make sure the repo is on the latest `main`** (the bridge and its launcher
live there):

```bash
git checkout main && git pull origin main
```

**2. Run the launcher.** It installs the one dependency if needed, checks the
secrets, and starts the bridge in the background:

```bash
bash scripts/start-telegram-bridge.sh
```

**3. Interpret the output and report back to the user:**

- If it prints **`It's LIVE.`** — success. Tell the user the bridge is running
  and they can now message their Telegram bot. Also tell them it can be stopped
  with `pkill -f telegram-aider-bridge.py`.

- If it prints **`MISSING SECRET: TELEGRAM_BOT_TOKEN`** and/or
  **`MISSING SECRET: TELEGRAM_ALLOWED_USER_ID`** — the secrets aren't in this
  Codespace's environment. Tell the user to add the missing one(s) under
  **GitHub → Settings → Codespaces → Secrets**, grant this repository access,
  then **rebuild the Codespace** (Command Palette → "Codespaces: Rebuild
  Container") and run step 2 again. Do not put the secret values in any file.

- If it prints **`did not stay running`** with a log tail — report the log
  lines to the user verbatim so they can be diagnosed.

## Important notes

- **Never write the bot token or user ID into a file or commit them.** They
  live only as Codespaces secrets. This runbook and the launcher only read them
  from the environment.
- **Test the allowlist before trusting it:** have someone message the bot from
  a *different* Telegram account and confirm they get no reply (check
  `.telegram-bridge.log` for an "Ignored message from unauthorized user_id"
  line), before relying on it.
- The bridge is a background process. It survives closing the terminal, but a
  Codespace auto-stops after an idle timeout, which stops it too — re-run
  step 2 after the Codespace restarts.
- Security model details are in the docstring at the top of
  `scripts/telegram-aider-bridge.py` — notably that its confirm step gates
  git commits, not Aider's immediate execution.
