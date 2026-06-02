import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { HelixLogo } from "@/components/oracle/HelixLogo";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase automatically exchanges the code/token from the URL.
    // onAuthStateChange fires once the session is established.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        subscription.unsubscribe();
        navigate({ to: "/dashboard" });
      } else if (event === "TOKEN_REFRESHED" && session) {
        subscription.unsubscribe();
        navigate({ to: "/dashboard" });
      }
    });

    // Fallback: if session already exists (e.g. page refresh), redirect now.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        subscription.unsubscribe();
        navigate({ to: "/dashboard" });
      }
    });

    // Safety fallback: if nothing happened in 5 s, send to login.
    const timeout = setTimeout(() => {
      subscription.unsubscribe();
      navigate({ to: "/login" });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <HelixLogo size={48} />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Signing you in…
      </div>
    </div>
  );
}
