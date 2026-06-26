"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { AssetRecord, BookRecord, CharacterBible, ReferenceRecord, SceneRecord } from "@/lib/book-studio/types";

type HydratedAsset = AssetRecord & { url?: string };
type HydratedBook = Omit<BookRecord, "assets"> & { assets: HydratedAsset[] };

const TABS = ["overview", "scenes", "characters", "references", "queue", "publish"] as const;
type TabId = (typeof TABS)[number];

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function assetUrl(book: HydratedBook, assetId: string | null) {
  if (!assetId) return null;
  return book.assets.find((asset) => asset.id === assetId)?.url ?? null;
}

function characterReferences(book: HydratedBook, character: CharacterBible) {
  return book.references.filter(
    (reference) =>
      reference.characterIds.includes(character.id) &&
      (reference.role === "character_reference" || reference.role === "canonical_candidate"),
  );
}

function chapterScenes(book: HydratedBook, chapterId: string) {
  return book.scenes
    .filter((scene) => scene.chapterId === chapterId)
    .sort((a, b) => a.order - b.order);
}

function approvedCharacterReferences(book: HydratedBook, character: CharacterBible) {
  return characterReferences(book, character).filter((reference) => reference.approved && reference.role !== "excluded");
}

function dependentScenes(book: HydratedBook, characterId: string) {
  return book.scenes
    .filter((scene) => scene.characterIds.includes(characterId))
    .sort((a, b) => a.order - b.order);
}

function parseAutoMatchNotes(notes: string) {
  return notes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\[auto-match:(.+?)\|(.+?)\]$/);
      if (!match) return null;
      return { characterName: match[1], matchedTerm: match[2] };
    })
    .filter((value): value is { characterName: string; matchedTerm: string } => Boolean(value));
}

function manualReferenceNotes(notes: string) {
  return notes
    .split("\n")
    .filter((line) => !line.trim().startsWith("[auto-match:"))
    .join("\n")
    .trim();
}

function isStoryboardSource(reference: ReferenceRecord) {
  return reference.role === "scene_reference" && !reference.sourceReferenceId && reference.derivationKind === "none";
}

function isStoryboardDerived(reference: ReferenceRecord) {
  return reference.derivationKind === "storyboard_crop_upscale";
}

function referenceTitle(reference: ReferenceRecord) {
  return reference.label || reference.id;
}

function sceneVisualReferences(book: HydratedBook, scene: SceneRecord, role: "scene_reference" | "mood_reference") {
  return book.references.filter((reference) => {
    if (reference.role !== role || !reference.approved) return false;
    if (reference.sceneIds.includes(scene.id)) return true;
    if (reference.chapterIds.includes(scene.chapterId)) return true;
    return role === "mood_reference" && !reference.sceneIds.length && !reference.chapterIds.length;
  });
}

function referenceApprovalLabel(reference: ReferenceRecord) {
  if (reference.role === "scene_reference") return reference.approved ? "Remove scene visual anchor" : "Approve as scene visual anchor";
  if (reference.role === "mood_reference") return reference.approved ? "Remove mood/world anchor" : "Approve as mood/world anchor";
  return reference.approved ? "Remove from character bible use" : "Approve for character bible use";
}

async function uploadToSignedStorageUrl(signedUrl: string, file: File) {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);

  return fetch(signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "true" },
    body,
  });
}

