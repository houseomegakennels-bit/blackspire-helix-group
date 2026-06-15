import Link from "next/link";
import { redirect } from "next/navigation";

import { getClientWorkspacePath, getSocialOsViewer } from "@/lib/social-os-server";

export const dynamic = "force-dynamic";

export default async function SocialOsLandingPage() {
  const viewer = await getSocialOsViewer();
  if (viewer) {
    redirect(viewer.isAdmin ? "/social-os/admin" : getClientWorkspacePath(viewer.clientId!));
  }

  return (
    <main className="social-os-shell">
      <div className="backdrop-grid" />
      <section className="social-os-hero panel">
        <div>
          <span className="eyebrow">BLACKSPIRE HELIX SOCIAL OS</span>
          <p className="hero-kicker">Protected client workspace route</p>
          <h1>Blackspire Social OS</h1>
          <p className="hero-copy">
            A protected client workspace for short-form campaign operations. Upload once, customize
            everywhere, preview every platform, review safely, and push campaigns without duplicate
            manual uploads.
          </p>
          <div className="hero-signal-row">
            <span className="hero-signal">TikTok + Shop + Instagram + Facebook + X</span>
            <span className="hero-signal">Masked credentials</span>
            <span className="hero-signal">Retry only failed platforms</span>
          </div>
        </div>
        <div className="social-os-hero-side">
          <div className="sync-meta">
            <span>First client seeded</span>
            <strong>Tyler Nelson Social OS</strong>
            <span>Built to scale into future client workspaces</span>
          </div>
          <div className="social-os-hero-actions">
            <Link className="sync-button" href="/social-os/login">
              Open login
            </Link>
            <Link className="ghost-button" href="/ecosystem/social-os">
              View division page
            </Link>
          </div>
        </div>
      </section>

      <section className="social-os-grid">
        <div className="social-os-main-column">
          <article className="panel social-os-card">
            <div className="panel-heading">
              <div>
                <span>Included workflow upgrades</span>
                <h2>Cleaner, safer, easier to use</h2>
              </div>
            </div>
            <div className="social-os-template-grid">
              {[
                "Guided onboarding checklist",
                "Connection health panel",
                "Post once, customize everywhere editor",
                "Preview cards for every platform",
                "Required review gate before pushing",
                "Retry only failed platforms",
                "Saved brand voice settings",
                "Media library and campaign duplication",
                "Admin mode and audit logs",
                "Tabs, empty states, loading states, and confirmation modals",
              ].map((item) => (
                <div key={item} className="link-selector-card">
                  <strong>{item}</strong>
                </div>
              ))}
            </div>
          </article>
        </div>
        <div className="social-os-side-column">
          <article className="panel social-os-card">
            <div className="panel-heading">
              <div>
                <span>Workspace structure</span>
                <h2>Operational tabs</h2>
              </div>
            </div>
            <div className="recent-campaigns-list">
              {["Dashboard", "Upload", "Campaigns", "Media Library", "Integrations", "Logs", "Settings"].map(
                (item) => (
                  <div key={item} className="recent-campaign-card">
                    <strong>{item}</strong>
                  </div>
                ),
              )}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
