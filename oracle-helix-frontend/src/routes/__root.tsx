import { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center glass rounded-2xl p-10">
        <div className="text-7xl font-mono-display text-gradient-helix">404</div>
        <h2 className="mt-4 text-xl font-semibold">Signal lost</h2>
        <p className="mt-2 text-sm text-muted-foreground">This intelligence node does not exist on the Helix network.</p>
        <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-lg bg-gradient-helix px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 transition">
          Return to Command
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  // Auto-recover: if the user navigates to a different path after hitting an
  // error (e.g. a stale render throw from a previous bundle/session), clear the
  // error boundary so they aren't stranded on "System anomaly detected".
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const initialPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== initialPath.current) {
      router.invalidate();
      reset();
    }
  }, [pathname, router, reset]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center glass rounded-2xl p-8">
        <h1 className="text-xl font-semibold">System anomaly detected</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-lg bg-gradient-helix px-4 py-2 text-sm font-medium text-background">Retry</button>
          <a href="/" className="rounded-lg border border-border px-4 py-2 text-sm">Home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});
