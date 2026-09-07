import { createHash } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { guardAdminApi } from "@/lib/operator-access";
import { getBookById, readAssetBuffer } from "@/lib/book-studio/store";
import { publicAssetAllowed } from "@/lib/book-studio/publication";

export const runtime = "nodejs";
const ASSET_ROOT = path.join(process.cwd(), "data", "book-studio", "assets");
const notFound = () => NextResponse.json({ ok: false, error: "Asset not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

function parseRangeHeader(rangeHeader: string | null, totalBytes: number) {
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : totalBytes - Number(match[2]);
  const end = match[1] && match[2] ? Math.min(Number(match[2]), totalBytes - 1) : totalBytes - 1;
  if (!Number.isFinite(start) || start < 0 || start > end || start >= totalBytes) return null;
  return { start, end };
}

export async function GET(request: Request, { params }: { params: Promise<{ assetPath: string[] }> }) {
  try {
    const { assetPath } = await params;
    if (assetPath.length < 3 || assetPath.some((part) => !part || part === "." || part === ".." || /[\\/%?#\x00-\x1f]/.test(part))) return notFound();
    const target = path.resolve(ASSET_ROOT, assetPath.join("/"));
    if (!target.startsWith(`${path.resolve(ASSET_ROOT)}${path.sep}`)) return notFound();
    const relativePath = assetPath.join("/");
    const book = await getBookById(assetPath[0]);
    if (!book || !book.assets.some((asset) => asset.relativePath === relativePath)) return notFound();
    // A private bucket alone does not protect a public server-side asset proxy.
    // Resolve visibility BEFORE reading bytes. Only the existing admin role may preview drafts.
    if (!publicAssetAllowed(book, relativePath) && await guardAdminApi()) return notFound();
    const bytes = await readAssetBuffer(relativePath);
    const asset = book.assets.find((item) => item.relativePath === relativePath)!;
    if (asset.metadata?.releaseStatus === "approved" && createHash("sha256").update(bytes).digest("hex") !== asset.metadata.releaseSha256) return notFound();
    const extension = path.extname(target).toLowerCase();
    const mimeType = extension === ".png" ? "image/png"
      : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
      : extension === ".webp" ? "image/webp" : extension === ".svg" ? "image/svg+xml"
      : extension === ".wav" ? "audio/wav" : extension === ".mp4" ? "video/mp4" : "application/octet-stream";
    const baseHeaders = { "Content-Type": mimeType, "Cache-Control": "no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" };
    const range = parseRangeHeader(request.headers.get("range"), bytes.length);
    if (range) return new Response(new Uint8Array(bytes.subarray(range.start, range.end + 1)), {
      status: 206, headers: { ...baseHeaders, "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`, "Content-Length": String(range.end - range.start + 1) },
    });
    return new Response(new Uint8Array(bytes), { headers: { ...baseHeaders, "Content-Length": String(bytes.length) } });
  } catch {
    // Do not disclose storage errors, filenames, or upstream configuration to anonymous callers.
    return notFound();
  }
}
