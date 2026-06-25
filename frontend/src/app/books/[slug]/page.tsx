import Image from "next/image";
import { notFound } from "next/navigation";

import { MarketingShell } from "@/components/marketing-shell";
import { getPublishedBook } from "@/lib/book-studio/service";
import { getAssetUrl } from "@/lib/book-studio/store";

export const dynamic = "force-dynamic";

export default async function PublicBookDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const book = await getPublishedBook(slug);
  if (!book) notFound();

  const cover = book.assets.find((asset) => asset.id === book.coverAssetId);

  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-10 lg:px-6">
        <section className="brand-panel overflow-hidden px-6 py-8 lg:px-8">
          <div className="grid gap-8 xl:grid-cols-[0.86fr_1.14fr] xl:items-center">
            <div>
              {cover ? (
                <div className="relative min-h-[420px] w-full overflow-hidden rounded-[28px]">
                  <Image src={getAssetUrl(cover)} alt={book.title} fill unoptimized className="object-cover" />
                </div>
              ) : (
                <div className="flex min-h-[420px] items-center justify-center rounded-[28px] border border-dashed border-[var(--line)] bg-black/25 text-sm text-[var(--copy-muted)]">
                  No cover art available
                </div>
              )}
            </div>
            <div className="space-y-5">
              <div>
                <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Blackspire Audiobook Library</p>
                <h1 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-6xl">{book.title}</h1>
                <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">{book.synopsis}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="brand-card p-4">
                  <div className="brand-display text-2xl text-white">{book.chapters.length}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">Chapters</div>
                </div>
                <div className="brand-card p-4">
                  <div className="brand-display text-2xl text-white">{book.scenes.length}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">Scenes</div>
                </div>
                <div className="brand-card p-4">
                  <div className="brand-display text-2xl text-white">{book.characters.length}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">Characters</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6">
          {book.chapters.map((chapter) => {
            const chapterVideo = book.assets.find((asset) => asset.id === chapter.videoAssetId);
            const chapterAudio = book.assets.find((asset) => asset.id === chapter.audioAssetId);
            return (
              <section key={chapter.id} className="brand-panel p-6 lg:p-8">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Chapter {chapter.order}</p>
                    <h2 className="brand-display mt-2 text-3xl text-white">{chapter.title}</h2>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">{chapter.summary}</p>
                  </div>
                </div>

                {chapterVideo ? (
                  <video controls className="mt-6 w-full rounded-[22px]" src={getAssetUrl(chapterVideo)} />
                ) : chapterAudio ? (
                  <audio controls className="mt-6 w-full" src={getAssetUrl(chapterAudio)} />
                ) : (
                  <div className="mt-6 rounded-[22px] border border-dashed border-[var(--line)] px-4 py-10 text-center text-sm text-[var(--copy-muted)]">
                    Chapter media is not available yet.
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </MarketingShell>
  );
}
