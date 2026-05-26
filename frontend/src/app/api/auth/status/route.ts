import { NextResponse } from "next/server";

import {
  countAuthUsers,
  getAuthenticatedOperator,
  hasAdminAuthEnv,
  hasPublicAuthEnv,
} from "@/lib/buyer-engine-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [operator, authUserCount] = await Promise.all([
      getAuthenticatedOperator(),
      countAuthUsers(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        authConfigured: hasPublicAuthEnv() && hasAdminAuthEnv(),
        bootstrapRequired: authUserCount === 0,
        operator: operator
          ? {
              id: operator.id,
              email: operator.email ?? null,
            }
          : null,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown auth status failure.",
      },
      { status: 500 },
    );
  }
}
