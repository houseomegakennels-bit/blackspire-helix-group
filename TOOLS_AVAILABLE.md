# Tools Available

Tools reviewed as candidate additions for this repo's Codespace. The first
section lists what's **auto-installed on every fresh session** via
`scripts/bootstrap-codespace.sh`; everything after it is **documented but not
auto-installed** — a deliberate, manual action when you actually want it, so
it doesn't add startup time or attack surface to every fresh Codespace.
Install commands are listed for those.

## Already wired into bootstrap (auto-installed on every fresh session)

These run automatically from `scripts/bootstrap-codespace.sh`, each as a
non-fatal step, so a fresh Codespace has them ready without a manual install:

- **Ollama + Hermes + Aider + Headroom** — `scripts/setup-hermes-agent.sh`.
- **browser-use/browser-use** — `scripts/setup-browser-use.sh`. LLM-driven
  browser automation: give it a goal and it drives a real browser (navigate,
  click, fill forms, read the page) like a person, rather than calling an API.
  Needs an LLM backend — point it at the local Hermes model (Ollama) for a
  free/self-hosted setup, or set a provider API key.
- **Firecrawl SDK** — `scripts/setup-firecrawl.sh`. Installs `firecrawl-py`,
  the *client* for turning web pages into clean markdown/structured data.
  The SDK alone does nothing until it can reach a backend: set
  `FIRECRAWL_API_KEY` for the hosted cloud API (see `CODESPACES_SECRETS.md`),
  or point it at a self-hosted Firecrawl engine (its own Docker service, not
  installed by bootstrap).

The Telegram-Aider bridge (`scripts/telegram-aider-bridge.py`) is
standalone/opt-in — started manually, never auto-run — see its own docstring.

**browser-use vs. Firecrawl vs. camofox** — easy to conflate: browser-use
*acts* in a browser to complete a task like a human; Firecrawl *reads* sites
into structured data for ingestion; camofox (below) is a *stealth* browser
about not getting blocked. Different jobs.

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
