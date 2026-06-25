"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { BookStudioStage } from "@/components/book-studio/book-studio-stage";
import type { BookListItem } from "@/lib/book-studio/types";

export function BookStudioIndex({ books }: { books: BookListItem[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  async function handleImport(formData: FormData) {
    setStatus("Creating book workspace...");
    try {
      const response = await fetch("/api/books/import", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        book?: { id: string };
      };

      if (!payload.ok || !payload.book) {
        setStatus(payload.error || "Book import failed.");
        return;
      }

      startTransition(() => {
        router.push(`/studio/books/${payload.book!.id}`);
        router.refresh();
      });
    } catch {
      setStatus("Import failed — the server took too long to respond. Try a smaller manuscript or check back shortly.");
    }
  }

  async function handleDelete(bookId: string, title: string) {
    const confirmed = window.confirm(`Delete "${title}" from Book Studio? This removes its scenes, characters, references, and rendered assets.`);
    if (!confirmed) return;

    setStatus(`Deleting ${title}...`);
    const response = await fetch(`/api/books/${bookId}`, { method: "DELETE" });
    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!payload.ok) {
      setStatus(payload.error || "Delete failed.");
      return;
    }

    setStatus(`Deleted ${title}.`);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-8 lg:px-6">
      <section className="brand-panel book-studio-panel book-studio-panel-hero overflow-hidden p-6 lg:p-8">
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Book Studio</p>
              <h1 className="brand-display text-4xl text-white lg:text-5xl">
                Build the book, approve the scenes, publish the finished chapter players.
              </h1>
              <p className="max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                This private studio is the back office for manuscript import, scene extraction, character continuity,
                image approvals, audio generation, chapter MP4 rendering, and public publishing.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="brand-card p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Books</div>
                <div className="brand-display mt-2 text-3xl text-white">{String(books.length).padStart(2, "0")}</div>
              </div>
              <div className="brand-card p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Published</div>
                <div className="brand-display mt-2 text-3xl text-white">
                  {String(books.filter((book) => book.status === "Published").length).padStart(2, "0")}
                </div>
              </div>
              <div className="brand-card p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Drafts</div>
                <div className="brand-display mt-2 text-3xl text-white">
                  {String(books.filter((book) => book.status !== "Published").length).padStart(2, "0")}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <BookStudioStage />
            <form
              action={async (formData) => {
                await handleImport(formData);
              }}
              className="brand-card book-studio-panel space-y-4 p-5"
            >
              <div>
                <div className="text-sm font-semibold text-white">Import a new manuscript</div>
                <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                  Upload the manuscript first, then optionally include standalone images, `.docx` reference packs with embedded images, or a ZIP of either.
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Manuscript</span>
                <input
                  required
                  type="file"
                  name="manuscript"
                  accept=".txt,.md,.docx"
                  className="w-full rounded-2xl border border-[var(--line)] bg-black/30 px-4 py-3 text-sm text-[var(--copy-soft)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Reference Files</span>
                <input
                  type="file"
                  name="references"
                  accept="image/*,.docx"
                  multiple
                  className="w-full rounded-2xl border border-[var(--line)] bg-black/30 px-4 py-3 text-sm text-[var(--copy-soft)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-[var(--copy-muted)]">Reference ZIP</span>
                <input
                  type="file"
                  name="referenceZip"
                  accept=".zip"
                  className="w-full rounded-2xl border border-[var(--line)] bg-black/30 px-4 py-3 text-sm text-[var(--copy-soft)]"
                />
              </label>

              <button
                type="submit"
                disabled={isPending}
                className="brand-button inline-flex w-full items-center justify-center px-5 py-3 text-sm uppercase tracking-[0.18em] transition"
              >
                {isPending ? "Importing..." : "Create Book Workspace"}
              </button>

              <div className="text-xs text-[var(--copy-muted)]">{status}</div>
            </form>
          </div>
        </div>
      </section>

      <section className="brand-panel p-6 lg:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Library</p>
            <h2 className="brand-display mt-3 text-3xl text-white">Current books</h2>
          </div>
          <Link href="/books" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
            View public library
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {books.length ? (
            books.map((book) => (
              <article
                key={book.id}
                className="brand-card p-5 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                    {book.status}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">
                    {book.chapterCount} chapters
                  </span>
                </div>
                <Link href={`/studio/books/${book.id}`} className="block">
                  <div className="mt-4 text-2xl font-semibold text-white">{book.title}</div>
                  <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{book.synopsis}</p>
                  <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs text-[var(--copy-muted)]">
                    <div className="rounded-2xl border border-[var(--line)] px-3 py-3">
                      <div className="brand-display text-xl text-white">{book.sceneCount}</div>
                      <div className="mt-1 uppercase tracking-[0.16em]">Scenes</div>
                    </div>
                    <div className="rounded-2xl border border-[var(--line)] px-3 py-3">
                      <div className="brand-display text-xl text-white">{book.characterCount}</div>
                      <div className="mt-1 uppercase tracking-[0.16em]">Characters</div>
                    </div>
                    <div className="rounded-2xl border border-[var(--line)] px-3 py-3">
                      <div className="brand-display text-xl text-white">{book.chapterCount}</div>
                      <div className="mt-1 uppercase tracking-[0.16em]">Chapters</div>
                    </div>
                  </div>
                </Link>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() => void handleDelete(book.id, book.title));
                    }}
                    className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
                  >
                    Delete workspace
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="brand-card p-6 text-sm leading-7 text-[var(--copy-soft)]">
              No books yet. Import the manuscript above to open the first studio workflow.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
