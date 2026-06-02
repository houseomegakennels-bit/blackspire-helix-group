import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HelixLogo, HelixWatermark } from "@/components/oracle/HelixLogo";
import { ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => { supabase.auth.getSession().then(({ data }) => { if (data.session) navigate({ to: "/dashboard" }); }); }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setNotice(null); setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/dashboard`, data: name ? { full_name: name } : undefined } });
        if (error) throw error;
        if (data.session) navigate({ to: "/dashboard" }); else setNotice("Check your inbox to confirm your email.");
      }
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const inputCls = "w-full px-3.5 py-2.5 rounded-lg bg-muted/30 border border-border focus:border-primary/60 focus:outline-none text-sm transition";

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 border-r border-border">
        <div className="absolute inset-0 grid-bg opacity-10" />
        <div className="absolute top-1/2 -left-20 size-[500px] rounded-full bg-gradient-helix opacity-20 blur-[120px]" />
        <HelixWatermark opacity={0.08} size={680} position="center" />
        <Link to="/" className="relative flex items-center gap-2.5">
          <HelixLogo size={36} />
          <div className="flex flex-col leading-none">
            <span className="font-semibold tracking-[0.18em] text-sm uppercase">Oracle <span className="text-gradient-helix">Helix</span></span>
            <span className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground mt-0.5">Blackspire Helix Group</span>
          </div>
        </Link>
        <div className="relative max-w-md">
          <div className="text-[10px] uppercase tracking-[0.25em] text-primary mb-3">Terminal v1.0</div>
          <h2 className="text-4xl font-semibold leading-tight">Read the game before it happens.</h2>
          <p className="text-muted-foreground mt-4">10 AI analysts, 6 sports, real-time sharp signals, and Monte Carlo simulations — in one cinematic dashboard.</p>
        </div>
        <div className="relative text-xs text-muted-foreground">© Blackspire Helix Group. Not a sportsbook.</div>
      </div>
      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-2"><HelixLogo size={32} /><span className="font-semibold tracking-wider uppercase text-sm">Oracle Helix</span></div>
          <h1 className="text-2xl font-semibold">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">{mode === "signin" ? "Sign in to your intelligence terminal." : "Start your 14-day Elite trial."}</p>
          <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
            {mode === "signup" && <label className="block"><span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Full name</span><div className="mt-1.5"><input className={inputCls} placeholder="Avery Kim" value={name} onChange={(e) => setName(e.target.value)} /></div></label>}
            <label className="block"><span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Email</span><div className="mt-1.5"><input type="email" required className={inputCls} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div></label>
            <label className="block"><span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Password</span><div className="mt-1.5"><input type="password" required minLength={6} className={inputCls} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} /></div></label>
            {error && <div className="text-xs text-crimson bg-crimson/10 border border-crimson/30 rounded-md px-3 py-2">{error}</div>}
            {notice && <div className="text-xs text-emerald bg-emerald/10 border border-emerald/30 rounded-md px-3 py-2">{notice}</div>}
            <button type="submit" disabled={busy} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-helix text-background font-medium hover:opacity-90 transition disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <>{mode === "signin" ? "Enter Terminal" : "Create Account"} <ArrowRight className="size-4" /></>}
            </button>
          </form>
          <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground"><div className="flex-1 h-px bg-border" />or<div className="flex-1 h-px bg-border" /></div>
          <div className="text-sm text-muted-foreground text-center mt-4">
            {mode === "signin" ? "New to Helix?" : "Already have an account?"}{" "}
            <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-primary hover:underline">{mode === "signin" ? "Create one" : "Sign in"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
