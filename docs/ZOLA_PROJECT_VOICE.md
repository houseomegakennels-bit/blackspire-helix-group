# Zola project overview and real-time voice

## Voice acceptance and deal lookup correction

Los confirmed live voice works inside the iPhone Telegram Mini App. Its deal-update lookup failed: the recorded read-only task missed the deployed deal selector because it used “update on” and then reached a temporarily unavailable general production provider. Added a narrow voice read adapter that preserves the original question and supplies the deployed deal-status vocabulary for conversational update requests. Mutation wording and other topics remain unchanged; unified input, read-only intent, current workspace binding and all server authorization remain enforced. The current worker doctor passes authentication and provider/websocket reachability. Sixty-two targeted tests pass, including the exact owner wording, real deployed selector, voice callback/canonical answer and cross-workspace denial. Cache version advances to voice2/v8. Deployment pending; a fresh owner deal voice response remains UNVERIFIED.

## Deployment result — September 30, 2026

UI and gateway release 21262eab40ab8f3e82daccf15ff8cc8b92dcb498 deployed successfully. The installer verified the gateway's unauthenticated 401 boundary; the UI operator verified every published asset digest and unchanged ready backend identity. Voice remains inactive because its API credential is absent; no paid voice request was made. Protected UI evidence: /var/lib/blackspire-operator/zola-ui-21262eab40ab8f3e82daccf15ff8cc8b92dcb498. Commander timed out during the additional postdeployment recheck. This documentation reconciliation was saved through GitHub; the host worktree must fast-forward before further edits. The predeployment living-memory and security checks passed; a postdeployment rerun was unavailable. See docs/ZOLA_PROJECT_VOICE.md.

## Current scope

The Mini App's Work > Projects view shows task-derived summaries for currently authorized workspaces and 14 dated business/platform checkpoints imported from Blackspire_Command_Center.md (September 27). Each checkpoint exposes its source date, recorded position, next step, and verification limits. It is not an account-wide live monitor. The September 30 operator confirmation supersedes the old unverified Zola Mini App note. Family-only workstreams were not imported.

Live task summaries use the existing API's bounded latest-50 result. A completed task is not evidence that an entire project is complete. Unknown outcomes retain review priority. Workspace and task access are refreshed together; failed authorization clears their displayed records.

## Voice architecture

The browser negotiates WebRTC audio with OpenAI through a separately deployed loopback gateway. Voice uses gpt-realtime-mini, marin, semantic turn detection, generated speech, barge-in, manual interruption, mute, and transcript history. It does not use browser dictation or speech synthesis for the live conversation. Voice workspace tools use the existing unified input API with read_only intent. Writes continue through the authenticated text interface and its existing approvals.

Gateway endpoints verify the current Zola cookie session, principal, workspace access and CSRF token for writes. The gateway forwards cookies only to the fixed loopback Zola API. Provider requests contain no Zola cookie. Before starting, and periodically during a call, it checks readiness and emergency stop. Main API/worker provider-credential prohibitions are unchanged: only the dedicated blackspire-voice service receives its own OPENAI_API_KEY.

Saved transcripts belong to the authenticated principal and workspace. They are explicitly untrusted client transcript data, not audit evidence, model authority or execution instructions. No raw audio is stored by this application. The external provider processes the audio. Transcripts remain in the gateway's private SQLite state directory.

Admission is limited to six session starts per UTC day, globally, and one active session. Each session is limited to five minutes. Both browser and gateway terminate at the limit; the server retries unconfirmed closure. An ambiguous provider create remains blocked for operator review instead of risking another paid call. These limits are not a guaranteed dollar billing cap; provider-side project budgets remain separate. No automatic refill is configured.

## Activation prerequisite

No voice API credential was configured during implementation. Mock verification is not a live audio proof.

After the gateway is installed, the operator can run:

    sudo python3 /opt/blackspire-voice/configure-key.py

The interactive prompt accepts the key without echo, verifies model access using a read-only provider request, saves it in a root-only environment file and restarts only the voice gateway. Never paste a key into chat, a browser form in Zola, source control, or a shell command. This API credential is separate from the Codex subscription login used by the task worker. The first real phone conversation is still required to verify audio quality, Telegram microphone access and interruptions.

## Deployment and rollback

scripts/install-zola-voice.mjs is a first-install-only operator for the isolated gateway. It refuses an existing unit and requires clean committed source. scripts/deploy-zola-mini-ui.mjs binds the exact a0a08dd7 UI predecessor, publishes immutable assets, adds exact project and bounded voice routes, reloads nginx and verifies all public asset digests while preserving the backend build. It automatically restores the previous nginx config on verification failure. Do not rerun completed operators.

The voice gateway listens only on 127.0.0.1:8796 as a dedicated non-root user, with a private state directory and systemd hardening. Its source release is separate from the sealed main application release. It starts with voice unavailable when its key is absent; the authenticated project overview works independently.

Verification: 68 targeted tests, normal lint/typecheck/build, security scan and syntax checks; 390px browser inspection with fourteen project checkpoints and no horizontal overflow or script errors. Tests mock the provider and do not spend API credits.

Official API reference used: https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime
