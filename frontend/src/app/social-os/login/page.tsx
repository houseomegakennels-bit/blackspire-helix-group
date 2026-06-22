import { redirect } from "next/navigation";

import { SocialOsLoginForm } from "@/components/social-os/SocialOsLoginForm";
import { getClientWorkspacePath, getSocialOsViewer } from "@/lib/social-os-server";

export const dynamic = "force-dynamic";

export default async function SocialOsLoginPage() {
  const viewer = await getSocialOsViewer();

  if (viewer) {
    redirect(viewer.isAdmin ? "/social-os/admin" : await getClientWorkspacePath(viewer.clientId!));
  }

  return (
    <main className="social-os-shell">
      <div className="backdrop-grid" />
      <section className="social-os-auth-shell panel">
        <div>
          <span className="eyebrow">BLACKSPIRE HELIX SOCIAL OS</span>
          <p className="hero-kicker">Protected client login</p>
          <h1>Enter your client workspace</h1>
          <p className="hero-copy">
            Sign in to reach your protected Social OS workspace. This route is isolated per
            client, supports future client expansion, and runs on the same Supabase-backed auth
            layer already used across Blackspire Helix.
          </p>
        </div>
        <SocialOsLoginForm />
      </section>
    </main>
  );
}
