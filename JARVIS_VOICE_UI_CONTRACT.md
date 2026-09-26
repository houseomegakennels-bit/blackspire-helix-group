# Zola voice UI contract

Authorized by the operator September 26, 2026. Browser-native speech recognition starts only on a microphone or Dictate tap. It never sends a task automatically. Dictation populates the existing composer for review; the ordinary Send path retains all backend authorization. Browser speech availability varies; unsupported browsers receive keyboard dictation guidance. Permission denial is shown without automatic retry. Audio capture and playback stop when the page is hidden.

Completed canonical replies expose Listen and Stop audio controls. Browser speech synthesis uses an available English Siri/Samantha voice when present, otherwise the device language default. No paid speech service or additional credential is configured. Actual microphone permission and sound on the operator iPhone remain device verification.

## Conversation mode
The operator requested automatic back-and-forth voice on September 26. Talk to Zola explicitly starts an auto-send session: recognized turns use read_only, retain server policy, and carry bounded recent conversation context as untrusted input. Completed canonical replies speak then restart listening. Interrupt stops speech and resumes listening; End, logout, pagehide and hidden-page transitions stop capture and playback. No automatic retry follows permission denial. Task failures pause for attention. Browser support and iPhone autoplay vary.
