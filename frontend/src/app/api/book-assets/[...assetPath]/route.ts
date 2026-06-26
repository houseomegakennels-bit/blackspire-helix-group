import path from "node:path";

import { NextResponse } from "next/server";

import { readAssetBuffer } from "@/lib/book-studio/store";

export const runtime = "nodejs";

const ASSET_ROOT = path.join(process.cwd(), "data", "book-studio", "assets");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetPath: string[] }> },
) {
  try {
    const { assetPath } = await params;
    const target = path.resolve(ASSET_ROOT, assetPath.join("/"));
    const normalizedRoot = `${path.resolve(ASSET_ROOT)}${path.sep}`;

    if (!target.startsWith(normalizedRoot)) {
      return NextResponse.json({ ok: false, error: "Invalid asset path." }, { status: 400 });
    }

    const relativePath = assetPath.join("/");
    const bytes = await readAssetBuffer(relativePath);
    const extension = path.extname(target).toLowerCase();
    const mimeType =
      extension === ".png"
        ? "image/png"
        : extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : extension === ".webp"
            ? "image/webp"
            : extension === ".svg"
              ? "image/svg+xml"
              : extension === ".wav"
                ? "audio/wav"
                : extension === ".mp4"
                  ? "video/mp4"
                  : "application/octet-stream";

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "no-store",
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Asset not found." },
      { status: 404 },
    );
  }
}
