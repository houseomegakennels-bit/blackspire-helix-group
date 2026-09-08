# Pearson Triad — exact-slide Onyx video handoff

## Status (2026-09-08)
Input assets and the execution brief are prepared. This handoff does NOT claim that Onyx audio, a new final video, or final-video email delivery has occurred. No application code or production deployment is changed by this commit.

The owner requests the exact supplied 12 dark slide panels with the real Geminara voice, not another narrator or redesigned slides.

## Exact input files — stored in the owner's Google Drive
- Folder: https://drive.google.com/drive/folders/1eSwnPa-nz1reA5aLJJWdUWHDDwVOV-zQ
- Archive: https://drive.google.com/file/d/18NnMQ3MMFRqwjK2_1RpVAu0GPfnyumFS/view
- Archive file ID: `18NnMQ3MMFRqwjK2_1RpVAu0GPfnyumFS`
- Archive name: `Pearson_Triad_Codex_Onyx_Handoff.zip`
- Archive size: `2810566` bytes
- Archive SHA-256: `1738b09b17d9dcb6549776943a0211e8bd8b9a5a404fc860a6b594c1ea07a237`
- Full execution prompt: https://drive.google.com/file/d/1y5moiMu729wIdgY2cMa7rhzucZYBGfjp/view
- Full prompt file ID: `1y5moiMu729wIdgY2cMa7rhzucZYBGfjp`

The actual JPEG/PNG bytes are in the Drive archive, not in this public repository. Use the authenticated Drive connector or an attached copy of the archive; do not assume an unauthenticated URL downloads a private file. Never fabricate or substitute assets when acquisition fails. Delivery recipient details are in the private archive, not this public README.

The archive contains the original contact sheet, `slides/slide_01.png` through `slide_12.png`, `manifest.json`, `narration.md`, `CODEX_PROMPT.md`, `verify_inputs.py`, `delivery.private.json`, and README. There are 19 files total. Crops follow the actual white dividers rather than equal thirds. Input verification passed locally for all 12 ordered panels and their narration hashes.

Original source JPEG SHA-256: `f08ec1a1ee58d66cae1bc7a13f87e0c17b3a49162f601b4514caf01fd3cc5b13`.

## Execution prompt
Produce the actual `Pearson_Triad_Exact_Slides_Onyx_FINAL.mp4`, not another plan. Retrieve the exact archive above, extract it to a private job folder, run `python3 verify_inputs.py`, and follow its complete `CODEX_PROMPT.md`.

Read applicable AGENTS.md, source-of-truth and Book Studio handoff documents first. Inspect current HEAD, branch, worktrees and status. Use a dedicated worktree; never switch a shared active worktree or disturb ongoing Forge/Zola work. Do not reset, merge, deploy or change production data.

### Reuse the real Geminara code
Inspect `frontend/src/lib/book-studio/media.ts`, particularly `generateSpeechAudio`, WAV/silence checks and FFmpeg helpers. Inspect `service.ts`, `store.ts`, `types.ts`, and the authenticated scene audio route as needed. If available in the selected source revision, inspect the private-pilot runtime/runner rather than bypassing its guards. Historical Geminara production commit `ffe96e465a94a7c93bcc59c4af0ada75c82373b1` records Onyx narration.

The current main media.ts was read during this handoff. It defaults to `gpt-4o-mini-tts` (environment overridable), calls the OpenAI Audio Speech API, requests WAV, rejects silent audio, and has a crop-to-fill Ken Burns renderer. Validate the effective model and voice rather than trusting defaults. Adapt presentation framing only; do not recreate the provider pipeline or modify real Geminara chapters.

### Exact voice; no fallback
Required provider/model/voice: OpenAI / `gpt-4o-mini-tts` / `onyx`, output WAV. Do not use eSpeak, Flite, pyttsx3, gTTS, Edge, AI Doc Maker, HeyGen, InVideo, prior Pearson audio, or another built-in voice. Do not force an accent or pitch effect that changes the required voice.

Use only an existing authorised generation environment and its scoped credentials. No secret scraping, printed tokens, copied production credentials, approval bypasses, new subscriptions, billing top-ups or new purchases. Existing API usage is not inherently free. Respect existing approval/budget controls. If auth, quota or access blocks the exact TTS, report the actual blocker instead of delivering a substitute.

Generate/validate slide 1 first and reuse it; then generate the remaining clips. Retain request metadata and file hashes. Do not regenerate successful paid audio because FFmpeg later failed.

### Exact artwork and per-slide timing
Use only the provided PNGs in order. Never redraw, simplify, OCR-retype or replace them. Source is 1536 x 1024 for the whole contact sheet: each panel is around 380 x 330–351. Preserve aspect ratio on a 1920 x 1080 dark canvas with side margins. Do not claim native 1080p source detail.

Disable crop-producing Ken Burns motion. Contain/pad the stationary complete panel and use gentle fades. The existing renderer's crop-to-fill must not remove text. Measure each narration's true duration; do not split the total runtime equally. Preserve sentence starts and final words. Aim near four minutes without rushing or truncation.

Use H.264/yuv420p video, AAC audio and fast-start MP4. Gentle loudness normalisation is fine; identity-changing voice effects are not. No new images or music are needed. Use bounded render threads and resume valid clips.

### Accuracy and QA
Use the supplied narration: financial bars are illustrative monthly run rates, not guaranteed earnings or proof of startup payback. On-slide market figures and future automations are not verified. No unpaid owner/family cleaning assumptions. Zola remains deferred. A small AI-narration/planning disclaimer may appear outside the artwork, never over it.

Before claiming completion: validate 12 input hashes and order; record actual Onyx/model generation evidence; decode all narration and the final MP4; verify both streams and duration alignment; inspect a representative frame from each scene against the source; check the final spoken sentence is not cut off; save QA/provenance JSON and output SHA-256. Do not invent a human listening approval.

### Save and email the finished file
Keep the master MP4, WAVs, manifest, transcript, timestamps and QA in private storage. Follow `delivery.private.json`: send the actual QA-passed MP4 via the authorised Gmail connector or existing Blackspire sender. If attachment size prevents delivery, email a properly accessible private Drive link to the unchanged master instead. Never resend an old robot-voice file. Record the real provider send receipt; a draft or queue entry is not sent email.

If email is unavailable after a successful render, return the video and mark EMAIL NOT SENT with its exact blocker. If generation is blocked, do not claim a final video exists. Return actual file location, runtime, model/voice evidence, slide-integrity result and send status.

## Related work
Pearson launch issue #127. The feature remains independently operated through Blackspire; no Zola integration is authorised here.
