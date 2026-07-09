#!/usr/bin/env python3
"""Personal, opt-in Telegram bridge for remote-controlled Aider, with a
confirm-before-apply gate.

NOT wired into scripts/bootstrap-codespace.sh or any shared bashrc alias -
this is a standalone, manually-started tool:

    python3 scripts/telegram-aider-bridge.py

SECURITY MODEL (two layers - read the second one carefully, it has a real
limitation):
1. Allowlist - this only ever responds to TELEGRAM_ALLOWED_USER_ID. Every
   other sender is silently ignored. That check - not keeping
   TELEGRAM_BOT_TOKEN secret - is the real access boundary, since a bot
   token can leak independent of how carefully the repo is handled.
2. Confirm-before-COMMIT, not confirm-before-EXECUTE. Aider runs with
   --yes-always (required - otherwise it hangs waiting on its own
   interactive prompts, which doesn't work headless over Telegram). That
   means Aider actually EDITS FILES AND RUNS SHELL COMMANDS the moment a
   message arrives - before you ever see a diff. --no-auto-commits only
   controls what happens next: the bridge shows you the resulting diff and
   waits for "yes" to `git commit` it or "no" to `git checkout`/`git clean`
   it away. That undoes the *working tree* and *git history*, but it
   cannot undo anything Aider's shell commands already did outside git's
   reach (a network call, a file written outside the repo, etc).
   This script does not implement pre-execution review. If you want to see
   a plan before anything runs, get that from Aider itself: send a message
   Aider will treat as its own `/ask`-mode question (a question rather than
   an instruction to change something), review its answer in the Telegram
   back-and-forth, then send a separate follow-up message telling it to
   actually make the change. That manual discipline - not this script - is
   the pre-execution safeguard.

Both TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID must come from the
environment (set them as Codespaces secrets - see CODESPACES_SECRETS.md).
Neither is ever hardcoded here.
"""
import logging
import os
import subprocess
import sys
from pathlib import Path

try:
    from telegram import Update
    from telegram.ext import Application, ContextTypes, MessageHandler, filters
