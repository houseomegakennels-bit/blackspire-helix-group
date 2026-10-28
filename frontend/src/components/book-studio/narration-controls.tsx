"use client";

import { useState } from "react";
import { VOICE_NAMES, type VoiceAssignment, type VoiceName } from "@/lib/book-studio/types";

const fieldClass = "w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]";
const buttonClass = "rounded-full border border-[var(--line)] px-4 py-2 text-xs text-[var(--gold-soft)] disabled:opacity-50";

export function NarrationTextEditor({ sourceText, onSave }: {
  sourceText: string;
  onSave: (text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState(sourceText);
  const [saving, setSaving] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      if (saving || !text.trim() || text === sourceText) return;
      setSaving(true);
      try { await onSave(text); } finally { setSaving(false); }
    }}>
      <label className="block">
        <span className="mb-2 block text-sm text-[var(--copy-soft)]">Full narration text</span>
        <textarea className={fieldClass} rows={8} value={text} disabled={saving} onChange={(event) => setText(event.currentTarget.value)} />
      </label>
      <p className="text-xs text-[var(--copy-muted)]">{text.split(/\s+/).filter(Boolean).length} words · Saved exactly as entered. Changing text clears this scene’s audio and its chapter playback links. Audio generation is a separate action.</p>
      <button type="submit" className={buttonClass} disabled={saving || !text.trim() || text === sourceText}>{saving ? "Saving…" : "Save narration text"}</button>
    </form>
  );
}

export function CharacterVoiceEditor({ assignment, onSave }: {
  assignment: VoiceAssignment | null;
  onSave: (assignment: VoiceAssignment) => Promise<unknown>;
}) {
  const [voice, setVoice] = useState<VoiceName | "">(assignment?.characterVoice ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      if (!voice || saving) return;
      setSaving(true);
      try {
        await onSave({
          narratorVoice: assignment?.narratorVoice ?? voice,
          fallbackVoice: assignment?.fallbackVoice ?? voice,
          characterVoice: voice,
          rationale: "Selected explicitly in Book Studio.",
        });
      } finally { setSaving(false); }
    }}>
      <label className="block">
        <span className="mb-2 block text-sm text-[var(--copy-soft)]">Character narration voice</span>
        <select className={fieldClass} value={voice} disabled={saving} onChange={(event) => setVoice(event.currentTarget.value as VoiceName | "")}>
          <option value="">Unassigned</option>
          {VOICE_NAMES.map((name) => <option key={name} value={name}>{name === "onyx" ? "Onyx" : name}</option>)}
        </select>
      </label>
      <p className="text-xs text-[var(--copy-muted)]">Used when this character is first in a scene’s cast. A voice change clears dependent playback links; it does not generate audio.</p>
      <button type="submit" className={buttonClass} disabled={saving || !voice || voice === assignment?.characterVoice}>{saving ? "Saving…" : "Save voice"}</button>
    </form>
  );
}
