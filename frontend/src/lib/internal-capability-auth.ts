import "server-only";

import { timingSafeEqual } from "node:crypto";

export function authorizeInternalCapability(request: Request, workspaceId: unknown) {
  const expectedToken = process.env.BLACKSPIRE_CAPABILITY_TOKEN?.trim() ?? "";
  const expectedWorkspace = process.env.BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID?.trim() ?? "";
  const suppliedHeader = request.headers.get("authorization") ?? "";
  const suppliedToken = suppliedHeader.startsWith("Bearer ") ? suppliedHeader.slice(7) : "";
  if (expectedToken.length < 32 || suppliedToken.length !== expectedToken.length) return false;
  if (!timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(expectedToken))) return false;
  return typeof workspaceId === "string" && workspaceId === expectedWorkspace && /^[A-Za-z0-9._:-]{1,128}$/.test(workspaceId);
}
