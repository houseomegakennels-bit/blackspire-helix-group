import path from "node:path";

import { NextResponse } from "next/server";

import { readAssetBuffer } from "@/lib/book-studio/store";

export const runtime = "nodejs";

const ASSET_ROOT = path.join(process.cwd(), "data", "book-studio", "assets");

function parseRangeHeader(rangeHeader: string | null, totalBytes: number) {
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : totalBytes - Number(match[2]);
  const end = match[1] && match[2] ? Math.min(Number(match[2]), totalBytes - 1) : totalBytes - 1;
  if (!Number.isFinite(start) || start < 0 || start > end || start >= totalBytes) return null;
  return { start, end };
}

export async function GET(
  request: Request,
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

    const baseHeaders = {
      "Content-Type": mimeType,
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    };

    const range = parseRangeHeader(request.headers.get("range"), bytes.length);
    if (range) {
      return new Response(new Uint8Array(bytes.subarray(range.start, range.end + 1)), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`,
          "Content-Length": String(range.end - range.start + 1),
        },
      });
    }

    return new Response(new Uint8Array(bytes), {
      headers: {
        ...baseHeaders,
        "Content-Length": String(bytes.length),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Asset not found." },
      { status: 404 },
    );
  }
}
