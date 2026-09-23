"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function SculpturalEntrance({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void import("gsap").then(({ gsap }) => {
      if (disposed) return;
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(root.current?.querySelector("[data-entrance]") ?? [], { y: 22 }, { y: 0, duration: 1.25, ease: "expo.out", clearProps: "transform" });
      });
      cleanup = () => media.revert();
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);
  return <div ref={root}>{children}</div>;
}
