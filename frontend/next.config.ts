import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  outputFileTracingExcludes: {
    "/api/books/[bookId]/analyze": [
      "./node_modules/@img/**/*",
      "./node_modules/ffmpeg-static/**/*",
      "./node_modules/sharp/**/*",
    ],
  },
  outputFileTracingIncludes: {
    "/api/scenes/[sceneId]/render-image": ["./node_modules/ffmpeg-static/**/*"],
    "/api/scenes/[sceneId]/generate-audio": ["./node_modules/ffmpeg-static/**/*"],
    "/api/chapters/[chapterId]/render-video": ["./node_modules/ffmpeg-static/**/*"],
    "/api/books/[bookId]/render-queue": ["./node_modules/ffmpeg-static/**/*"],
    "/api/books/[bookId]/publish": ["./node_modules/ffmpeg-static/**/*"],
  },
};

export default nextConfig;
