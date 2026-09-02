import "server-only";

import { timingSafeEqual } from "node:crypto";

export function authorizeInternalCapability(request: Request, workspaceId: unknown) {
  const expectedToken = process.env.BLACKSPIRE_CAPABILITY_TOKEN?.trim() ?? "";
  const expectedWorkspace = process.env.BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID?.trim() ?? "";
  const suppliedHeader = request.headers.get("authorization") ?? "";
  const suppliedToken = suppliedHeader.startsWith("Bearer ") ? suppliedHeader.slice(7) : "";
  const expectedBytes = Buffer.from(expectedToken);
  const suppliedBytes = Buffer.from(suppliedToken);
  if (expectedBytes.length < 32 || suppliedBytes.length !== expectedBytes.length) return false;
  if (!timingSafeEqual(suppliedBytes, expectedBytes)) return false;
  return typeof workspaceId === "string" && workspaceId === expectedWorkspace && /^[A-Za-z0-9._:-]{1,128}$/.test(workspaceId);
}