export function BookStudioConsole({ initialBook }: { initialBook: HydratedBook }) {
  const router = useRouter();
  const [book, setBook] = useState(initialBook);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [status, setStatus] = useState("");
  const [sceneFilter, setSceneFilter] = useState<"all" | "key" | "pending" | "blocked">("all");
  const [isPending, startTransition] = useTransition();

  function syncBook(nextBook: HydratedBook) {
    setBook(nextBook);
    startTransition(() => {
      router.refresh();
    });
  }

  async function callJson(url: string, init?: RequestInit) {
    setStatus("Working...");
    try {
      const response = await fetch(url, init);
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        book?: HydratedBook;
        scenes?: SceneRecord[];
        references?: Array<ReferenceRecord & { assetUrl: string }>;
        characters?: Array<CharacterBible & { canonicalReference?: ReferenceRecord & { assetUrl: string } }>;
      };

      if (!payload.ok) {
        setStatus(payload.error || "Request failed.");
        return null;
      }

      if (payload.book) {
        syncBook(payload.book);
      }

      setStatus("Done.");
      return payload;
    } catch {
      setStatus("The server took too long to respond. For large manuscripts, analysis can run long — wait a moment and try again.");
      return null;
    }
  }

  async function analyzeBook() {
    await callJson(`/api/books/${book.id}/analyze`, { method: "POST" });
  }

  async function importReferences(formData: FormData) {
    setStatus("Importing references...");
    const response = await fetch(`/api/books/${book.id}/reference-import`, {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json()) as { ok: boolean; error?: string; book?: HydratedBook };
    if (!payload.ok || !payload.book) {
      setStatus(payload.error || "Reference import failed.");
      return;
    }
    syncBook(payload.book);
    setStatus("References imported.");
  }

  async function importCharacterBible(formData: FormData) {
    const characterBible = formData.get("characterBible");
    if (!(characterBible instanceof File) || characterBible.size === 0) {
      setStatus("Choose a character bible file first.");
      return;
    }

    setStatus("Importing character bible...");
    const targetResponse = await fetch("/api/books/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: characterBible.name,
        mimeType: characterBible.type,
        kind: "character_bible_document",
        bookId: book.id,
      }),
    });
    const target = (await targetResponse.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      error?: string;
      direct?: boolean;
      signedUrl?: string;
      assetId?: string;
      relativePath?: string;
      fileName?: string;
      mimeType?: string;
    };
    if (!target.ok) {
      setStatus(target.error || "Could not start the character bible upload.");
      return;
    }

    let response: Response;
    if (target.direct && target.signedUrl) {
      const put = await uploadToSignedStorageUrl(target.signedUrl, characterBible);
      if (!put.ok) {
        const detail = await put.text().catch(() => "");
        setStatus(`Character bible upload failed while sending the file${detail ? `: ${detail.slice(0, 180)}` : "."}`);
        return;
      }

      response = await fetch(`/api/books/${book.id}/character-bible-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: target.assetId,
          relativePath: target.relativePath,
          fileName: target.fileName,
          mimeType: target.mimeType,
        }),
      });
    } else {
      const body = new FormData();
      body.append("characterBible", characterBible);
      response = await fetch(`/api/books/${book.id}/character-bible-import`, { method: "POST", body });
    }

    const payload = (await response.json()) as { ok: boolean; error?: string; book?: HydratedBook };
    if (!payload.ok || !payload.book) {
      setStatus(payload.error || "Character bible import failed.");
      return;
    }
    const importedReferences = Math.max(0, payload.book.references.length - book.references.length);
    syncBook(payload.book);
    setStatus(
      importedReferences
        ? `Character bible imported with ${importedReferences} new reference image${importedReferences === 1 ? "" : "s"}.`
        : "Character bible imported, but no embedded reference images were found.",
    );
  }

  async function patchCharacter(characterId: string, patch: Record<string, unknown>) {
    await callJson(`/api/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteWorkspace() {
    const confirmed = window.confirm(`Delete "${book.title}" from Book Studio? This removes its scenes, characters, references, and rendered assets.`);
    if (!confirmed) return;

    setStatus(`Deleting ${book.title}...`);
    const response = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!payload.ok) {
      setStatus(payload.error || "Delete failed.");
      return;
    }

    router.push("/studio/books");
    router.refresh();
  }

  async function extractStoryboardCandidates(referenceId: string) {
    await callJson(`/api/references/${referenceId}/extract-character-candidates`, {
      method: "POST",
    });
  }

  function renderCharacterReferenceCard(character: CharacterBible, reference: ReferenceRecord) {
    return (
      <div
        key={reference.id}
        className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-black/25 text-left transition hover:border-[var(--line-strong)]"
      >
        <div className="relative h-[180px] w-full">
          <Image
            src={assetUrl(book, reference.assetId) || ""}
            alt={`${character.name} reference`}
            fill
            unoptimized
            className="object-cover"
          />
        </div>
        <div className="space-y-3 p-3">
          <div className="text-sm font-semibold text-white">{referenceTitle(reference)}</div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--copy-soft)]">
            <span>{reference.source}</span>
            <span>{reference.approved ? "Bible reference" : "Not in bible yet"}</span>
            {isStoryboardDerived(reference) ? <span>Storyboard-derived</span> : null}
            {isStoryboardDerived(reference) ? <span>{reference.derivationStatus}</span> : null}
            {typeof reference.confidence === "number" ? <span>{Math.round(reference.confidence * 100)}% match</span> : null}
            {reference.id === character.canonicalReferenceId ? <span>Canonical</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                startTransition(() =>
                  void callJson(`/api/characters/${character.id}/approve-canonical-look`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ referenceId: reference.id }),
                  }),
                );
              }}
              className="rounded-full border border-[var(--line)] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]"
            >
              {reference.id === character.canonicalReferenceId ? "Canonical look" : "Set canonical"}
            </button>
            <button
              type="button"
              onClick={() => {
                startTransition(() =>
                  void callJson(`/api/references/${reference.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      approved: !reference.approved,
                      derivationStatus:
                        isStoryboardDerived(reference) && !reference.approved
                          ? "approved"
                          : reference.derivationStatus,
                      characterIds: uniqueStrings([...reference.characterIds, character.id]),
                    }),
                  }),
                );
              }}
              className="rounded-full border border-[var(--line)] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-soft)]"
            >
              {reference.approved ? "Remove from bible" : "Approve for bible use"}
            </button>
            {isStoryboardDerived(reference) ? (
              <button
                type="button"
                onClick={() => {
                  startTransition(() =>
                    void callJson(`/api/references/${reference.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        approved: false,
                        derivationStatus: "rejected",
                        characterIds: uniqueStrings([...reference.characterIds, character.id]),
                      }),
                    }),
                  );
                }}
                className="rounded-full border border-[var(--line)] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-soft)]"
              >
                Reject
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const firstKeyScene = [...book.scenes]
    .filter((scene) => scene.priority === "key")
    .sort((a, b) => a.order - b.order)[0] ?? null;
  const firstChapter = [...book.chapters].sort((a, b) => a.order - b.order)[0] ?? null;
  const linkedCharacterReferenceCount = book.references.filter((reference) => reference.characterIds.length > 0).length;
  const sampleFlowSteps = [
    {
      label: "Analyze manuscript",
      done: book.scenes.length > 0 && book.characters.length > 0,
      detail: book.scenes.length
        ? `${book.scenes.length} scenes and ${book.characters.length} characters extracted.`
        : "Break the manuscript into scenes and generate character bibles.",
    },
    {
      label: "Match reference images",
      done: linkedCharacterReferenceCount > 0,
      detail: linkedCharacterReferenceCount
        ? `${linkedCharacterReferenceCount} reference assets linked to one or more characters.`
        : "Import image references, then let the studio auto-link them to matching character bibles.",
    },
    {
      label: "Lock a canonical look",
      done: book.characters.some((character) => character.status === "locked" && character.canonicalReferenceId),
      detail: book.characters.some((character) => character.status === "locked" && character.canonicalReferenceId)
        ? `${book.characters.filter((character) => character.status === "locked" && character.canonicalReferenceId).length} character bibles have canonical looks.`
        : "Approve at least one canonical portrait so continuity has a stable face to follow.",
    },
    {
      label: "Render a key scene image",
      done: Boolean(firstKeyScene?.imageAssetId),
      detail: firstKeyScene?.imageAssetId
        ? `First key scene "${firstKeyScene.title}" has a rendered image.`
        : "Render one key scene and check whether the character bible preserves likeness.",
    },
    {
      label: "Generate scene audio",
      done: Boolean(firstKeyScene?.audioAssetId),
      detail: firstKeyScene?.audioAssetId
        ? `First key scene "${firstKeyScene.title}" has synchronized audio.`
        : "Create the first scene audio track to validate narration and voice casting.",
    },
    {
      label: "Render chapter MP4",
      done: Boolean(firstChapter?.videoAssetId),
      detail: firstChapter?.videoAssetId
        ? `Chapter "${firstChapter?.title}" has a player-ready MP4.`
        : "Render one chapter reel so the audio and scene stills can be reviewed together.",
    },
    {
      label: "Publish the sample book",
      done: book.status === "Published",
      detail:
        book.status === "Published"
          ? `Public page is live at /books/${book.slug}.`
          : "Publish when the first chapter player and character continuity both look right.",
    },
  ];

  return (
    <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-8 lg:px-6">
      <section className="brand-panel book-studio-panel book-studio-panel-hero p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/studio/books" className="text-xs uppercase tracking-[0.32em] text-[var(--copy-muted)]">
                Studio / Books
              </Link>
              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                {book.status}
              </span>
            </div>
            <h1 className="brand-display text-4xl text-white lg:text-5xl">{book.title}</h1>
            <p className="max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">{book.synopsis}</p>
          </div>

          <div className="grid min-w-[280px] grid-cols-3 gap-3">
            <div className="brand-card p-4 text-center">
              <div className="brand-display text-2xl text-white">{book.chapters.length}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">Chapters</div>
            </div>
            <div className="brand-card p-4 text-center">
              <div className="brand-display text-2xl text-white">{book.scenes.length}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">Scenes</div>
            </div>
            <div className="brand-card p-4 text-center">
              <div className="brand-display text-2xl text-white">{book.characters.length}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">Characters</div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                activeTab === tab
                  ? "border-[var(--line-strong)] bg-[rgba(255,176,78,0.12)] text-white"
                  : "border-[var(--line)] text-[var(--copy-soft)] hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              startTransition(() => void deleteWorkspace());
            }}
            className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
          >
            Delete workspace
          </button>
        </div>

        <div className="mt-4 text-xs text-[var(--copy-muted)]">{status}</div>
      </section>

      {activeTab === "overview" ? (
        <div className="space-y-6">
          <section className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
            <div className="brand-panel p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Workflow</p>
                  <h2 className="brand-display mt-3 text-3xl text-white">Authoring gates</h2>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(() => void analyzeBook());
                  }}
                  className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition"
                >
                  Analyze manuscript
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {[
                  {
                    label: "Character lock",
                    value: `${book.characters.filter((character) => character.status === "locked").length}/${book.characters.length}`,
                    detail: "Main characters must be locked before bulk scene rendering.",
                  },
                  {
                    label: "Approved scenes",
                    value: `${book.scenes.filter((scene) => scene.reviewStatus === "approved").length}/${book.scenes.length}`,
                    detail: "Approve key prompts and images before final publish.",
                  },
                  {
                    label: "Public status",
                    value: book.status,
                    detail: book.publishedAt ? `Published ${new Date(book.publishedAt).toLocaleDateString()}` : "Not yet public",
                  },
                ].map((item) => (
                  <div key={item.label} className="brand-card p-5">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">{item.label}</div>
                    <div className="brand-display mt-2 text-3xl text-white">{item.value}</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <form
                action={async (formData) => {
                  await importCharacterBible(formData);
                }}
                className="brand-panel space-y-4 p-6"
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Character Bible</p>
                  <h2 className="brand-display mt-3 text-3xl text-white">Import the continuity source doc</h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                    Upload the dedicated character bible `.docx` to pull embedded portraits, figure captions, and text-only continuity notes into the right character cards.
                  </p>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Character bible file</span>
                  <input
                    type="file"
                    name="characterBible"
                    accept=".docx"
                    className="w-full rounded-2xl border border-[var(--line)] bg-black/30 px-4 py-3 text-sm text-[var(--copy-soft)]"
                  />
                </label>
                <button type="submit" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Import character bible
                </button>
              </form>

              <form
                action={async (formData) => {
                  await importReferences(formData);
                }}
                className="brand-panel space-y-4 p-6"
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Reference Library</p>
                  <h2 className="brand-display mt-3 text-3xl text-white">Bring in extra images you made while writing</h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                    Upload standalone images, `.docx` files with embedded art and notes, or a ZIP any time. The studio will pull images plus nearby descriptions, then auto-match filenames, captions, and aliases to character bibles.
                  </p>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Reference files</span>
                  <input
                    type="file"
                    name="references"
                    multiple
                    accept="image/*,.docx"
                    className="w-full rounded-2xl border border-[var(--line)] bg-black/30 px-4 py-3 text-sm text-[var(--copy-soft)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">ZIP</span>
                  <input
                    type="file"
                    name="referenceZip"
                    accept=".zip"
                    className="w-full rounded-2xl border border-[var(--line)] bg-black/30 px-4 py-3 text-sm text-[var(--copy-soft)]"
                  />
                </label>
                <button type="submit" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Import reference assets
                </button>
              </form>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
            <div className="brand-panel p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Sample Flow</p>
                  <h2 className="brand-display mt-3 text-3xl text-white">End-to-end studio check</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                    Walk one sample book through the entire pipeline before doing a big batch. This keeps the character bible, image continuity, audio, and chapter player all honest.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {sampleFlowSteps.map((step, index) => (
                  <div key={step.label} className="brand-card flex gap-4 p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-xs uppercase tracking-[0.18em] text-white">
                      {step.done ? "OK" : String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white">{step.label}</div>
                      <div className="text-sm leading-6 text-[var(--copy-soft)]">{step.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="brand-panel space-y-4 p-6">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Next Action</p>
                <h2 className="brand-display mt-3 text-3xl text-white">Pilot the pipeline</h2>
              </div>

              <div className="grid gap-3">
                {!book.scenes.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() => void analyzeBook());
                    }}
                    className="brand-button inline-flex justify-center px-5 py-3 text-sm uppercase tracking-[0.18em] transition"
                  >
                    Analyze manuscript now
                  </button>
                ) : null}

                {book.scenes.length > 0 && !linkedCharacterReferenceCount ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("references")}
                    className="rounded-full border border-[var(--line)] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
                  >
                    Review auto-matched references
                  </button>
                ) : null}

                {book.characters.length > 0 &&
                !book.characters.some((character) => character.status === "locked" && character.canonicalReferenceId) ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("characters")}
                    className="rounded-full border border-[var(--line)] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
                  >
                    Lock a canonical character look
                  </button>
                ) : null}

                {firstKeyScene && !firstKeyScene.imageAssetId ? (
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() => void callJson(`/api/scenes/${firstKeyScene.id}/render-image`, { method: "POST" }));
                    }}
                    className="rounded-full border border-[var(--line)] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
                  >
                    Render first key scene
                  </button>
                ) : null}

                {firstKeyScene && firstKeyScene.imageAssetId && !firstKeyScene.audioAssetId ? (
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() => void callJson(`/api/scenes/${firstKeyScene.id}/generate-audio`, { method: "POST" }));
                    }}
                    className="rounded-full border border-[var(--line)] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
                  >
                    Generate first scene audio
                  </button>
                ) : null}

                {firstChapter && !firstChapter.videoAssetId ? (
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() => void callJson(`/api/chapters/${firstChapter.id}/render-video`, { method: "POST" }));
                    }}
                    className="rounded-full border border-[var(--line)] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
                  >
                    Render first chapter MP4
                  </button>
                ) : null}

                {book.status !== "Published" && firstChapter?.videoAssetId ? (
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() => void callJson(`/api/books/${book.id}/publish`, { method: "POST" }));
                    }}
                    className="brand-button inline-flex justify-center px-5 py-3 text-sm uppercase tracking-[0.18em] transition"
                  >
                    Publish sample book
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "scenes" ? (
        <section className="brand-panel p-6 lg:p-8">
          <div className="mb-6 flex flex-wrap gap-3">
            {[
              ["all", "All scenes"],
              ["key", "Key scenes"],
              ["pending", "Pending review"],
              ["blocked", "Blocked"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSceneFilter(value as typeof sceneFilter)}
                className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                  sceneFilter === value
                    ? "border-[var(--line-strong)] bg-[rgba(255,176,78,0.12)] text-white"
                    : "border-[var(--line)] text-[var(--copy-soft)] hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-6">
            {book.chapters.map((chapter) => (
              <div key={chapter.id} className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Chapter {chapter.order}</p>
                    <h2 className="brand-display mt-2 text-2xl text-white">{chapter.title}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() => void callJson(`/api/chapters/${chapter.id}/render-video`, { method: "POST" }));
                    }}
                    className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
                  >
                    Render chapter MP4
                  </button>
                </div>

                <div className="grid gap-4">
                  {chapterScenes(book, chapter.id)
                    .filter((scene) => {
                      if (sceneFilter === "all") return true;
                      if (sceneFilter === "key") return scene.priority === "key";
                      if (sceneFilter === "pending") return scene.reviewStatus !== "approved";
                      if (sceneFilter === "blocked") return scene.imageStatus === "blocked";
                      return true;
                    })
                    .map((scene) => {
                    const imageSrc = assetUrl(book, scene.imageAssetId);
                    const audioSrc = assetUrl(book, scene.audioAssetId);
                    return (
                      <div key={scene.id} className="brand-card book-studio-scene-card grid gap-4 p-5 xl:grid-cols-[0.9fr_1.1fr]">
                        <div className="space-y-3">
                          {imageSrc ? (
                            <div className="relative h-[240px] w-full overflow-hidden rounded-[22px]">
                              <Image src={imageSrc} alt={scene.title} fill unoptimized className="object-cover" />
                            </div>
                          ) : (
                            <div className="flex h-[240px] items-center justify-center rounded-[22px] border border-dashed border-[var(--line)] bg-black/25 text-sm text-[var(--copy-muted)]">
                              No scene image yet
                            </div>
                          )}
                          {audioSrc ? <audio controls className="w-full" src={audioSrc} /> : null}
                        </div>

                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                              {scene.priority}
                            </span>
                            <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-soft)]">
                              image {scene.imageStatus}
                            </span>
                            <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-soft)]">
                              audio {scene.audioStatus}
                            </span>
                          </div>

                          <div>
                            <div className="text-xl font-semibold text-white">{scene.title}</div>
                            <p className="mt-2 text-sm leading-7 text-[var(--copy-soft)]">{scene.summary}</p>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="block">
                              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Location</span>
                              <input
                                defaultValue={scene.location}
                                className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                                onBlur={(event) => {
                                  if (event.currentTarget.value === scene.location) return;
                                  startTransition(() =>
                                    void callJson(`/api/scenes/${scene.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ location: event.currentTarget.value }),
                                    }),
                                  );
                                }}
                              />
                            </label>
                            <label className="block">
                              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Time of day</span>
                              <input
                                defaultValue={scene.timeOfDay}
                                className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                                onBlur={(event) => {
                                  if (event.currentTarget.value === scene.timeOfDay) return;
                                  startTransition(() =>
                                    void callJson(`/api/scenes/${scene.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ timeOfDay: event.currentTarget.value }),
                                    }),
                                  );
                                }}
                              />
                            </label>
                            <label className="block">
                              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Mood</span>
                              <input
                                defaultValue={scene.mood}
                                className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                                onBlur={(event) => {
                                  if (event.currentTarget.value === scene.mood) return;
                                  startTransition(() =>
                                    void callJson(`/api/scenes/${scene.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ mood: event.currentTarget.value }),
                                    }),
                                  );
                                }}
                              />
                            </label>
                            <label className="block">
                              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Priority</span>
                              <select
                                defaultValue={scene.priority}
                                className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                                onChange={(event) => {
                                  startTransition(() =>
                                    void callJson(`/api/scenes/${scene.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ priority: event.currentTarget.value }),
                                    }),
                                  );
                                }}
                              >
                                <option value="key">key</option>
                                <option value="supporting">supporting</option>
                                <option value="background">background</option>
                              </select>
                            </label>
                          </div>

                          {(() => {
                            const sceneAnchors = sceneVisualReferences(book, scene, "scene_reference");
                            const moodAnchors = sceneVisualReferences(book, scene, "mood_reference");
                            const totalAnchors = sceneAnchors.length + moodAnchors.length;
                            return (
                              <div className="rounded-[24px] border border-[var(--line)] bg-black/20 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--gold-soft)]">Visual anchor manifest</p>
                                    <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                                      {totalAnchors
                                        ? `${sceneAnchors.length} scene anchor(s) and ${moodAnchors.length} mood/world anchor(s) will be sent into image generation.`
                                        : "No approved scene anchors yet. Link and approve scene or mood references in the Reference Library to guide this render."}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setActiveTab("references")}
                                    className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)]"
                                  >
                                    Manage anchors
                                  </button>
                                </div>
                                {totalAnchors ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {[...sceneAnchors, ...moodAnchors].map((reference) => (
                                      <span
                                        key={`${scene.id}-${reference.id}`}
                                        className="rounded-full border border-[var(--line)] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--copy-muted)]"
                                      >
                                        {reference.role === "scene_reference" ? "Scene" : "Mood"}: {referenceTitle(reference)}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()}

                          <div className="grid gap-3 md:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => {
                                startTransition(() => void callJson(`/api/scenes/${scene.id}/render-image`, { method: "POST" }));
                              }}
                              className="brand-button inline-flex items-center justify-center px-5 py-3 text-sm uppercase tracking-[0.18em] transition"
                            >
                              Render image
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                startTransition(() => void callJson(`/api/scenes/${scene.id}/generate-audio`, { method: "POST" }));
                              }}
                              className="rounded-full border border-[var(--line)] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
                            >
                              Generate audio
                            </button>
                          </div>

                          <label className="block">
                            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Scene prompt</span>
                            <textarea
                              defaultValue={scene.imagePrompt}
                              className="min-h-[140px] w-full rounded-[22px] border border-[var(--line)] bg-black/25 px-4 py-3 text-sm leading-6 text-[var(--copy-soft)]"
                              onBlur={(event) => {
                                if (event.currentTarget.value === scene.imagePrompt) return;
                                startTransition(() =>
                                  void callJson(`/api/scenes/${scene.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ imagePrompt: event.currentTarget.value }),
                                  }),
                                );
                              }}
                            />
                          </label>

                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                startTransition(() =>
                                  void callJson(`/api/scenes/${scene.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      reviewStatus: scene.reviewStatus === "approved" ? "pending" : "approved",
                                    }),
                                  }),
                                );
                              }}
                              className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)] hover:text-white"
                            >
                              {scene.reviewStatus === "approved" ? "Mark pending" : "Approve scene"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "characters" ? (
        <section className="brand-panel p-6 lg:p-8">
          <div className="grid gap-4 xl:grid-cols-2">
            {book.characters.map((character) => {
              const references = characterReferences(book, character);
              const canonical = references.find((reference) => reference.id === character.canonicalReferenceId);
              const groupedReferences = {
                canonical: references.filter((reference) => reference.id === character.canonicalReferenceId),
                approved: references.filter(
                  (reference) => reference.id !== character.canonicalReferenceId && reference.approved && !isStoryboardDerived(reference),
                ),
                storyboard: references.filter(
                  (reference) => reference.id !== character.canonicalReferenceId && isStoryboardDerived(reference),
                ),
                other: references.filter(
                  (reference) =>
                    reference.id !== character.canonicalReferenceId &&
                    !reference.approved &&
                    !isStoryboardDerived(reference),
                ),
              };
              return (
                <div key={character.id} className="brand-card space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-2xl font-semibold text-white">{character.name}</div>
                      <p className="mt-2 text-sm leading-7 text-[var(--copy-soft)]">
                        {character.coreDescription || "No core description yet."}
                      </p>
                    </div>
                    <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                      {character.status}
                    </span>
                  </div>

                  {canonical ? (
                    <div className="relative h-[280px] w-full overflow-hidden rounded-[22px]">
                      <Image
                        src={assetUrl(book, canonical.assetId) || ""}
                        alt={`${character.name} canonical`}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex h-[280px] items-center justify-center rounded-[22px] border border-dashed border-[var(--line)] bg-black/25 text-sm text-[var(--copy-muted)]">
                      No canonical portrait yet
                    </div>
                  )}

                  <div className="grid gap-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)] md:grid-cols-3">
                    <div className="rounded-2xl border border-[var(--line)] px-3 py-3">Age: {character.ageRange || "unknown"}</div>
                    <div className="rounded-2xl border border-[var(--line)] px-3 py-3">Sex: {character.sex}</div>
                    <div className="rounded-2xl border border-[var(--line)] px-3 py-3">
                      Voice: {character.voiceAssignment?.characterVoice || "unassigned"}
                    </div>
                  </div>

                  <div className="brand-card space-y-4 p-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)]">Bible Manifest</div>
                      <div className="mt-2 text-sm leading-7 text-[var(--copy-soft)]">
                        This manifest is the continuity bundle the renderer now pulls from: core description, locked portrait, approved backup references, and every dependent scene that uses this character.
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-[var(--line)] px-3 py-3 text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">
                        Canonical
                        <div className="mt-2 text-sm font-semibold text-white">
                          {character.canonicalReferenceId ? "Locked" : "Missing"}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-[var(--line)] px-3 py-3 text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">
                        Approved refs
                        <div className="mt-2 text-sm font-semibold text-white">
                          {approvedCharacterReferences(book, character).length}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-[var(--line)] px-3 py-3 text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">
                        Dependent scenes
                        <div className="mt-2 text-sm font-semibold text-white">
                          {dependentScenes(book, character.id).length}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {dependentScenes(book, character.id).length ? (
                        dependentScenes(book, character.id).slice(0, 8).map((scene) => (
                          <span
                            key={scene.id}
                            className="rounded-full border border-[var(--line)] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--copy-soft)]"
                          >
                            {scene.title}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-[var(--copy-muted)]">No scene dependencies yet.</span>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block md:col-span-2">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Core description</span>
                      <textarea
                        defaultValue={character.coreDescription}
                        className="min-h-[120px] w-full rounded-[22px] border border-[var(--line)] bg-black/25 px-4 py-3 text-sm leading-6 text-[var(--copy-soft)]"
                        onBlur={(event) => {
                          if (event.currentTarget.value === character.coreDescription) return;
                          startTransition(() => void patchCharacter(character.id, { coreDescription: event.currentTarget.value }));
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Facial traits</span>
                      <textarea
                        defaultValue={character.facialTraits}
                        className="min-h-[96px] w-full rounded-[22px] border border-[var(--line)] bg-black/25 px-4 py-3 text-sm leading-6 text-[var(--copy-soft)]"
                        onBlur={(event) => {
                          if (event.currentTarget.value === character.facialTraits) return;
                          startTransition(() => void patchCharacter(character.id, { facialTraits: event.currentTarget.value }));
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Body traits</span>
                      <textarea
                        defaultValue={character.bodyTraits}
                        className="min-h-[96px] w-full rounded-[22px] border border-[var(--line)] bg-black/25 px-4 py-3 text-sm leading-6 text-[var(--copy-soft)]"
                        onBlur={(event) => {
                          if (event.currentTarget.value === character.bodyTraits) return;
                          startTransition(() => void patchCharacter(character.id, { bodyTraits: event.currentTarget.value }));
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Hair</span>
                      <input
                        defaultValue={character.hair}
                        className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                        onBlur={(event) => {
                          if (event.currentTarget.value === character.hair) return;
                          startTransition(() => void patchCharacter(character.id, { hair: event.currentTarget.value }));
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Vibe</span>
                      <input
                        defaultValue={character.vibe}
                        className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                        onBlur={(event) => {
                          if (event.currentTarget.value === character.vibe) return;
                          startTransition(() => void patchCharacter(character.id, { vibe: event.currentTarget.value }));
                        }}
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Continuity notes</span>
                      <textarea
                        defaultValue={character.continuityNotes}
                        className="min-h-[110px] w-full rounded-[22px] border border-[var(--line)] bg-black/25 px-4 py-3 text-sm leading-6 text-[var(--copy-soft)]"
                        onBlur={(event) => {
                          if (event.currentTarget.value === character.continuityNotes) return;
                          startTransition(() => void patchCharacter(character.id, { continuityNotes: event.currentTarget.value }));
                        }}
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        startTransition(() =>
                          void callJson(`/api/characters/${character.id}/generate-references`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ bookId: book.id }),
                          }),
                        );
                      }}
                      className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition"
                    >
                      Generate portrait candidates
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                      Character bible references: approved images below will be reused for portrait and scene generation.
                    </div>
                    {references.length ? (
                      <div className="space-y-5">
                        {[
                          { title: "Canonical", items: groupedReferences.canonical },
                          { title: "Approved Bible References", items: groupedReferences.approved },
                          { title: "Storyboard-Derived Candidates", items: groupedReferences.storyboard },
                          { title: "Other Linked References", items: groupedReferences.other },
                        ]
                          .filter((group) => group.items.length > 0)
                          .map((group) => (
                            <div key={group.title} className="space-y-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">{group.title}</div>
                              <div className="grid gap-3 md:grid-cols-2">
                                {group.items.map((reference) => renderCharacterReferenceCard(character, reference))}
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                        <div className="rounded-[22px] border border-dashed border-[var(--line)] px-4 py-8 text-sm text-[var(--copy-muted)]">
                          No character-linked references yet. Link uploads to this character, then approve the ones the bible should use.
                        </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeTab === "references" ? (
        <section className="brand-panel p-6 lg:p-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {book.references.map((reference) => (
              <div key={reference.id} className="brand-card space-y-4 p-4">
                {(() => {
                  const autoMatches = parseAutoMatchNotes(reference.notes);
                  return autoMatches.length ? (
                    <div className="flex flex-wrap gap-2">
                      {autoMatches.map((match) => (
                        <span
                          key={`${reference.id}-${match.characterName}-${match.matchedTerm}`}
                          className="rounded-full border border-[var(--line)] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--gold-soft)]"
                        >
                          Suggested: {match.characterName} via {match.matchedTerm}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
                <div className="relative h-[220px] w-full overflow-hidden rounded-[20px]">
                  <Image
                    src={assetUrl(book, reference.assetId) || ""}
                    alt={referenceTitle(reference)}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </div>
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-white">{referenceTitle(reference)}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">
                    <span>{reference.source}</span>
                    <span>{reference.approved ? "approved" : "not approved"}</span>
                    {reference.role === "scene_reference" && reference.approved ? <span>Scene visual anchor</span> : null}
                    {reference.role === "mood_reference" && reference.approved ? <span>Mood/world anchor</span> : null}
                    {isStoryboardSource(reference) ? <span>Storyboard Source</span> : null}
                    {isStoryboardDerived(reference) ? <span>Storyboard-derived</span> : null}
                    {isStoryboardDerived(reference) ? <span>{reference.derivationStatus}</span> : null}
                    {typeof reference.confidence === "number" ? <span>{Math.round(reference.confidence * 100)}% confidence</span> : null}
                  </div>
                  {isStoryboardSource(reference) ? (
                    <button
                      type="button"
                      onClick={() => {
                        startTransition(() => void extractStoryboardCandidates(reference.id));
                      }}
                      className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)]"
                    >
                      {book.references.some((candidate) => candidate.sourceReferenceId === reference.id) ? "Re-run character crop extraction" : "Extract character crops"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() =>
                        void callJson(`/api/references/${reference.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            approved: !reference.approved,
                            derivationStatus:
                              isStoryboardDerived(reference) && !reference.approved ? "approved" : reference.derivationStatus,
                          }),
                        }),
                      );
                    }}
                    className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)]"
                  >
                    {referenceApprovalLabel(reference)}
                  </button>
                  {isStoryboardDerived(reference) ? (
                    <button
                      type="button"
                      onClick={() => {
                        startTransition(() =>
                          void callJson(`/api/references/${reference.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ approved: false, derivationStatus: "rejected" }),
                          }),
                        );
                      }}
                      className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)]"
                    >
                      Reject derived crop
                    </button>
                  ) : null}
                  <select
                    defaultValue={reference.role}
                    className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                    onChange={(event) => {
                      startTransition(() =>
                        void callJson(`/api/references/${reference.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ role: event.currentTarget.value }),
                        }),
                      );
                    }}
                  >
                    {["character_reference", "scene_reference", "mood_reference", "canonical_candidate", "excluded"].map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>

                  <select
                    defaultValue={reference.characterIds[0] || ""}
                    className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                    onChange={(event) => {
                      startTransition(() =>
                        void callJson(`/api/references/${reference.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ characterIds: event.currentTarget.value ? [event.currentTarget.value] : [] }),
                        }),
                      );
                    }}
                  >
                    <option value="">No character linked</option>
                    {book.characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>

                  <select
                    defaultValue={reference.sceneIds[0] || ""}
                    className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                    onChange={(event) => {
                      startTransition(() =>
                        void callJson(`/api/references/${reference.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ sceneIds: event.currentTarget.value ? [event.currentTarget.value] : [] }),
                        }),
                      );
                    }}
                  >
                    <option value="">No scene linked</option>
                    {book.scenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>
                        {scene.title}
                      </option>
                    ))}
                  </select>

                  <select
                    defaultValue={reference.chapterIds[0] || ""}
                    className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                    onChange={(event) => {
                      startTransition(() =>
                        void callJson(`/api/references/${reference.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ chapterIds: event.currentTarget.value ? [event.currentTarget.value] : [] }),
                        }),
                      );
                    }}
                  >
                    <option value="">No chapter linked</option>
                    {book.chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.title}
                      </option>
                    ))}
                  </select>

                  <label className="block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Label</span>
                    <input
                      defaultValue={reference.label || ""}
                      className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 text-sm text-[var(--copy-soft)]"
                      onBlur={(event) => {
                        if (event.currentTarget.value === (reference.label || "")) return;
                        startTransition(() =>
                          void callJson(`/api/references/${reference.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ label: event.currentTarget.value || null }),
                          }),
                        );
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Notes</span>
                    <textarea
                      defaultValue={manualReferenceNotes(reference.notes)}
                      className="min-h-[90px] w-full rounded-[20px] border border-[var(--line)] bg-black/25 px-4 py-3 text-sm leading-6 text-[var(--copy-soft)]"
                      onBlur={(event) => {
                        if (event.currentTarget.value === manualReferenceNotes(reference.notes)) return;
                        startTransition(() =>
                          void callJson(`/api/references/${reference.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ notes: event.currentTarget.value }),
                          }),
                        );
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "queue" ? (
        <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="brand-panel space-y-5 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Render Queue</p>
              <h2 className="brand-display mt-3 text-3xl text-white">Scene-priority first</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                Use the queue to start with high-value scenes before committing to full-book rendering.
              </p>
            </div>

            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => {
                  startTransition(() =>
                    void callJson(`/api/books/${book.id}/render-queue`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ mode: "key_scenes" }),
                    }),
                  );
                }}
                className="brand-button inline-flex justify-center px-5 py-3 text-sm uppercase tracking-[0.18em] transition"
              >
                Render key scenes first
              </button>
              <button
                type="button"
                onClick={() => {
                  startTransition(() =>
                    void callJson(`/api/books/${book.id}/render-queue`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ mode: "full_book" }),
                    }),
                  );
                }}
                className="rounded-full border border-[var(--line)] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
              >
                Render full scene set
              </button>
              <button
                type="button"
                onClick={() => {
                  startTransition(() => void callJson(`/api/books/${book.id}/assign-voices`, { method: "POST" }));
                }}
                className="rounded-full border border-[var(--line)] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
              >
                Assign voices
              </button>
            </div>
          </div>

          <div className="brand-panel p-6">
            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--gold-soft)]">Chapter output</div>
            <div className="mt-4 grid gap-4">
              {book.chapters.map((chapter) => {
                const videoUrl = assetUrl(book, chapter.videoAssetId);
                return (
                  <div key={chapter.id} className="brand-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-white">{chapter.title}</div>
                        <div className="mt-1 text-sm text-[var(--copy-soft)]">
                          {chapter.sceneIds.length} scenes
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          startTransition(() => void callJson(`/api/chapters/${chapter.id}/render-video`, { method: "POST" }));
                        }}
                        className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)] hover:text-white"
                      >
                        Render MP4
                      </button>
                    </div>
                    {videoUrl ? (
                      <video controls className="mt-4 w-full rounded-[18px]" src={videoUrl} />
                    ) : (
                      <div className="mt-4 rounded-[18px] border border-dashed border-[var(--line)] px-4 py-10 text-center text-sm text-[var(--copy-muted)]">
                        No chapter MP4 yet.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "publish" ? (
        <section className="brand-panel p-6 lg:p-8">
          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Publishing</p>
                <h2 className="brand-display mt-3 text-3xl text-white">Public audiobook destination</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                  Finished books live on the public Blackspire site. The studio stays private; the public side gets chapter-by-chapter MP4 playback.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  startTransition(() => void callJson(`/api/books/${book.id}/publish`, { method: "POST" }));
                }}
                className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition"
              >
                Publish book
              </button>

              {book.status === "Published" ? (
                <Link
                  href={`/books/${book.slug}`}
                  className="inline-flex rounded-full border border-[var(--line)] px-5 py-3 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)]"
                >
                  Open public page
                </Link>
              ) : null}
            </div>

            <div className="grid gap-4">
              {book.chapters.map((chapter) => {
                const videoUrl = assetUrl(book, chapter.videoAssetId);
                return (
                  <div key={chapter.id} className="brand-card p-4">
                    <div className="text-lg font-semibold text-white">{chapter.title}</div>
                    {videoUrl ? (
                      <video controls className="mt-3 w-full rounded-[18px]" src={videoUrl} />
                    ) : (
                      <div className="mt-3 rounded-[18px] border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--copy-muted)]">
                        Render this chapter video from the queue tab before final publish.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
