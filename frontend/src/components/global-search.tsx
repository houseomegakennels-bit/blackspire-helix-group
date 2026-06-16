"use client";

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { GlobalSearchResult } from "@/app/api/search/route";

const TYPE_COLOR: Record<GlobalSearchResult["type"], string> = {
  property: "#2dd4bf",
  deal: "#d6a84f",
  buyer: "#34d399",
  owner: "#a78bfa",
  contact: "#f472b6",
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openSearch = useCallback(() => {
    setOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();

        if (open) {
          closeSearch();
          return;
        }

        openSearch();
      }

      if (event.key === "Escape" && open) {
        closeSearch();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSearch, open, openSearch]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 2) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(normalizedQuery)}`);
        const payload = (await response.json()) as { results?: GlobalSearchResult[] };

        if (!cancelled) {
          setResults(payload.results ?? []);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const go = useCallback(
    (href: string) => {
      closeSearch();
      router.push(href);
    },
    [closeSearch, router],
  );

  const handleQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;

    setQuery(nextQuery);

    if (nextQuery.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-[#2dd4bf55] bg-black/70 px-4 py-3 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)] backdrop-blur transition hover:border-[#2dd4bf] hover:text-[#5eead4] sm:bottom-auto sm:top-5 sm:py-2"
        aria-label="Open global search"
      >
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] sm:inline">Ctrl+K</kbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[12vh] backdrop-blur-sm" onClick={closeSearch}>
          <div className="w-full max-w-[560px] overflow-hidden rounded-[18px] border border-[#2dd4bf55] bg-[#070a0c] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <input
              ref={inputRef}
              value={query}
              onChange={handleQueryChange}
              placeholder="Search properties, deals, buyers, owners, parcels..."
              className="w-full border-b border-[var(--line)] bg-transparent px-5 py-4 text-sm text-white outline-none placeholder:text-[var(--copy-muted)]"
            />
            <div className="max-h-[50vh] overflow-y-auto">
              {loading && !results.length ? (
                <div className="px-5 py-6 text-sm text-[var(--copy-muted)]">Searching...</div>
              ) : results.length ? (
                results.map((result, index) => (
                  <button
                    key={`${result.type}-${index}`}
                    type="button"
                    onClick={() => go(result.href)}
                    className="flex w-full items-center gap-3 border-b border-[var(--line)] px-5 py-3 text-left transition hover:bg-white/5"
                  >
                    <span className="rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider" style={{ color: TYPE_COLOR[result.type], background: `${TYPE_COLOR[result.type]}1f` }}>
                      {result.type}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{result.label}</span>
                      <span className="block truncate text-xs text-[var(--copy-muted)]">{result.sublabel}</span>
                    </span>
                  </button>
                ))
              ) : query.trim().length >= 2 ? (
                <div className="px-5 py-6 text-sm text-[var(--copy-muted)]">No matches for &quot;{query}&quot;.</div>
              ) : (
                <div className="px-5 py-6 text-sm text-[var(--copy-muted)]">Type to search across the ecosystem.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
