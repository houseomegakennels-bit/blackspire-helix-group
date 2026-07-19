# Jarvis Voice UI Contract (frontend boundary only)

No voice service is connected. No ElevenLabs, Web Speech API, browser
speech service, provider credential, or microphone permission is authorized
or present. This document defines the frontend boundary a future,
separately authorized voice integration must fit into.

## Current implementation

- A visible microphone control exists in the command composer. It is
  `disabled`, labeled "Voice input (not yet enabled)", described by visible
  helper text ("Voice input is staged but not connected. No microphone
  permission is requested."), and clicking it does nothing.
- A `voice` state object exists with `state: 'idle'` and the reserved state
  machine below. Tests assert the absence of `getUserMedia`,
  `SpeechRecognition`, and `speechSynthesis` in the bundle.

## Reserved state machine

`idle → listening → transcribing → processing → speaking → idle`, with
cross-cutting states `interrupted` (operator barge-in stops playback),
`denied` (permission or policy refused; control returns to idle with a
visible, non-modal notice), and `error` (adapter failure; same recovery).

Rules for any future integration:

1. Microphone permission is requested only on explicit operator tap, never
   at load, and never re-prompted in a loop after denial.
2. `listening` maps to the Helix Core "listening" visual (expanding input
   ring) plus a text label; audio capture must never be indicated by color
   alone, and must never run while the page is hidden.
3. Transcription is shown for confirmation before any command is submitted;
   voice never submits privileged actions without the same composer path,
   idempotency key, and server policy evaluation as typed input.
4. `speaking` output must be interruptible; `interrupted` cancels playback
   without cancelling the underlying canonical task.
5. Voice state is frontend-only UI state; it is never persisted and never
   sent to the backend except as the ordinary Unified Input text.
6. Any speech provider must pass the OPEN_SOURCE_UI_STACK license gates and
   a separate operator authorization before connection.