except ImportError:
    print("Missing dependency. Install with: pip3 install --user python-telegram-bot", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
LOG_FILE = REPO_ROOT / ".telegram-bridge.log"
MAX_TELEGRAM_MESSAGE = 4000  # stay under Telegram's 4096-character hard cap
AIDER_TIMEOUT_SECONDS = 600

YES_WORDS = {"yes", "y", "confirm", "apply"}
NO_WORDS = {"no", "n", "cancel", "revert", "discard"}

logging.basicConfig(
    filename=str(LOG_FILE),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("telegram-aider-bridge")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
_allowed_user_raw = os.environ.get("TELEGRAM_ALLOWED_USER_ID")

if not BOT_TOKEN:
    print("TELEGRAM_BOT_TOKEN is not set. Add it as a Codespaces secret first.", file=sys.stderr)
    sys.exit(1)
if not _allowed_user_raw:
    print(
        "TELEGRAM_ALLOWED_USER_ID is not set. This is mandatory - the bridge "
        "refuses to run without an allowlisted user ID (this is the real "
        "security boundary, see module docstring).",
        file=sys.stderr,
    )
    sys.exit(1)

ALLOWED_USER_ID = int(_allowed_user_raw)

# One conversation at a time: "idle" -> "processing" (Aider is running) ->
# "awaiting_confirmation" (diff sent, waiting for yes/no) -> back to "idle".
_state = "idle"


def _chunk(text: str, size: int = MAX_TELEGRAM_MESSAGE):
    if not text:
        yield "(no output)"
        return
    for i in range(0, len(text), size):
        yield text[i : i + size]


def _run(args: list[str]) -> str:
    result = subprocess.run(args, cwd=str(REPO_ROOT), capture_output=True, text=True)
    return (result.stdout or "") + (result.stderr or "")


def _git_status_paths() -> set[str]:
    out = _run(["git", "status", "--porcelain"])
    paths = set()
    for line in out.splitlines():
        if len(line) > 3:
            paths.add(line[3:].strip())
    return paths


async def _send_chunks(update: Update, text: str, label: str = "") -> None:
    chunks = list(_chunk(text.strip() or "(no output)"))
    total = len(chunks)
    for i, part in enumerate(chunks[:10], start=1):
        prefix = f"{label} [{i}/{total}] " if total > 1 else f"{label} "
        await update.message.reply_text(f"{prefix}{part}")
    if total > 10:
        await update.message.reply_text(
            f"Output truncated ({total - 10} more chunk(s)) - see {LOG_FILE} "
            "or the Codespace terminal for the full log."
        )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    global _state

    sender_id = update.effective_user.id if update.effective_user else None
    message_text = (update.message.text or "").strip() if update.message else ""

    if sender_id != ALLOWED_USER_ID:
        logger.warning("Ignored message from unauthorized user_id=%s", sender_id)
        return  # Silently ignore. No reply, no acknowledgement of any kind.

    if not message_text:
        return

    logger.info("Received from allowed user (state=%s): %s", _state, message_text)

    if _state == "awaiting_confirmation":
        reply = message_text.lower()
        if reply in YES_WORDS:
            _run(["git", "add", "-A"])
            commit_msg = f"Applied via Telegram bridge: {message_text[:72]}"
            _run(["git", "commit", "-m", commit_msg])
            logger.info("Committed pending change: %s", commit_msg)
            await update.message.reply_text("Committed.")
            _state = "idle"
        elif reply in NO_WORDS:
            _run(["git", "checkout", "--", "."])
            new_paths = _git_status_paths()
            for path in new_paths:
                _run(["git", "clean", "-fd", "--", path])
            logger.info("Discarded pending change (%d new path(s) cleaned)", len(new_paths))
            await update.message.reply_text("Discarded. Nothing was committed.")
            _state = "idle"
        else:
            await update.message.reply_text('Reply "yes" to apply or "no" to discard the pending change.')
        return

    if _state == "processing":
        await update.message.reply_text("Still processing the previous message - please wait.")
        return

    _state = "processing"
    try:
        await update.message.reply_text("Running in Aider (nothing is committed until you confirm)...")
        before_paths = _git_status_paths()
        result = subprocess.run(
            ["aider", "--yes-always", "--no-auto-commits", "--message", message_text],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=AIDER_TIMEOUT_SECONDS,
        )
        aider_output = (result.stdout or "") + (("\n" + result.stderr) if result.stderr else "")
        logger.info("Aider exit=%s output_len=%d", result.returncode, len(aider_output))

        after_paths = _git_status_paths()
        if after_paths == before_paths and not after_paths:
            await _send_chunks(update, aider_output, label="[aider]")
            await update.message.reply_text("No file changes were made.")
            _state = "idle"
            return

        diff = _run(["git", "diff", "HEAD"])
        new_files = sorted(after_paths - before_paths)
        summary = diff if diff.strip() else "(no tracked-file diff)"
        if new_files:
            summary += "\n\nNew untracked path(s):\n" + "\n".join(f"  {p}" for p in new_files)

        await _send_chunks(update, summary, label="[diff]")
        await update.message.reply_text('Reply "yes" to commit this change, or "no" to discard it.')
        _state = "awaiting_confirmation"
    except subprocess.TimeoutExpired:
        logger.error("Aider invocation timed out")
        await update.message.reply_text(f"Aider timed out after {AIDER_TIMEOUT_SECONDS}s.")
        _state = "idle"
    except Exception as exc:  # noqa: BLE001 - always report the failure back to the user
        logger.exception("Aider invocation failed")
        await update.message.reply_text(f"Error running Aider: {exc}")
        _state = "idle"


def main() -> None:
    print(f"Starting Telegram-Aider bridge. Logging to {LOG_FILE}")
    print(f"Only Telegram user_id={ALLOWED_USER_ID} will be able to send commands.")
    print("Every change requires an explicit yes/no reply before it's committed.")
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.run_polling()


if __name__ == "__main__":
    main()
