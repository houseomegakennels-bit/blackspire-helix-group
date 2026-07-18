import { createPublicHealthResponse } from "@/lib/public-health.mjs";

export function GET() {
  return createPublicHealthResponse();
}
