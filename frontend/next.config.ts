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
};

export default nextConfig;
