import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/oracle/AppShell";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    // DEV BYPASS — remove before production
    if (import.meta.env.DEV && localStorage.getItem("__dev_bypass_auth") === "1") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AppShell,
});
