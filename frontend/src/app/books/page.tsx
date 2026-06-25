import Image from "next/image";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { listPublishedBooks } from "@/lib/book-studio/service";
import { getAssetUrl } from "@/lib/book-studio/store";

export const dynamic = "force-dynamic";

export default async function PublicBooksPage() {
  const books = await listPublishedBooks();

  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-10 lg:px-6">
        <section className="brand-panel px-6 py-8 lg:px-8">
          <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Published Audiobooks</p>
          <h1 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-6xl">
            Finished Blackspire books, ready to play online.
          </h1>
          <p className="mt-5 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            These are the public book pages. Each finished title plays chapter-by-chapter as MP4 scene reels with synchronized audiobook audio.
          </p>
        </section>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {books.length ? (
            books.map((book) => {
              const cover = book.assets.find((asset) => asset.id === book.coverAssetId);
              return (
                <Link
                  key={book.id}
                  href={`/books/${book.slug}`}
                  className="brand-card overflow-hidden transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]"
                >
                  {cover ? (
                    <div className="relative h-[320px] w-full overflow-hidden">
                      <Image src={getAssetUrl(cover)} alt={book.title} fill unoptimized className="object-cover" />
                    </div>
                  ) : (
                    <div className="flex h-[320px] items-center justify-center bg-black/30 text-sm text-[var(--copy-muted)]">
                      No cover yet
                    </div>
                  )}
                  <div className="p-5">
                    <div className="text-2xl font-semibold text-white">{book.title}</div>
                    <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{book.synopsis}</p>
                    <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                      {book.chapters.length} chapter players
                    </div>
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="brand-card p-6 text-sm leading-7 text-[var(--copy-soft)]">
              No public books have been published yet.
            </div>
          )}
        </div>
      </div>
    </MarketingShell>
  );
}
