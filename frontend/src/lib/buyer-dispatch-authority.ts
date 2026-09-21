import "server-only";
import {buyerStoreRequestWithToken} from "@/lib/buyer-store-client";

import {
  createPublicSupabaseAuthClient,
  getAuthTokensFromCookies,
  listAuthUsers,
} from "@/lib/buyer-engine-auth";

type AdmittedBuyerPrincipal = {
  operatorId: string;
  role: "admin" | "beta_tester";
};

export type BuyerDispatchAuthority = Readonly<AdmittedBuyerPrincipal & {
  remainingMs(): number;
  requestOwnedBuyerStore?<T>(operation:string,input:unknown):Promise<T>;
  assertCurrentOwner(job: { user_id: string }): Promise<void>;
}>;

// Capture within the authenticated request, before after() or source acquisition.
// The token stays in a closure: neither the returned context nor errors expose it.
// Revalidation checks the original admission; it never reserves another action.
export async function captureBuyerDispatchAuthority(
  admitted: AdmittedBuyerPrincipal,
  requestStartedAt = performance.now(),
): Promise<BuyerDispatchAuthority> {
  const unavailable = () => new Error("Buyer dispatch authorization unavailable.");
  try {
    if (!admitted || typeof admitted.operatorId !== "string" || !admitted.operatorId
      || !["admin", "beta_tester"].includes(admitted.role)) throw unavailable();
    const { operatorId, role } = admitted;
    const deadline = requestStartedAt + 270000;
    const remainingMs = () => Math.max(0, Math.floor(deadline - performance.now()));
    if (!Number.isFinite(requestStartedAt) || requestStartedAt > performance.now() || remainingMs() < 8000) throw unavailable();
    const { accessToken } = await getAuthTokensFromCookies();
    if (typeof accessToken !== "string" || !accessToken || accessToken.length > 8192) throw unavailable();
    const revalidate = async () => {
      if (remainingMs() < 8000) throw unavailable();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const auth = createPublicSupabaseAuthClient({ signal: controller.signal });
        const { data, error } = await auth.auth.getUser(accessToken);
        if (error || data.user?.id !== operatorId) throw unavailable();
        const users = await listAuthUsers({ signal: controller.signal });
        if (!Array.isArray(users) || !users.length || !users.some(user => user.id === operatorId)) throw unavailable();
        const appRole = data.user.app_metadata?.blackspire_role;
        const explicitRole = typeof appRole === "string" && ["admin", "beta_tester", "demo_viewer", "client_only"].includes(appRole)
          ? appRole
          : null;
        const currentRole = explicitRole ?? (users[0]?.id === operatorId ? "admin" : "client_only");
        if (currentRole !== role) throw unavailable();
      } catch {
        throw unavailable();
      } finally {
        clearTimeout(timer);
      }
    };
    await revalidate();
    return Object.freeze({
      operatorId,
      role,
      remainingMs,
      async requestOwnedBuyerStore<T>(operation:string,input:unknown):Promise<T> {
        await revalidate();
        return buyerStoreRequestWithToken<T>(operation,input,accessToken);
      },
      async assertCurrentOwner(job: { user_id: string }) {
        if (job?.user_id !== operatorId) throw unavailable();
        await revalidate();
      },
    });
  } catch {
    throw unavailable();
  }
}
