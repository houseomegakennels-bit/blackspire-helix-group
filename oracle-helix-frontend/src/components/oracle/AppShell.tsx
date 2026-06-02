import { Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Swords, Users, LineChart, Sparkles, FlaskConical, Wallet,
  BellRing, Radar, Settings as SettingsIcon, Search, Menu, X, ShieldCheck, ChevronRight, LogOut,
  Target, Zap, Flame,
} from "lucide-react";
import { HelixLogo, HelixWordmark, HelixWatermark } from "./HelixLogo";
import { cn } from "@/lib/utils";
import { LiveDot } from "./Primitives";
import { supabase } from "@/lib/supabase";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/games", label: "Games", icon: Swords },
  { to: "/players", label: "Players", icon: Users },
  { to: "/props", label: "Props Lab", icon: Target },
  { to: "/markets", label: "Markets", icon: LineChart },
  { to: "/edge", label: "Edge Finder", icon: Zap },
  { to: "/sharp", label: "Sharp & Streaks", icon: Flame },
  { to: "/ai", label: "AI Agent", icon: Sparkles },
  { to: "/simulations", label: "Simulations", icon: FlaskConical },
  { to: "/tracker", label: "Tracker", icon: Wallet },
  { to: "/alerts", label: "Alerts", icon: BellRing },
  { to: "/war-room", label: "War Room", icon: Radar },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const SPORTS = ["ALL", "NBA", "NFL", "MLB", "NHL", "WNBA"];

// Use anchor tags to avoid TanStack Router strict typing issues
function NavLink({ to, children, onClick, className }: { to: string; children: React.ReactNode; onClick?: () => void; className?: string }) {
  return <a href={to} onClick={(e) => { e.preventDefault(); window.history.pushState({}, "", to); window.dispatchEvent(new PopStateEvent("popstate")); onClick?.(); }} className={className}>{children}</a>;
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sport, setSport] = useState("ALL");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUserEmail(s?.user.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen flex w-full text-foreground">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col glass-strong border-r border-sidebar-border sticky top-0 h-screen">
        <SidebarInner pathname={pathname} userEmail={userEmail} onLogout={handleLogout} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 glass-strong border-r border-sidebar-border flex flex-col animate-fade-up">
            <div className="absolute top-3 right-3">
              <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-md hover:bg-muted/40"><X className="size-4" /></button>
            </div>
            <SidebarInner pathname={pathname} onNavigate={() => setMobileOpen(false)} userEmail={userEmail} onLogout={handleLogout} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} sport={sport} setSport={setSport} userEmail={userEmail} />
        <main className="flex-1 relative w-full">
          <HelixWatermark opacity={0.04} size={900} position="center" />
          <HelixWatermark opacity={0.03} size={520} position="bottom-left" />
          <div className="relative z-10 px-4 md:px-8 py-6 md:py-8 max-w-[1600px] w-full mx-auto">
            <Outlet />
          </div>
        </main>
        <footer className="border-t border-border/60 px-4 md:px-8 py-4 text-[11px] text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <div>© {new Date().getFullYear()} <span className="text-foreground">Oracle Helix</span> · Powered by Blackspire Helix Group</div>
          <div className="opacity-80">Sports intelligence platform. Not a sportsbook. Please play responsibly.</div>
        </footer>
      </div>
    </div>
  );
}

function SidebarInner({ pathname, onNavigate, userEmail, onLogout }: { pathname: string; onNavigate?: () => void; userEmail?: string | null; onLogout?: () => void }) {
  return (
    <>
      <div className="px-5 py-5 border-b border-sidebar-border">
        <NavLink to="/dashboard" onClick={onNavigate}><HelixWordmark /></NavLink>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/");
          return (
            <NavLink key={to} to={to} onClick={onNavigate}
              className={cn("group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative",
                active ? "bg-primary/10 text-foreground" : "text-sidebar-foreground/70 hover:text-foreground hover:bg-sidebar-accent/50")}>
              {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-gradient-helix" />}
              <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
              <span>{label}</span>
              {to === "/alerts" && <span className="ml-auto text-[10px] font-mono-display text-crimson">12</span>}
            </NavLink>
          );
        })}
        <div className="pt-4 mt-4 border-t border-sidebar-border">
          <NavLink to="/admin" onClick={onNavigate} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/60 hover:text-foreground hover:bg-sidebar-accent/50">
            <ShieldCheck className="size-4" /><span>Admin</span>
          </NavLink>
        </div>
      </nav>
      <div className="px-4 py-4 border-t border-sidebar-border">
        <div className="glass rounded-xl p-3.5 relative overflow-hidden mb-3">
          <div className="absolute -top-8 -right-8 size-24 rounded-full bg-gradient-helix opacity-30 blur-2xl" />
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Plan</div>
          <div className="font-semibold mt-1">Elite</div>
          <div className="text-xs text-muted-foreground mt-0.5">Renews Dec 12</div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-full bg-gradient-helix grid place-items-center text-[11px] font-semibold text-background shrink-0">
            {(userEmail?.[0] ?? "G").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{userEmail ?? "Guest"}</div>
            <div className="text-[10px] text-muted-foreground">Elite tier</div>
          </div>
          {onLogout && (
            <button onClick={onLogout} title="Sign out" className="p-1.5 rounded-md hover:bg-muted/40 text-muted-foreground hover:text-foreground">
              <LogOut className="size-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function TopBar({ onMenu, sport, setSport, userEmail }: { onMenu: () => void; sport: string; setSport: (s: string) => void; userEmail: string | null }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-30 glass-strong border-b border-border h-14 flex items-center px-4 md:px-8 gap-4">
      <button onClick={onMenu} className="lg:hidden p-1.5 rounded-md hover:bg-muted/40"><Menu className="size-5" /></button>
      <div className="lg:hidden flex items-center gap-2"><HelixLogo size={26} /><span className="font-semibold tracking-wider text-sm">ORACLE HELIX</span></div>
      <nav className="hidden md:flex items-center gap-1 mr-2">
        {SPORTS.map((s) => (
          <button key={s} onClick={() => setSport(s)}
            className={cn("px-2.5 py-1 rounded-md text-[11px] font-mono-display uppercase tracking-wider transition",
              sport === s ? "bg-primary/15 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground border border-transparent hover:bg-muted/30")}>
            {s}
          </button>
        ))}
      </nav>
      <div className="hidden xl:flex flex-1 max-w-sm items-center gap-2 px-3 h-9 rounded-lg bg-muted/40 border border-border focus-within:border-primary/60 transition">
        <Search className="size-4 text-muted-foreground" />
        <input placeholder="Search games, players, markets…" className="bg-transparent flex-1 text-sm outline-none placeholder:text-muted-foreground/70" />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground"><LiveDot /><span className="font-mono-display uppercase">Live</span></div>
        <button onClick={() => navigate({ to: "/alerts" })} className="relative p-1.5 rounded-md hover:bg-muted/40"><BellRing className="size-4" /><span className="absolute top-1 right-1 size-1.5 rounded-full bg-crimson" /></button>
        <div className="size-8 rounded-full bg-gradient-helix grid place-items-center text-[11px] font-semibold text-background">{(userEmail?.[0] ?? "G").toUpperCase()}</div>
      </div>
    </header>
  );
}

// Suppress unused import
void ChevronRight;
