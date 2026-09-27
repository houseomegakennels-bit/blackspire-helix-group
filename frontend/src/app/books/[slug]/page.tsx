import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BookPlayer, type PlayerChapter } from "@/components/book-player";
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

  const assetById = new Map(book.assets.map((asset) => [asset.id, asset]));
  const sceneById = new Map(book.scenes.map((scene) => [scene.id, scene]));
  const playerChapters: PlayerChapter[] = [...book.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => {
      const video = chapter.videoAssetId ? assetById.get(chapter.videoAssetId) : null;
      const audio = chapter.audioAssetId ? assetById.get(chapter.audioAssetId) : null;
      const sceneImages = chapter.sceneIds
        .map((sceneId) => sceneById.get(sceneId))
        .filter((scene): scene is NonNullable<typeof scene> => Boolean(scene))
        .sort((a, b) => a.order - b.order)
        .map((scene) => {
          const image = scene.imageAssetId ? assetById.get(scene.imageAssetId) : null;
          return image ? { url: getAssetUrl(image), title: scene.title } : null;
        })
        .filter((image): image is { url: string; title: string } => Boolean(image));

      return {
        id: chapter.id,
        order: chapter.order,
        title: chapter.title,
        summary: chapter.summary,
        videoUrl: video ? getAssetUrl(video) : null,
        audioUrl: audio ? getAssetUrl(audio) : null,
        sceneImages,
      };
    });

  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-10 lg:px-6">
        <Link href="/books" className="public-book-back">All books</Link>
        <section className="public-book-heading">
          {cover ? <Image src={getAssetUrl(cover)} alt="" width={80} height={110} unoptimized className="public-book-cover" /> : null}
          <div>
            <h1>{book.title}</h1>
            <p>{book.chapters.length} chapters · Watch or listen below</p>
          </div>
        </section>

        <div className="mt-6">
          <BookPlayer bookTitle={book.title} chapters={playerChapters} />
          <details className="public-book-about">
            <summary>About this book</summary>
            <p>{book.synopsis}</p>
          </details>
        </div>
      </div>
    </MarketingShell>
  );
}
