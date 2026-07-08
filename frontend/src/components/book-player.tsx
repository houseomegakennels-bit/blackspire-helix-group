"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type PlayerChapter = {
  id: string;
  order: number;
  title: string;
  summary: string;
  videoUrl: string | null;
  audioUrl: string | null;
  sceneImages: Array<{ url: string; title: string }>;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function BookPlayer({ bookTitle, chapters }: { bookTitle: string; chapters: PlayerChapter[] }) {
  const playable = chapters.filter((chapter) => chapter.videoUrl || chapter.audioUrl);
  const [activeId, setActiveId] = useState(playable[0]?.id ?? chapters[0]?.id ?? "");
  const [isPlaying, setIsPlaying] = useState(false);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sceneIndex, setSceneIndex] = useState(0);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  const activeChapter = chapters.find((chapter) => chapter.id === activeId) ?? chapters[0];
  const activeIndex = chapters.findIndex((chapter) => chapter.id === activeChapter?.id);

  /* Reset playback state when the chapter changes — adjusted during render
     (React's replacement for setState-in-effect) so the reset applies in the
     same pass instead of flashing the old time/scene for one frame. */
  const [prevActiveId, setPrevActiveId] = useState(activeId);
  if (prevActiveId !== activeId) {
    setPrevActiveId(activeId);
    setCurrentTime(0);
    setDuration(0);
    setSceneIndex(0);
  }

  // Audio-only chapters rotate through their scene artwork while playing.
  useEffect(() => {
    if (!activeChapter || activeChapter.videoUrl || !isPlaying) return;
    const imageCount = activeChapter.sceneImages.length;
    if (imageCount < 2) return;
    const timer = setInterval(() => {
      setSceneIndex((index) => (index + 1) % imageCount);
    }, 8000);
    return () => clearInterval(timer);
  }, [activeChapter, isPlaying]);

  if (!activeChapter) return null;

  function selectChapter(chapterId: string, autoplay: boolean) {
    setShouldAutoplay(autoplay);
    setActiveId(chapterId);
  }

  function togglePlay() {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play();
    else media.pause();
  }

  function seekTo(value: number) {
    const media = mediaRef.current;
    if (!media || !Number.isFinite(media.duration)) return;
    media.currentTime = value;
    setCurrentTime(value);
  }

  function stepChapter(step: number) {
    const nextChapter = chapters[activeIndex + step];
    if (nextChapter) selectChapter(nextChapter.id, true);
  }

  function handleEnded() {
    const nextChapter = chapters
      .slice(activeIndex + 1)
      .find((chapter) => chapter.videoUrl || chapter.audioUrl);
    if (nextChapter) selectChapter(nextChapter.id, true);
    else setIsPlaying(false);
  }

  const mediaEvents = {
    onPlay: () => setIsPlaying(true),
    onPause: () => setIsPlaying(false),
    onEnded: handleEnded,
    onTimeUpdate: () => setCurrentTime(mediaRef.current?.currentTime ?? 0),
    onLoadedMetadata: () => {
      setDuration(mediaRef.current?.duration ?? 0);
      if (shouldAutoplay) void mediaRef.current?.play();
    },
  };

  const activeSceneImage = activeChapter.sceneImages[sceneIndex] ?? activeChapter.sceneImages[0] ?? null;
  const hasMedia = Boolean(activeChapter.videoUrl || activeChapter.audioUrl);

  return (
    <div className="grid gap-6 lg:grid-cols-[0.36fr_0.64fr]">
      <aside className="brand-panel h-fit p-5 lg:p-6">
        <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">Chapters</p>
        <div className="mt-4 grid gap-2">
          {chapters.map((chapter) => {
            const isActive = chapter.id === activeChapter.id;
            const chapterPlayable = Boolean(chapter.videoUrl || chapter.audioUrl);
            return (
              <button
                key={chapter.id}
                type="button"
                onClick={() => chapterPlayable && selectChapter(chapter.id, true)}
                disabled={!chapterPlayable}
                className={`rounded-[16px] border px-4 py-3 text-left transition ${
                  isActive
                    ? "border-[var(--line-strong)] bg-[rgba(255,176,78,0.12)]"
                    : chapterPlayable
                      ? "border-[var(--line)] hover:border-[var(--line-strong)]"
                      : "border-[var(--line)] opacity-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">Chapter {chapter.order}</p>
                    <p className="mt-1 text-sm font-semibold text-white">{chapter.title}</p>
                  </div>
                  <span className="text-xs text-[var(--copy-muted)]">
                    {isActive && isPlaying ? "Playing" : chapterPlayable ? "▶" : "Soon"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="brand-panel overflow-hidden p-5 lg:p-6">
        <p className="text-xs uppercase tracking-[0.32em] text-[var(--gold-soft)]">
          Now playing — {bookTitle}
        </p>
        <h2 className="brand-display mt-2 text-2xl text-white lg:text-3xl">
          Chapter {activeChapter.order}: {activeChapter.title}
        </h2>

        <div className="mt-5">
          {activeChapter.videoUrl ? (
            <video
              key={activeChapter.id}
              ref={(node) => {
                mediaRef.current = node;
              }}
              src={activeChapter.videoUrl}
              playsInline
              className="w-full rounded-[22px] bg-black"
              {...mediaEvents}
            />
          ) : activeChapter.audioUrl ? (
            <div className="relative min-h-[280px] overflow-hidden rounded-[22px] bg-black/40 lg:min-h-[380px]">
              {activeSceneImage ? (
                <Image
                  src={activeSceneImage.url}
                  alt={activeSceneImage.title}
                  fill
                  unoptimized
                  className="object-cover transition-opacity duration-700"
                />
              ) : (
                <div className="flex min-h-[280px] items-center justify-center text-sm text-[var(--copy-muted)] lg:min-h-[380px]">
                  Audio chapter
                </div>
              )}
              <audio
                key={activeChapter.id}
                ref={(node) => {
                  mediaRef.current = node;
                }}
                src={activeChapter.audioUrl}
                {...mediaEvents}
              />
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-[var(--line)] px-4 py-16 text-center text-sm text-[var(--copy-muted)]">
              This chapter is still in production.
            </div>
          )}
        </div>

        {hasMedia ? (
          <div className="mt-5 rounded-[18px] border border-[var(--line)] bg-black/30 p-4">
            <input
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              step={0.1}
              value={Math.min(currentTime, duration || currentTime)}
              onChange={(event) => seekTo(Number(event.target.value))}
              aria-label="Seek"
              className="w-full accent-[var(--gold-soft)]"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => stepChapter(-1)}
                  disabled={activeIndex <= 0}
                  className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)] transition hover:text-white disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="brand-button px-6 py-2 text-sm uppercase tracking-[0.18em]"
                >
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={() => stepChapter(1)}
                  disabled={activeIndex >= chapters.length - 1}
                  className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)] transition hover:text-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
              <div className="text-xs tabular-nums text-[var(--copy-muted)]">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          </div>
        ) : null}

        <p className="mt-5 text-sm leading-7 text-[var(--copy-soft)]">{activeChapter.summary}</p>
      </section>
    </div>
  );
}
