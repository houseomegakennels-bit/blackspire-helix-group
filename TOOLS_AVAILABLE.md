# Tools Available (Documented, Not Auto-Installed)

These tools were reviewed as candidate additions for this repo's Codespace.
None of them are wired into `scripts/bootstrap-codespace.sh` or any shared
alias — installing/running them is a deliberate, manual action, so they
don't add startup time or attack surface to every fresh Codespace by
default. Install commands are listed for when you actually want one.

## Already wired into bootstrap (for contrast, not part of this list)

Ollama + Hermes + Aider + Headroom (`scripts/setup-hermes-agent.sh`), and the
Telegram-Aider bridge (`scripts/telegram-aider-bridge.py`, standalone/opt-in
— see its own docstring) are covered elsewhere and are not "documented but
uninstalled" — the Hermes stack runs automatically on bootstrap; the
Telegram bridge is started manually but is a first-class part of this
repo's own scripts, not a third-party tool.

## GPU-dependent — will run poorly or not at all on this Codespace

This repo's `.devcontainer/devcontainer.json` has no `hostRequirements`, so
Codespaces provisions a default machine: modest CPU/RAM, **no GPU**. The
tools below are real candidates for reducing Book Studio's reliance on paid
OpenAI calls, but only on a GPU-capable machine (a larger Codespace machine
type with a GPU, or your own hardware) — do not expect usable performance
here.

- **lllyasviel/Fooocus** — local Stable-Diffusion-based image generation.
  ```bash
  git clone https://github.com/lllyasviel/Fooocus
  cd Fooocus && pip install -r requirements_versions.txt
  python entry_with_update.py
  ```
- **OpenBMB/VoxCPM2** — local text-to-speech/voice cloning.
  ```bash
  git clone https://github.com/OpenBMB/VoxCPM2
  cd VoxCPM2 && pip install -r requirements.txt
  ```
- **Anil-matcha/Open-Generative-AI** — local generative-media pipeline.
  Check its own README for current setup steps before use; not yet
  installed or tested in this repo.

## CPU-feasible, no specific integration yet

- **openai/whisper** — free, local speech-to-text. Feasible on CPU for
  modest audio lengths even without a GPU (slower than the OpenAI API, but
  free and works offline).
  ```bash
  pip install --user -U openai-whisper
  whisper some-audio-file.mp3 --model base
  ```
- **yt-dlp** — general-purpose media downloader. No specific tie-in to this
  repo yet.
  ```bash
  pip install --user -U yt-dlp
  ```

## Relevant to Seller/Buyer Engine data ingestion — worth a closer look later

Not adopted this pass; flagged as genuinely relevant to existing
county/public-records and listing-data ingestion work (see
`memory/ACTIVE_CONTEXT.md`), but each deserves its own separate evaluation
rather than being bundled in here.

- **browser-use/browser-use** — LLM-driven browser automation.
  ```bash
  pip install --user browser-use
  ```
- **Firecrawl** (`firecrawl-dev/firecrawl`) — site-to-markdown/structured-data
  scraping API/self-hosted service. See its own repo for self-host vs.
  hosted-API setup.

## Scoped-use-only tool (documented here, setup script lives separately)

- **jo-inc/camofox-browser** — stealth headless browser for legitimate
  county/public-records pulls that would otherwise be blocked by
  anti-bot measures. Setup script: `scripts/setup-camofox.sh` (not run by
  bootstrap; run it yourself when needed). **Approved scope: existing
  legitimate public-records data pulls only — not general-purpose scraping
  of arbitrary third-party sites.** See the script's own header comment.

## Explicitly evaluated and not pursued

See `memory/ACTIVE_CONTEXT.md` for the full list of repos reviewed this
pass that were dropped as off-topic, redundant, or too large an infra
decision for this change (NangoHQ/nango, Coollabsio/Coolify, trading/finance
agent frameworks, MoneyPrinterTurbo, Medusa, and others).
